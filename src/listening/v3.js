/**
 * @alaminnna/ica-unofficial — listening/v3
 *
 * RESPONSIBILITY: v3 group/reply/bot derivation orchestration only — thread
 *   snapshots, attribution ring feeding, canonical extras + bot:* aliases.
 *   Stateless when no store is injected (inline data only).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./metadata, ./attribution, ./botevents
 * MUST NOT:       never network here except parent backfill via client api;
 *   never change canonical v1 event shapes (compat: message stays message)
 *
 * DEBUG: when group/reply/bot events don't appear, start looking here —
 *   snapshot feeding (polling threads?), ring timing, selfId mismatch
 */

'use strict';

const { extractThreadMeta, diffMeta } = require('./metadata');
const { createAttributionRing } = require('./attribution');
const { deriveBotEvents } = require('./botevents');

function parseReplyTo(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw.replied_to_message || raw.reply_to || null;
  if (!r || typeof r !== 'object') {
    return null;
  }
  return {
    itemId: r.item_id || r.itemId || r.id ? String(r.item_id || r.itemId || r.id) : null,
    authorUserId: r.user_id || r.userId || r.author_id ? String(r.user_id || r.userId || r.author_id) : null,
    itemType: r.item_type || r.itemType || null,
    text: typeof r.text === 'string' ? r.text : null,
    partial: true,
  };
}

function createV3Tracker(options) {
  const opts = options || {};
  const client = opts.client || {};
  const store = opts.store || null;
  const emit = opts.emit;
  const windowMs = opts.attributionWindowMs || 30000;
  const derivedOn = opts.derivedBotEvents !== false;
  const selfUsername = client.username || null;
  const ring = createAttributionRing({ windowMs });
  const snapshots = new Map();
  const systemEmitted = new Map();

  function selfId() {
    return (client.userId !== undefined && client.userId !== null) ? String(client.userId) : null;
  }

  function lookupParentAuthor(itemId) {
    if (!itemId || !store || typeof store.getMessage !== 'function') {
      return null;
    }
    try {
      const row = store.getMessage(String(itemId));
      return row && row.user_id ? String(row.user_id) : null;
    } catch (ignored) {
      return null;
    }
  }

  function lookupReactionTarget(messageId) {
    if (!messageId || !store || typeof store.getMessage !== 'function') {
      return null;
    }
    try {
      const row = store.getMessage(String(messageId));
      return row ? { authorUserId: row.user_id ? String(row.user_id) : null, itemId: String(messageId) } : null;
    } catch (ignored) {
      return null;
    }
  }

  function threadEventData(threadId, detail) {
    const sid = selfId();
    return {
      thread_id: String(threadId),
      by: detail.by || null,
      summary: detail.summary || null,
      message: {
        thread_id: String(threadId),
        id: detail.itemId || null,
        user_id: detail.by || null,
        text: detail.summary || '',
        timestamp: Date.now(),
        self: sid && detail.by ? String(detail.by) === sid : false,
        detail: detail.detail || null,
      },
    };
  }

  function noteActionLog(item, threadId, nowMs) {
    if (!item || typeof item !== 'object') {
      return;
    }
    const al = item.action_log || item.actionLog || null;
    if (!al) {
      return;
    }
    const entry = {
      op: al.op || al.action || 'unknown',
      summary: al.summary || null,
      description: al.description || null,
      mentions: (al.mentions || []).map(String),
      actorHint: item.user_id !== undefined && item.user_id !== null ? String(item.user_id) : null,
      threadId: threadId ? String(threadId) : null,
    };
    const dupe = ring.pending.some((p) => p.op === entry.op && p.threadId === entry.threadId &&
      (p.summary || null) === (entry.summary || null) && p.actorHint === entry.actorHint);
    if (!dupe) {
      ring.push(entry, nowMs);
    }
  }

  function emitMappedActionLog(item, threadId) {
    const al = (item && (item.action_log || item.actionLog)) || null;
    if (!al || !threadId) {
      return;
    }
    const op = String(al.op || al.action || 'unknown');
    const mentions = (al.mentions || []).map(String);
    const actor = item.user_id !== undefined && item.user_id !== null ? String(item.user_id) : null;
    const summary = al.summary || al.description || null;
    if (op === 'add_users' && mentions.length > 0) {
      markSystemEmitted(threadId, summary);
      emit('group:member_join', threadEventData(threadId, { by: actor, summary, itemId: item.item_id || item.id, detail: { op } }));
      return;
    }
    if (op === 'remove_users') {
      const resolved = ring.resolveLeave({ actorHint: actor, mentions, description: al.description }, mentions);
      markSystemEmitted(threadId, summary);
      emit('group:member_leave', threadEventData(threadId, {
        by: resolved.removedBy || actor, summary, itemId: item.item_id || item.id, detail: { op, kind: resolved.kind },
      }));
      return;
    }
    markSystemEmitted(threadId, summary || op);
    emit('message:system', threadEventData(threadId, { by: actor, summary: summary || op, itemId: item.item_id || item.id, detail: { op } }));
  }

  function trackThread(threadObj, nowMs) {
    if (!threadObj || typeof threadObj !== 'object') {
      return;
    }
    const meta = extractThreadMeta(threadObj);
    if (!meta.threadId) {
      return;
    }
    if (meta.users === undefined && meta.title === undefined && meta.theme === undefined &&
      meta.nicknames === undefined && meta.leftUsers === undefined && meta.admins === undefined &&
      meta.approvalRequired === undefined && meta.image === undefined) {
      return;
    }
    const prev = snapshots.get(meta.threadId) || null;
    const merged = { ...(prev || {}) };
    Object.keys(meta).forEach((k) => {
      if (meta[k] !== undefined) {
        merged[k] = meta[k];
      }
    });
    if (!prev) {
      snapshots.set(meta.threadId, merged);
      return;
    }
    snapshots.set(meta.threadId, merged);
    diffMeta(prev, merged).forEach((ev) => {
      const fused = ring.fuse(ev.type, null, nowMs);
      const by = fused.matched ? fused.by : null;
      const summary = fused.matched ? fused.summary : null;
      if (ev.type === 'group:member_leave') {
        const resolved = ring.resolveLeave({ actorHint: by, mentions: [] }, ev.left || []);
        emit('group:member_leave', threadEventData(meta.threadId, {
          by: resolved.removedBy || by, summary, detail: ev,
        }));
        return;
      }
      emit(ev.type, threadEventData(meta.threadId, { by, summary, detail: ev }));
    });
  }

  function toListenData(evt) {
    return {
      thread_id: evt.threadID,
      message: {
        thread_id: evt.threadID,
        id: evt.messageID,
        user_id: evt.senderID,
        text: evt.body || '',
        timestamp: evt.timestamp || Date.now(),
        mentions: evt.mentions || {},
        replyTo: evt.replyTo || null,
        self: evt.self || false,
        botContext: evt.botContext || null,
      },
      by: evt.by || null,
      summary: evt.summary || null,
    };
  }

  function baseEvent(message, extra) {
    return {
      type: 'message',
      threadID: message.thread_id ? String(message.thread_id) : null,
      messageID: message.id ? String(message.id) : null,
      senderID: message.user_id ? String(message.user_id) : null,
      body: message.text || '',
      timestamp: message.timestamp,
      isGroup: undefined,
      mentions: message.mentions || {},
      ...(extra || {}),
    };
  }

  function afterMessage(data) {
    const message = (data && data.message) || {};
    if (store && typeof store.upsertMessage === 'function' && message.id) {
      try {
        store.upsertMessage({
          itemId: String(message.id),
          threadId: message.thread_id ? String(message.thread_id) : null,
          itemType: message.item_type || null,
          text: typeof message.text === 'string' ? message.text : null,
          userId: message.user_id ? String(message.user_id) : null,
          tsUs: typeof message.timestamp === 'number' ? message.timestamp : null,
          raw: message,
        });
      } catch (ignored) {
        // store fill is best-effort; never break emit
      }
    }
    const replyTo = parseReplyTo(message);
    if (replyTo && !replyTo.authorUserId && replyTo.itemId) {
      replyTo.authorUserId = lookupParentAuthor(replyTo.itemId);
      replyTo.partial = !replyTo.authorUserId;
    }
    const out = [];
    if (replyTo) {
      out.push({
        kind: '__attach',
        patch: (evt) => {
          evt.replyTo = replyTo;
          if (evt.raw && evt.raw.message) {
            evt.raw.message.replyTo = replyTo;
          }
        },
      });
    }
    if (derivedOn) {
      const derived = deriveBotEvents(baseEvent(message, replyTo ? { replyTo } : null), {
        selfId: selfId(), selfUsername,
      });
      derived.forEach((d) => out.push({ kind: d.type, data: toListenData(d) }));
    }
    return out;
  }

  function afterReaction(data) {
    const message = (data && data.message) || {};
    const target = lookupReactionTarget(message.id);
    const out = [];
    if (derivedOn) {
      const derived = deriveBotEvents({
        type: 'reaction',
        threadID: message.thread_id ? String(message.thread_id) : null,
        messageID: message.id ? String(message.id) : null,
        senderID: message.user_id ? String(message.user_id) : null,
        body: message.text || '',
        reaction: message.reaction || null,
      }, { selfId: selfId(), selfUsername, reactionTarget: () => target });
      derived.forEach((d) => out.push({ kind: d.type, data: toListenData(d) }));
    }
    return out;
  }

  function markSystemEmitted(threadId, summary) {
    if (!threadId) {
      return;
    }
    systemEmitted.set(String(threadId), { summary: summary || null, ts: Date.now() });
  }

  // Same occurrence echoing through the legacy thread_update path right after
  // a mapped message:system/group event: suppress content-free duplicates.
  function isCoveredThreadUpdate(payload) {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    const value = payload.value !== undefined ? payload.value : payload.message;
    if (value && typeof value === 'object' && (value.action_log || value.actionLog || value.item)) {
      return false;
    }
    const threadId = payload.thread_id || (value && value.thread_id);
    if (!threadId) {
      return false;
    }
    const marked = systemEmitted.get(String(threadId));
    return Boolean(marked && Date.now() - marked.ts < 5000);
  }

  return { trackThread, noteActionLog, emitMappedActionLog, afterMessage, afterReaction, ring, snapshots, markSystemEmitted, isCoveredThreadUpdate };
}

module.exports = {
  createV3Tracker,
  parseReplyTo,
};