/**
 * @alaminnna/ica-unofficial — user/cache
 * 
 * RESPONSIBILITY: in-memory LRU+TTL identity cache (userId→username).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing
 * MUST NOT:       never do network here
 * 
 * DEBUG: when logs show raw ids instead of names, start looking here — TTL/eviction
 */

'use strict';

function createIdentityCache(options) {
  const opts = options || {};
  const max = opts.max || 100;
  const ttlMs = opts.ttlMs || 3600000;
  const store = new Map();
  return {
    get(userId) {
      const key = String(userId);
      const entry = store.get(key);
      if (!entry) {
        return null;
      }
      if (Date.now() - entry.at > ttlMs) {
        store.delete(key);
        return null;
      }
      return entry.username;
    },
    set(userId, username) {
      const key = String(userId);
      if (store.has(key)) {
        store.delete(key);
      }
      store.set(key, { username: String(username), at: Date.now() });
      while (store.size > max) {
        const oldest = store.keys().next().value;
        store.delete(oldest);
      }
    },
    stats() {
      return { size: store.size, max, ttlMs };
    },
  };
}

module.exports = { createIdentityCache };