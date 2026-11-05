/**
 * @alaminnna/ica-unofficial — listening/store
 *
 * RESPONSIBILITY: sqlite snapshot store only — kv cursors, threads, messages,
 *   reactions, outbox, fixtures (+migrations, retention prune, WAL).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        better-sqlite3, node:fs, node:path
 * MUST NOT:       never network here; never import feature mixins
 *
 * DEBUG: when cursors reset or events replay, start looking here — db file
 *   location (consumer cwd/ica-alaminnna) or schema_ver migrations
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_DIR_NAME = 'ica-alaminnna';
const STORE_FILE_NAME = 'ica-unofficial.db';
const SCHEMA_VERSION = 2;

// Consumer project root (their cwd) → ./ica-alaminnna/ica-unofficial.db
function resolveStorePaths(options) {
  const opts = options || {};
  const dir = opts.dir || path.resolve(process.cwd(), STORE_DIR_NAME);
  const file = opts.file || path.join(dir, STORE_FILE_NAME);
  return { dir, file };
}

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
];

function openStore(options) {
  const opts = options || {};
  const { dir, file } = resolveStorePaths(opts);
  fs.mkdirSync(dir, { recursive: true });
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (err) {
    throw new Error('@alaminnna/ica-unofficial: listening store needs better-sqlite3: npm install better-sqlite3');
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
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

  const now = () => Date.now();

  return {
    file,
    close() {
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
    upsertMessage(message) {
      const m = message || {};
      db.prepare(`INSERT INTO messages (item_id, thread_id, item_type, text, user_id, ts_us, raw, is_edited, is_deleted, created_at, parent_item_id, is_self)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET thread_id = excluded.thread_id, item_type = excluded.item_type,
        text = excluded.text, user_id = excluded.user_id, ts_us = excluded.ts_us, raw = excluded.raw,
        is_edited = excluded.is_edited, is_deleted = excluded.is_deleted,
        parent_item_id = excluded.parent_item_id, is_self = excluded.is_self`)
        .run(m.itemId, m.threadId || null, m.itemType || null, m.text || null, m.userId || null,
          m.tsUs === undefined || m.tsUs === null ? null : Number(m.tsUs),
          m.raw === undefined ? null : JSON.stringify(m.raw),
          m.isEdited ? 1 : 0, m.isDeleted ? 1 : 0, now(),
          m.parentItemId || null, m.isSelf ? 1 : 0);
    },
    getMessage(itemId) {
      return db.prepare('SELECT * FROM messages WHERE item_id = ?').get(String(itemId)) || null;
    },
    markMessageDeleted(itemId) {
      db.prepare('UPDATE messages SET is_deleted = 1 WHERE item_id = ?').run(String(itemId));
    },
    threadMessages(threadId, limit) {
      return db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY ts_us ASC LIMIT ?')
        .all(String(threadId), limit || 200);
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
    prune(retentionDays) {
      const cutoff = now() - (retentionDays || 14) * 24 * 3600 * 1000;
      db.prepare('DELETE FROM messages WHERE created_at < ?').run(cutoff);
      db.prepare("DELETE FROM outbox WHERE status = 'delivered' AND delivered_at < ?").run(now() - 7 * 24 * 3600 * 1000);
    },
  };
}

module.exports = {
  STORE_DIR_NAME,
  STORE_FILE_NAME,
  SCHEMA_VERSION,
  resolveStorePaths,
  openStore,
};