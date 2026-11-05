/**
 * @alaminnna/ica-unofficial — listening/attribution
 *
 * RESPONSIBILITY: action_log attribution fusion only — pending ring, op mapping,
 *   metadata-event fusion, kick-vs-left resolution (structure first, text second).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing (pure logic; clock injected as nowMs)
 * MUST NOT:       never network; never hardcode locale description strings
 *
 * DEBUG: when group events lack `by`, start looking here — op mapping table
 *   or fusion window vs action_log arrival timing
 */

'use strict';

const OP_TO_EVENT = {
  add_users: 'group:member_join',
  remove_users: 'group:member_leave',
  update_title: 'group:rename',
  update_theme: 'group:theme',
  update_nickname: 'nickname:update',
  update_photo: 'group:photo',
  update_approval: 'group:approval_mode',
};

function normalizeOp(op) {
  return String(op || '').toLowerCase();
}

// Structure-first kick signal: mentions carry remover/victim ids; admin overlap
// and explicit kick markers beat localized description text.
function structuralKickSignal(actionLog, leftIds) {
  const al = actionLog || {};
  const mentions = (al.mentions || []).map(String);
  const left = (leftIds || []).map(String);
  const actorHint = al.actorHint !== undefined && al.actorHint !== null ? String(al.actorHint) : null;
  if (actorHint && left.indexOf(actorHint) === -1 && mentions.indexOf(actorHint) !== -1) {
    return { kicked: true, removedBy: actorHint };
  }
  const victims = mentions.filter((id) => left.indexOf(id) !== -1);
  if (actorHint && victims.length > 0) {
    return { kicked: true, removedBy: actorHint };
  }
  return { kicked: false, removedBy: null };
}

function descriptionKickSignal(description) {
  const text = String(description || '').toLowerCase();
  if (!text) {
    return null;
  }
  if (text.indexOf('remov') !== -1 || text.indexOf('kick') !== -1) {
    return true;
  }
  if (text.indexOf('left') !== -1 || text.indexOf('leave') !== -1) {
    return false;
  }
  return null;
}

function createAttributionRing(options) {
  const opts = options || {};
  const windowMs = opts.windowMs || 30000;
  const pending = [];

  function push(entry, nowMs) {
    const now = nowMs === undefined ? Date.now() : nowMs;
    pending.push({ ...(entry || {}), ts: now });
    while (pending.length > 0 && now - pending[0].ts > windowMs) {
      pending.shift();
    }
  }

  function consume(op, nowMs) {
    const now = nowMs === undefined ? Date.now() : nowMs;
    const target = normalizeOp(op);
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      if (normalizeOp(pending[i].op) === target && now - pending[i].ts <= windowMs) {
        return pending.splice(i, 1)[0];
      }
    }
    return null;
  }

  function fuse(eventType, detail, nowMs) {
    const mapped = OP_TO_EVENT[normalizeOp(detail && detail.op)] || null;
    let op = mapped;
    if (!op) {
      const reverse = {};
      Object.keys(OP_TO_EVENT).forEach((k) => {
        reverse[OP_TO_EVENT[k]] = k;
      });
      op = reverse[String(eventType)] || eventType;
    }
    const entry = consume(op, nowMs);
    if (!entry) {
      return { by: null, summary: null, matched: false };
    }
    return {
      by: entry.actorHint !== undefined && entry.actorHint !== null ? String(entry.actorHint) : null,
      summary: entry.summary || entry.description || null,
      matched: true,
    };
  }

  function resolveLeave(actionLog, leftIds) {
    const structural = structuralKickSignal(actionLog, leftIds);
    if (structural.kicked) {
      return { kind: 'kicked', removedBy: structural.removedBy };
    }
    const textSignal = descriptionKickSignal(actionLog && actionLog.description);
    if (textSignal === true) {
      const hint = actionLog && actionLog.actorHint;
      return { kind: 'kicked', removedBy: hint !== undefined && hint !== null ? String(hint) : null };
    }
    return { kind: 'left', removedBy: null };
  }

  function mapOp(op) {
    return OP_TO_EVENT[normalizeOp(op)] || 'message:system';
  }

  return { push, consume, fuse, resolveLeave, mapOp, pending };
}

module.exports = {
  OP_TO_EVENT,
  createAttributionRing,
  structuralKickSignal,
  descriptionKickSignal,
};