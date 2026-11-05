/**
 * @alaminnna/ica-unofficial — listening/botevents
 *
 * RESPONSIBILITY: derived bot:* events + self flag only — pure computation over
 *   a canonical event (needs selfId/username + optional store lookups injected).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing (pure; lookups injected)
 * MUST NOT:       never network; never mutate the input event
 *
 * DEBUG: when bot:reply_received misses, start looking here — parent author
 *   resolution (inline preview vs store lookup) or selfId mismatch
 */

'use strict';

function eventSelf(event, selfId) {
  if (!selfId) {
    return false;
  }
  const id = String(selfId);
  if (event.senderID && String(event.senderID) === id) {
    return true;
  }
  if (event.by && String(event.by) === id) {
    return true;
  }
  if (event.removedBy && String(event.removedBy) === id) {
    return true;
  }
  return false;
}

function mentionsSelf(event, selfId, selfUsername) {
  const mentions = event.mentions;
  if (mentions && typeof mentions === 'object') {
    const ids = Array.isArray(mentions) ? mentions : Object.keys(mentions);
    if (selfId && ids.map(String).indexOf(String(selfId)) !== -1) {
      return true;
    }
  }
  if (selfUsername && event.body) {
    const re = new RegExp('@' + String(selfUsername).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(String(event.body))) {
      return true;
    }
  }
  return false;
}

// Derived bot:* aliases from one canonical event. lookups: { parentAuthor(itemId),
// reactionTarget(messageId) } — both sync-or-null, never throw.
// Returns array of derived event objects (may be empty).
function deriveBotEvents(event, context) {
  const ctx = context || {};
  const selfId = ctx.selfId ? String(ctx.selfId) : null;
  const out = [];
  const base = { self: eventSelf(event, selfId) };
  const withContext = (type, extra) => ({
    ...event,
    ...base,
    type,
    botContext: { trigger: event.type, sourceEventId: event.messageID || null },
    ...(extra || {}),
  });
  if (event.type === 'message' && event.replyTo) {
    const parentAuthor = event.replyTo.authorUserId ? String(event.replyTo.authorUserId) : null;
    if (parentAuthor && selfId && parentAuthor === selfId && String(event.senderID) !== selfId) {
      out.push(withContext('bot:reply_received'));
    }
  }
  if (event.type === 'reaction' && ctx.reactionTarget) {
    let target = null;
    try {
      target = ctx.reactionTarget(event.messageID);
    } catch (ignored) {
      target = null;
    }
    if (target && target.authorUserId && selfId && String(target.authorUserId) === selfId &&
      String(event.senderID) !== selfId) {
      out.push(withContext('bot:reaction_received', { reactionTarget: target }));
    }
  }
  if ((event.type === 'message' || event.type === 'message:reply') &&
    mentionsSelf(event, selfId, ctx.selfUsername)) {
    out.push(withContext('bot:mentioned'));
  }
  if (event.type === 'message' && event.isGroup === false && event.senderID &&
    (!selfId || String(event.senderID) !== selfId)) {
    out.push(withContext('bot:dm_received'));
  }
  if (event.type === 'group:member_join' && selfId && (event.added || []).map(String).indexOf(selfId) !== -1) {
    out.push(withContext('bot:group_added'));
  }
  return out;
}

module.exports = {
  eventSelf,
  mentionsSelf,
  deriveBotEvents,
};