/**
 * @alaminnna/ica-unofficial — listening/metadata
 *
 * RESPONSIBILITY: pure thread metadata snapshot + diff only — every mutable
 *   thread field becomes a canonical event; unknown field changes become
 *   group:meta_unknown (G1). No IO, no clock.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing (pure)
 * MUST NOT:       never network, never Date.now here (caller stamps time)
 *
 * DEBUG: when rename/photo/theme changes don't emit, start looking here —
 *   extractThreadMeta field paths for the new payload shape
 */

'use strict';

function strList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((v) => String(v && (v.pk !== undefined ? v.pk : v)));
}

function themeKey(theme) {
  if (!theme || typeof theme !== 'object') {
    return theme === undefined || theme === null ? null : String(theme);
  }
  if (theme.id !== undefined && theme.id !== null) {
    return 'id:' + String(theme.id);
  }
  const colors = Array.isArray(theme.colors) ? [...theme.colors].sort() : theme.colors;
  return 'hash:' + JSON.stringify({ ...theme, colors });
}

function imageKey(image) {
  if (!image || typeof image !== 'object') {
    return image === undefined || image === null ? null : String(image);
  }
  return image.media_id || image.mediaId || image.url || JSON.stringify(image);
}

// Defensive snapshot: accepts inbox thread objects, iris thread patches,
// or partial updates. Missing fields stay undefined (never diffed).
function extractThreadMeta(raw) {
  const data = raw || {};
  const meta = {};
  if (data.thread_id !== undefined) {
    meta.threadId = String(data.thread_id);
  } else if (data.threadId !== undefined) {
    meta.threadId = String(data.threadId);
  }
  if (data.thread_title !== undefined) {
    meta.title = data.thread_title === null ? null : String(data.thread_title);
  } else if (data.title !== undefined) {
    meta.title = data.title === null ? null : String(data.title);
  }
  if (data.thread_image_url !== undefined || data.thread_image !== undefined) {
    meta.image = imageKey(data.thread_image_url !== undefined ? data.thread_image_url : data.thread_image);
  }
  if (data.thread_theme !== undefined || data.theme !== undefined) {
    meta.theme = themeKey(data.thread_theme !== undefined ? data.thread_theme : data.theme);
  }
  if (Array.isArray(data.users)) {
    meta.users = strList(data.users);
  }
  if (Array.isArray(data.left_users)) {
    meta.leftUsers = strList(data.left_users);
  } else if (Array.isArray(data.leftUsers)) {
    meta.leftUsers = strList(data.leftUsers);
  }
  if (Array.isArray(data.admin_user_ids)) {
    meta.admins = data.admin_user_ids.map(String);
  } else if (Array.isArray(data.admins)) {
    meta.admins = data.admins.map(String);
  }
  if (data.nickname_map !== undefined || data.nicknames !== undefined) {
    const map = data.nickname_map !== undefined ? data.nickname_map : data.nicknames;
    meta.nicknames = {};
    if (map && typeof map === 'object') {
      Object.keys(map).forEach((k) => {
        meta.nicknames[String(k)] = map[k] === null || map[k] === undefined ? null : String(map[k]);
      });
    }
  } else if (Array.isArray(data.users)) {
    const map = {};
    let found = false;
    data.users.forEach((u) => {
      if (u && typeof u === 'object' && (u.nickname !== undefined || u.nick_name !== undefined)) {
        found = true;
        const nick = u.nickname !== undefined ? u.nickname : u.nick_name;
        map[String(u.pk !== undefined ? u.pk : u)] = nick === null || nick === undefined ? null : String(nick);
      }
    });
    if (found) {
      meta.nicknames = map;
    }
  }
  if (data.approval_required_for_new_members !== undefined) {
    meta.approvalRequired = Boolean(data.approval_required_for_new_members);
  } else if (data.approval_required !== undefined) {
    meta.approvalRequired = Boolean(data.approval_required);
  }
  if (data.viewer_id !== undefined) {
    meta.viewerId = String(data.viewer_id);
  }
  if (data.thread_type !== undefined) {
    meta.threadType = String(data.thread_type);
  }
  const known = new Set(['thread_id', 'threadId', 'thread_title', 'title', 'thread_image_url',
    'thread_image', 'thread_theme', 'theme', 'users', 'left_users', 'leftUsers',
    'admin_user_ids', 'admins', 'nickname_map', 'nicknames', 'approval_required_for_new_members',
    'approval_required', 'viewer_id', 'thread_type', 'items', 'items_seen_at', 'pending',
    'is_group', 'thread_v2_id', 'last_activity_at', 'muted', 'vc_muted', 'read_state']);
  meta.unknown = {};
  Object.keys(data).forEach((k) => {
    if (!known.has(k)) {
      meta.unknown[k] = data[k];
    }
  });
  return meta;
}

function diffLists(prev, next) {
  const before = new Set(prev || []);
  const after = new Set(next || []);
  return {
    added: (next || []).filter((v) => !before.has(v)),
    removed: (prev || []).filter((v) => !after.has(v)),
  };
}

function diffNicknames(prev, next) {
  const changes = [];
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  keys.forEach((userId) => {
    const old = prev ? prev[userId] : undefined;
    const now = next ? next[userId] : undefined;
    if (old !== now) {
      changes.push({ userId, old: old === undefined ? null : old, new: now === undefined ? null : now });
    }
  });
  return changes;
}

// Pure diff: prev null = baseline (no events). Returns canonical event descriptors.
function diffMeta(prev, next) {
  const events = [];
  if (!prev || !next) {
    return events;
  }
  if (next.title !== undefined && prev.title !== undefined && next.title !== prev.title) {
    events.push({ type: 'group:rename', old: prev.title, new: next.title });
  }
  if (next.image !== undefined && prev.image !== undefined && next.image !== prev.image) {
    events.push({ type: 'group:photo', old: prev.image, new: next.image });
  }
  if (next.theme !== undefined && prev.theme !== undefined && next.theme !== prev.theme) {
    events.push({ type: 'group:theme', old: prev.theme, new: next.theme });
  }
  if (next.users !== undefined && prev.users !== undefined) {
    const d = diffLists(prev.users, next.users);
    if (d.added.length > 0) {
      events.push({ type: 'group:member_join', added: d.added });
    }
  }
  if (next.leftUsers !== undefined && prev.leftUsers !== undefined) {
    const d = diffLists(prev.leftUsers, next.leftUsers);
    if (d.added.length > 0) {
      events.push({ type: 'group:member_leave', left: d.added, kind: 'left' });
    }
  }
  if (next.admins !== undefined && prev.admins !== undefined) {
    const d = diffLists(prev.admins, next.admins);
    if (d.added.length > 0 || d.removed.length > 0) {
      events.push({ type: 'admin:update', added: d.added, removed: d.removed });
    }
  }
  if (next.nicknames !== undefined && prev.nicknames !== undefined) {
    diffNicknames(prev.nicknames, next.nicknames).forEach((change) => {
      events.push({ type: 'nickname:update', user: change.userId, old: change.old, new: change.new });
    });
  }
  if (next.approvalRequired !== undefined && prev.approvalRequired !== undefined &&
    next.approvalRequired !== prev.approvalRequired) {
    events.push({ type: 'group:approval_mode', enabled: next.approvalRequired });
  }
  const prevUnknown = prev.unknown || {};
  const nextUnknown = next.unknown || {};
  const unknownKeys = new Set([...Object.keys(prevUnknown), ...Object.keys(nextUnknown)]);
  unknownKeys.forEach((field) => {
    const a = JSON.stringify(prevUnknown[field] === undefined ? null : prevUnknown[field]);
    const b = JSON.stringify(nextUnknown[field] === undefined ? null : nextUnknown[field]);
    if (a !== b) {
      events.push({ type: 'group:meta_unknown', field, old: prevUnknown[field] || null, new: nextUnknown[field] || null });
    }
  });
  return events;
}

module.exports = {
  extractThreadMeta,
  diffMeta,
  diffLists,
  themeKey,
};