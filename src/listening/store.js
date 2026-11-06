/**
 * @alaminnna/ica-unofficial — listening/store
 *
 * RESPONSIBILITY: tiered snapshot store — in-memory hot tier (instant reads,
 *   batched writes) over a bounded SQLite cold tier. Cursors, threads,
 *   reactions, outbox, fixtures (+migrations, retention prune, WAL).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        better-sqlite3, node:fs, node:path, ./hotstore
 * MUST NOT:       never network here; never import feature mixins
 *
 * DEBUG: when cursors reset or events replay, start looking here — db file
 *   location (consumer cwd/ica-alaminnna), mode config, or schema_ver
 *   migrations. If the DB grows unbounded you are in 'full' mode.
 *
 * MODES (openStore options.mode):
 *   'smart'  default — bounded disk: last maxMessages (2000) within
 *            retentionHours (24), raw payloads never persisted. Tiny DB that
 *            still recovers reply/reaction attribution across restarts.
 *   'full'   legacy 2.9.1 behaviour — raw payloads persisted, 14-day
 *            retention, 50k messages. Only for bots that query history.
 *   'memory' no disk at all (see ./hotstore createMemoryStore).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHotMessages, createMemoryStore, toRow } = require('./hotstore');

const STORE_DIR_NAME = 'ica-alaminnna';
const STORE_FILE_NAME = 'ica-unofficial.db';
const SCHEMA_VERSION = 3;
const MODES = ['smart', 'full'];
const FLUSH_BATCH = 250;

// Consumer project root (their cwd) → ./ica-alaminnna/ica-unofficial.db
function resolveStorePaths(options) {
  const opts = options || {};
  const dir = opts.dir || path.resolve(process.cwd(), STORE_DIR_NAME);
  const file = opts.file || path.join(dir, STORE_FILE_NAME);
  return { dir, file };
}

const MODE_DEFAULTS = {
  smart: { retentionHours: 24, maxMessages: 2000, persistRaw: false, hotCap: 4000, hotTtlMs: 24 * 3600 * 1000 },
  full: { retentionHours: 14 * 24, maxMessages: 50000, persistRaw: true, hotCap: 8000, hotTtlMs: 24 * 3600 * 1000 },
};

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS threads (
    thread_v2_id TEXT PRIMARY KEY,
    snapshot TEXT, members TEXT, left_users TEXT, admins TEXT,
    title TEXT, pic TEXT, updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS messages (
    item_id TEXT PRIMARY KEY,
    thread_id TEXT, item_type TEXT, text TEXT, user_id TEXT,
    ts_us INTEGER, raw TEXT, is_edited INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0, created_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS reactions (
    item_id TEXT, emoji TEXT, user_id TEXT,
    added_at INTEGER, removed_at INTEGER,
    PRIMARY KEY (item_id, emoji, user_id)
  );
  CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT UNIQUE, type TEXT, payload TEXT,
    status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0,
    created_at INTEGER, delivered_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS fixtures (name TEXT PRIMARY KEY, raw TEXT);
  CREATE INDEX IF NOT EXISTS idx_messages_thread_ts ON messages (thread_id, ts_us);
  CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);
  `,
  `
  ALTER TABLE threads ADD COLUMN viewer_id TEXT;
  ALTER TABLE threads ADD COLUMN theme TEXT;
  ALTER TABLE threads ADD COLUMN nickname_map TEXT;
  ALTER TABLE threads ADD COLUMN approval_required INTEGER;
  ALTER TABLE threads ADD COLUMN thread_image TEXT;
  ALTER TABLE threads ADD COLUMN meta_raw TEXT;
  ALTER TABLE messages ADD COLUMN parent_item_id TEXT;
  ALTER TABLE messages ADD COLUMN is_self INTEGER DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages (parent_item_id);
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages (created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages (ts_us);
  `,
];

function openStore(options) {
  if (typeof options === 'string') {
    if (options === 'memory') {
      return createMemoryStore({});
    }
    throw new Error(`@alaminnna/ica-unofficial: unknown listening store option '${options}' (use false | 'memory' | { mode: 'smart' | 'full', ... })`);
  }
  const opts = options || {};
  if (opts.mode === 'memory') {
    return createMemoryStore(opts);
  }
  const mode = opts.mode || 'smart';
  if (!MODES.includes(mode)) {
    throw new Error(`@alaminnna/ica-unofficial: unknown listening store mode '${mode}' (valid: smart | full | memory)`);
  }
  const defaults = MODE_DEFAULTS[mode];
  const cfg = {
    retentionHours: opts.retentionHours !== undefined ? Number(opts.retentionHours) : defaults.retentionHours,
    maxMessages: opts.maxMessages !== undefined ? Math.max(1, Math.floor(Number(opts.maxMessages))) : defaults.maxMessages,
    persistRaw: opts.persistRaw !== undefined ? Boolean(opts.persistRaw) : defaults.persistRaw,
    flushMs: opts.flushMs !== undefined ? Math.max(250, Math.floor(Number(opts.flushMs))) : 2000,
  };
  const hot = createHotMessages({
    cap: opts.hotCap !== undefined ? opts.hotCap : defaults.hotCap,
    ttlMs: opts.hotTtlMs !== undefined ? opts.hotTtlMs : defaults.hotTtlMs,
  });

  const { dir, file } = resolveStorePaths(opts);
  fs.mkdirSync(dir, { recursive: true });
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (err) {
    throw new Error(`@alaminnna/ica-unofficial: listening store needs better-sqlite3: npm install better-sqlite3 (or use store: 'memory')`);
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(MIGRATIONS[0]);
  const versionRow = db.prepare('SELECT v FROM kv WHERE k = ?').get('schema_ver');
  const version = versionRow ? Number(versionRow.v) || 0 : 0;
  if (version === 0) {
    db.prepare('INSERT INTO kv (k, v) VALUES (?, ?)').run('schema_ver', '1');
  }
  for (let v = Math.max(version, 1); v < MIGRATIONS.length; v += 1) {
    db.exec(MIGRATIONS[v]);
  }
  db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .run('schema_ver', String(SCHEMA_VERSION));
  // The smart tier never reads raw payloads — drop what legacy 'full' mode
  // left behind so old databases shrink on first open instead of growing.
  if (!cfg.persistRaw) {
    db.exec('UPDATE messages SET raw = NULL WHERE raw IS NOT NULL');
  }

  const now = () => Date.now();
  const dirty = new Map(); // item_id -> slim row, flushed to disk in one transaction
  let flushTimer = null;

  const insertStmt = db.prepare(`INSERT INTO messages (item_id, thread_id, item_type, text, user_id, ts_us, raw, is_edited, is_deleted, created_at, parent_item_id, is_self)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET thread_id = excluded.thread_id, item_type = excluded.item_type,
    text = excluded.text, user_id = excluded.user_id, ts_us = excluded.ts_us,
    is_edited = excluded.is_edited, is_deleted = excluded.is_deleted,
    parent_item_id = excluded.parent_item_id, is_self = excluded.is_self`);

  function enforceMessageCap() {
    db.prepare(`DELETE FROM messages WHERE item_id NOT IN (
      SELECT item_id FROM messages ORDER BY ts_us DESC LIMIT ?
    )`).run(cfg.maxMessages);
  }

  function flush() {
    if (dirty.size === 0) {
      return 0;
    }
    const rows = [...dirty.values()];
    dirty.clear();
    db.transaction(() => {
      rows.forEach((r) => {
        insertStmt.run(r.itemId, r.threadId, r.itemType, r.text, r.userId, r.tsUs, r.raw, r.isEdited, r.isDeleted, r.at, r.parentItemId, r.isSelf);
      });
    })();
    enforceMessageCap();
    return rows.length;
  }

  function scheduleFlush() {
    if (flushTimer) {
      return;
    }
    flushTimer = setInterval(() => {
      try {
        flush();
      } catch (ignored) {
        // background flush is best-effort; hot tier keeps serving reads
      }
    }, cfg.flushMs);
    if (flushTimer.unref) {
      flushTimer.unref();
    }
  }

  function stageMessage(message) {
    const m = message || {};
    if (!m.itemId) {
      return;
    }
    const entry = {
      itemId: String(m.itemId),
      threadId: m.threadId || null,
      itemType: m.itemType || null,
      text: typeof m.text === 'string' ? m.text : null,
      userId: m.userId || null,
      tsUs: m.tsUs === undefined || m.tsUs === null ? null : Number(m.tsUs),
      raw: cfg.persistRaw ? (m.raw === undefined ? null : (typeof m.raw === 'string' ? m.raw : JSON.stringify(m.raw))) : null,
      isEdited: m.isEdited ? 1 : 0,
      isDeleted: m.isDeleted ? 1 : 0,
      parentItemId: m.parentItemId || null,
      isSelf: m.isSelf ? 1 : 0,
      at: now(),
    };
    hot.set({ ...entry, raw: m.raw });
    dirty.set(entry.itemId, entry);
    if (dirty.size >= FLUSH_BATCH) {
      flush();
    } else {
      scheduleFlush();
    }
  }

  function count(table) {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  }

  scheduleFlush();

  return {
    mode,
    file,
    flush,
    close() {
      if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
      }
      try {
        flush();
      } catch (ignored) {
        // teardown is best-effort
      }
      db.close();
    },
    kvGet(key) {
      const row = db.prepare('SELECT v FROM kv WHERE k = ?').get(String(key));
      return row ? row.v : null;
    },
    kvSet(key, value) {
      db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
        .run(String(key), String(value));
    },
    upsertThread(thread) {
      const t = thread || {};
      db.prepare(`INSERT INTO threads (thread_v2_id, snapshot, members, left_users, admins, title, pic, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_v2_id) DO UPDATE SET snapshot = excluded.snapshot, members = excluded.members,
        left_users = excluded.left_users, admins = excluded.admins, title = excluded.title,
        pic = excluded.pic, updated_at = excluded.updated_at`)
        .run(t.threadId, t.snapshot || null, t.members || null, t.leftUsers || null,
          t.admins || null, t.title || null, t.pic || null, now());
    },
    getThread(threadId) {
      return db.prepare('SELECT * FROM threads WHERE thread_v2_id = ?').get(String(threadId)) || null;
    },
    upsertMessage: stageMessage,
    getMessage(itemId) {
      const id = String(itemId);
      const entry = hot.get(id);
      if (entry) {
        return toRow(entry);
      }
      const row = db.prepare('SELECT * FROM messages WHERE item_id = ?').get(id) || null;
      if (row) {
        hot.set({ itemId: row.item_id, threadId: row.thread_id, itemType: row.item_type, text: row.text,
          userId: row.user_id, tsUs: row.ts_us, raw: row.raw, isEdited: row.is_edited, isDeleted: row.is_deleted,
          parentItemId: row.parent_item_id, isSelf: row.is_self, at: row.created_at || now() });
      }
      return row;
    },
    markMessageDeleted(itemId) {
      hot.markDeleted(itemId);
      const prev = dirty.get(String(itemId)) || hot.get(String(itemId)) || { itemId: String(itemId) };
      dirty.set(String(itemId), { ...prev, isDeleted: 1 });
      scheduleFlush();
    },
    threadMessages(threadId, limit) {
      const cap = limit || 200;
      const rows = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY ts_us ASC LIMIT ?')
        .all(String(threadId), cap);
      const seen = new Set(rows.map((r) => r.item_id));
      hot.forThread(threadId).forEach((entry) => {
        if (!seen.has(entry.itemId) && rows.length < cap) {
          rows.push(toRow(entry));
        }
      });
      rows.sort((a, b) => (a.ts_us || 0) - (b.ts_us || 0));
      return rows.slice(0, cap);
    },
    upsertReaction(reaction) {
      const r = reaction || {};
      db.prepare(`INSERT INTO reactions (item_id, emoji, user_id, added_at, removed_at)
        VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(item_id, emoji, user_id) DO UPDATE SET added_at = excluded.added_at, removed_at = NULL`)
        .run(r.itemId, r.emoji, r.userId, now());
    },
    removeReaction(itemId, emoji, userId) {
      db.prepare('UPDATE reactions SET removed_at = ? WHERE item_id = ? AND emoji = ? AND user_id = ?')
        .run(now(), String(itemId), String(emoji), String(userId));
    },
    itemReactions(itemId) {
      return db.prepare('SELECT * FROM reactions WHERE item_id = ? AND removed_at IS NULL').all(String(itemId));
    },
    outboxInsert(eventKey, type, payload) {
      try {
        const info = db.prepare(`INSERT INTO outbox (event_key, type, payload, status, attempts, created_at, delivered_at)
          VALUES (?, ?, ?, 'pending', 0, ?, NULL)`).run(String(eventKey), String(type), JSON.stringify(payload === undefined ? null : payload), now());
        return Number(info.lastInsertRowid);
      } catch (err) {
        if (err && String(err.code) === 'SQLITE_CONSTRAINT_UNIQUE') {
          return null;
        }
        throw err;
      }
    },
    outboxPending(limit) {
      return db.prepare("SELECT * FROM outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?").all(limit || 100);
    },
    outboxAck(id) {
      db.prepare("UPDATE outbox SET status = 'delivered', delivered_at = ? WHERE id = ?").run(now(), Number(id));
    },
    outboxFail(id) {
      db.prepare("UPDATE outbox SET status = 'deadletter', attempts = attempts + 1 WHERE id = ?").run(Number(id));
    },
    outboxBump(id) {
      db.prepare('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?').run(Number(id));
    },
    fixtureSave(name, raw) {
      db.prepare('INSERT INTO fixtures (name, raw) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET raw = excluded.raw')
        .run(String(name), typeof raw === 'string' ? raw : JSON.stringify(raw));
    },
    fixtureGet(name) {
      const row = db.prepare('SELECT raw FROM fixtures WHERE name = ?').get(String(name));
      return row ? row.raw : null;
    },
    prune(retentionDaysArg) {
      const retentionMs = retentionDaysArg === undefined || retentionDaysArg === null
        ? cfg.retentionHours * 3600 * 1000
        : Number(retentionDaysArg) * 24 * 3600 * 1000;
      const cutoff = now() - Math.max(0, retentionMs);
      db.prepare('DELETE FROM messages WHERE created_at < ?').run(cutoff);
      db.prepare("DELETE FROM outbox WHERE status = 'delivered' AND delivered_at < ?").run(now() - 7 * 24 * 3600 * 1000);
      enforceMessageCap();
      hot.prune();
    },
    stats() {
      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(file).size;
      } catch (ignored) {
        // file not yet materialized
      }
      return {
        mode,
        file,
        schemaVersion: SCHEMA_VERSION,
        sizeBytes,
        messages: count('messages'),
        threads: count('threads'),
        reactions: count('reactions'),
        outbox: count('outbox'),
        hot: { size: hot.size, cap: hot.cap, ttlMs: hot.ttlMs },
        dirty: dirty.size,
        config: { ...cfg },
      };
    },
  };
}

module.exports = {
  STORE_DIR_NAME,
  STORE_FILE_NAME,
  SCHEMA_VERSION,
  MODES,
  resolveStorePaths,
  openStore,
};
