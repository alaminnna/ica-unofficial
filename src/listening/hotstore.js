/**
 * @alaminnna/ica-unofficial — listening/hotstore
 *
 * RESPONSIBILITY: in-memory hot tier for the listening store — a bounded TTL
 *   cache of recent messages plus a zero-disk "memory" store that implements
 *   the same interface as the SQLite store.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:fs, node:path (mkdir/stat only; memory store never touches disk)
 * MUST NOT:       never network here; never import feature mixins
 *
 * DEBUG: if reply/reaction attribution works while running but breaks right
 *   after a restart, the entry aged out of the hot tier before it was flushed
 *   — raise retentionHours/maxMessages or pass your own listeningStore.
 */

'use strict';

const DEFAULT_HOT_CAP = 4000;
const DEFAULT_HOT_TTL_MS = 24 * 3600 * 1000;

/**
 * Bounded TTL map of recent messages. Every mode (disk or memory) reads
 * attribution data from here first, so the per-message hot path never pays
 * for a SQLite round-trip.
 *
 * Entries carry the slim attribution columns only (never the raw payload —
 * raw JSON is the bloat, `user_id` is the only field the library reads back).
 */
function createHotMessages(options) {
  const opts = options || {};
  const cap = Math.max(1, Number(opts.cap) > 0 ? Math.floor(Number(opts.cap)) : DEFAULT_HOT_CAP);
  const ttlMs = Math.max(1000, Number(opts.ttlMs) > 0 ? Math.floor(Number(opts.ttlMs)) : DEFAULT_HOT_TTL_MS);
  const map = new Map();

  function prune(nowMs) {
    const now = nowMs === undefined ? Date.now() : nowMs;
    map.forEach((entry, key) => {
      if (now - entry.at > ttlMs) {
        map.delete(key);
      }
    });
    while (map.size > cap) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  return {
    cap,
    ttlMs,
    get size() {
      return map.size;
    },
    set(entry) {
      map.set(String(entry.itemId), {
        itemId: String(entry.itemId),
        threadId: entry.threadId || null,
        itemType: entry.itemType || null,
        text: entry.text === undefined ? null : entry.text,
        userId: entry.userId || null,
        tsUs: entry.tsUs === undefined || entry.tsUs === null ? null : Number(entry.tsUs),
        raw: entry.raw === undefined ? null : entry.raw,
        isEdited: entry.isEdited ? 1 : 0,
        isDeleted: entry.isDeleted ? 1 : 0,
        parentItemId: entry.parentItemId || null,
        isSelf: entry.isSelf ? 1 : 0,
        at: entry.at === undefined ? Date.now() : entry.at,
      });
      if (map.size > cap) {
        prune();
      }
    },
    get(itemId) {
      return map.get(String(itemId)) || null;
    },
    /** Hot entries for one thread, oldest first (for threadMessages merge). */
    forThread(threadId) {
      const rows = [];
      map.forEach((entry) => {
        if (entry.threadId === String(threadId)) {
          rows.push(entry);
        }
      });
      rows.sort((a, b) => (a.tsUs || 0) - (b.tsUs || 0));
      return rows;
    },
    markDeleted(itemId, nowMs) {
      const entry = map.get(String(itemId));
      if (entry) {
        entry.isDeleted = 1;
      }
    },
    prune,
  };
}

function toRow(entry) {
  return {
    item_id: entry.itemId,
    thread_id: entry.threadId,
    item_type: entry.itemType,
    text: entry.text,
    user_id: entry.userId,
    ts_us: entry.tsUs,
    raw: entry.raw === undefined ? null : entry.raw,
    is_edited: entry.isEdited ? 1 : 0,
    is_deleted: entry.isDeleted ? 1 : 0,
    created_at: entry.at,
    parent_item_id: entry.parentItemId,
    is_self: entry.isSelf ? 1 : 0,
  };
}

/**
 * Zero-disk store: same interface as the SQLite store, no files anywhere.
 * Everything lives in bounded Maps, so `store: 'memory'` keeps reply/reaction
 * attribution working without ever writing a byte to disk.
 */
function createMemoryStore(options) {
  const opts = options || {};
  const hot = createHotMessages({ cap: opts.hotCap, ttlMs: opts.hotTtlMs });
  const kv = new Map();
  const threads = new Map();
  const reactions = new Map();
  const outbox = [];
  const fixtures = new Map();
  const reactionKey = (itemId, emoji, userId) => `${String(itemId)}|${String(emoji)}|${String(userId)}`;
  let outboxSeq = 0;
  const now = () => Date.now();

  return {
    mode: 'memory',
    file: null,
    flush() {
      return 0;
    },
    close() {},
    kvGet(key) {
      const v = kv.get(String(key));
      return v === undefined ? null : v;
    },
    kvSet(key, value) {
      kv.set(String(key), String(value));
    },
    upsertThread(thread) {
      const t = thread || {};
      threads.set(String(t.threadId), { ...(threads.get(String(t.threadId)) || {}), snapshot: t.snapshot || null, members: t.members || null, leftUsers: t.leftUsers || null, admins: t.admins || null, title: t.title || null, pic: t.pic || null, updatedAt: now() });
    },
    getThread(threadId) {
      const t = threads.get(String(threadId));
      if (!t) {
        return null;
      }
      return { thread_v2_id: String(threadId), snapshot: t.snapshot, members: t.members, left_users: t.leftUsers, admins: t.admins, title: t.title, pic: t.pic, updated_at: t.updatedAt };
    },
    upsertMessage(message) {
      const m = message || {};
      if (!m.itemId) {
        return;
      }
      hot.set({
        itemId: String(m.itemId),
        threadId: m.threadId || null,
        itemType: m.itemType || null,
        text: typeof m.text === 'string' ? m.text : null,
        userId: m.userId || null,
        tsUs: m.tsUs,
        raw: m.raw === undefined ? null : (typeof m.raw === 'string' ? m.raw : JSON.stringify(m.raw)),
        isEdited: m.isEdited,
        isDeleted: m.isDeleted,
        parentItemId: m.parentItemId,
        isSelf: m.isSelf,
      });
    },
    getMessage(itemId) {
      const entry = hot.get(itemId);
      return entry ? toRow(entry) : null;
    },
    markMessageDeleted(itemId) {
      hot.markDeleted(itemId);
    },
    threadMessages(threadId, limit) {
      return hot.forThread(threadId).map(toRow).slice(0, limit || 200);
    },
    upsertReaction(reaction) {
      const r = reaction || {};
      reactions.set(reactionKey(r.itemId, r.emoji, r.userId), { itemId: String(r.itemId), emoji: String(r.emoji), userId: String(r.userId), addedAt: now(), removedAt: null });
    },
    removeReaction(itemId, emoji, userId) {
      const entry = reactions.get(reactionKey(itemId, emoji, userId));
      if (entry) {
        entry.removedAt = now();
      }
    },
    itemReactions(itemId) {
      return [...reactions.values()].filter((r) => r.item_id === String(itemId) && r.removedAt === null)
        .map((r) => ({ item_id: r.itemId, emoji: r.emoji, user_id: r.userId, added_at: r.addedAt, removed_at: r.removedAt }));
    },
    outboxInsert(eventKey, type, payload) {
      const key = String(eventKey);
      if (outbox.some((e) => e.event_key === key)) {
        return null;
      }
      outboxSeq += 1;
      outbox.push({ id: outboxSeq, event_key: key, type: String(type), payload: JSON.stringify(payload === undefined ? null : payload), status: 'pending', attempts: 0, created_at: now(), delivered_at: null });
      return outboxSeq;
    },
    outboxPending(limit) {
      return outbox.filter((e) => e.status === 'pending').slice(0, limit || 100)
        .map((e) => ({ ...e }));
    },
    outboxAck(id) {
      const e = outbox.find((x) => x.id === Number(id));
      if (e) {
        e.status = 'delivered';
        e.delivered_at = now();
      }
    },
    outboxFail(id) {
      const e = outbox.find((x) => x.id === Number(id));
      if (e) {
        e.status = 'deadletter';
        e.attempts += 1;
      }
    },
    outboxBump(id) {
      const e = outbox.find((x) => x.id === Number(id));
      if (e) {
        e.attempts += 1;
      }
    },
    fixtureSave(name, raw) {
      fixtures.set(String(name), typeof raw === 'string' ? raw : JSON.stringify(raw));
    },
    fixtureGet(name) {
      const v = fixtures.get(String(name));
      return v === undefined ? null : v;
    },
    prune() {
      hot.prune();
      const cutoff = now() - 7 * 24 * 3600 * 1000;
      for (let i = outbox.length - 1; i >= 0; i -= 1) {
        if (outbox[i].status === 'delivered' && outbox[i].delivered_at < cutoff) {
          outbox.splice(i, 1);
        }
      }
    },
    stats() {
      let reactionsLive = 0;
      reactions.forEach((r) => {
        if (r.removedAt === null) {
          reactionsLive += 1;
        }
      });
      return {
        mode: 'memory',
        file: null,
        schemaVersion: null,
        sizeBytes: 0,
        messages: hot.size,
        threads: threads.size,
        reactions: reactionsLive,
        outbox: outbox.length,
        hot: { size: hot.size, cap: hot.cap, ttlMs: hot.ttlMs },
        dirty: 0,
      };
    },
  };
}

module.exports = {
  DEFAULT_HOT_CAP,
  DEFAULT_HOT_TTL_MS,
  createHotMessages,
  createMemoryStore,
  toRow,
};
