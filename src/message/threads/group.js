/**
 * @alaminnna/ica-unofficial ? message/threads/group
 *
 * RESPONSIBILITY: group admin-gated ops + member/account reads only ?
 *   kick (admin-gated), gated title, member pics, account inspector.
 *   create/add/plain-title/hide live in ./rooms.js (no duplication).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./threads, ./manage, ./rooms, ../../core/device, client.api
 * MUST NOT:       never silently attempt admin actions as non-admin
 *
 * DEBUG: when kick/title fails, start looking here ? admin gate result
 *   first, then endpoint payload shape
 */

'use strict';

const { getThread } = require('./threads');
const { getThreadAdmins } = require('./manage');
const { updateThreadTitle } = require('./rooms');

function withDefaults(client, data) {
  return { _uuid: client.uuid, device_id: client.androidDeviceId, ...(data || {}) };
}

async function resolveUserIds(client, inputs) {
  const list = Array.isArray(inputs) ? inputs : [inputs];
  const out = [];
  for (const input of list) {
    const text = String(input || '').trim().replace(/^@/, '');
    if (!text) {
      continue;
    }
    if (/^\d+$/.test(text)) {
      out.push(text);
    } else if (typeof client.getUserIdFromUsername === 'function') {
      out.push(String(await client.getUserIdFromUsername(text)));
    } else {
      throw new Error('@alaminnna/ica-unofficial: cannot resolve username without user module: ' + text);
    }
  }
  return out;
}

// Permission gate: admin-only endpoints must check FIRST (flow rule:
// non-admin bot gets a readable error, never a raw server 400).
async function requireAdmin(client, threadId) {
  const info = await getThreadAdmins(client, threadId, { refresh: false });
  const me = client.userId ? String(client.userId) : null;
  const isAdmin = me && info.admins.some((a) => String(a.userId) === me);
  if (!isAdmin) {
    throw new Error('@alaminnna/ica-unofficial: bot is not admin of thread ' + threadId + ' (admin-only action)');
  }
  return info;
}

async function removeMember(client, threadId, users) {
  if (!threadId) {
    throw new Error('@alaminnna/ica-unofficial: removeMember needs { threadId, users }');
  }
  await requireAdmin(client, threadId);
  const userIds = await resolveUserIds(client, users);
  if (userIds.length === 0) {
    throw new Error('@alaminnna/ica-unofficial: removeMember needs at least one user');
  }
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/' + threadId + '/remove_users/',
    data: withDefaults(client, { user_ids: JSON.stringify(userIds) }),
    withSignature: false,
  });
  return res && res.status === 'ok';
}

async function setGroupTitle(client, threadId, title) {
  if (!threadId) {
    throw new Error('@alaminnna/ica-unofficial: setGroupTitle needs { threadId, title }');
  }
  await requireAdmin(client, threadId);
  return updateThreadTitle(client, threadId, title);
}

// Self-leave: dedicated leave endpoint first (reference shape {_csrftoken,
// _uuid}, LIVE-CONFIRMED working), falls back to self-removal via remove_users.
async function leaveGroup(client, threadId) {
  if (!threadId) {
    throw new Error('@alaminnna/ica-unofficial: leaveGroup needs { threadId }');
  }
  if (!client.userId) {
    throw new Error('@alaminnna/ica-unofficial: leaveGroup needs a logged-in user id');
  }
  try {
    const res = await client.api.request({
      endpoint: 'direct_v2/threads/' + threadId + '/leave/',
      data: withDefaults(client, { _csrftoken: client.csrftoken }),
      withSignature: false,
    });
    if (res && res.status === 'ok') {
      return { ok: true, via: 'leave' };
    }
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/' + threadId + '/remove_users/',
    data: withDefaults(client, { user_ids: JSON.stringify([String(client.userId)]) }),
    withSignature: false,
  });
  return { ok: Boolean(res && res.status === 'ok'), via: 'remove-self' };
}

function isNotFound(err) {
  return err && (err.name === 'ClientNotFoundError' ||
    String((err && err.message) || err).indexOf('404') !== -1);
}

function inviteCodeFrom(input) {
  const text = String(input || '').trim();
  if (!text) {
    return null;
  }
  const match = text.match(/ig\.me\/j\/([A-Za-z0-9_-]+)/) || text.match(/\/j\/([A-Za-z0-9_-]+)/);
  if (match) {
    return match[1];
  }
  if (/^[A-Za-z0-9_-]{6,}$/.test(text)) {
    return text;
  }
  return null;
}

// Invite-link join: NO confirmed private endpoint exists in any reference
// (Node/Python/Go libs, captured contracts). This resolver follows the link
// with the logged-in session and reports where it lands (thread id when the
// server reveals one) — the join call itself stays disabled until an endpoint
// is confirmed; run .resolvelink live and report the output.
async function resolveGroupInvite(client, input) {
  const code = inviteCodeFrom(input);
  if (!code) {
    throw new Error('@alaminnna/ica-unofficial: resolveGroupInvite needs an ig.me/j/ link or invite code');
  }
  const url = 'https://ig.me/j/' + code + '/';
  let res;
  try {
    res = await client.http.axios.get(url, { maxRedirects: 5, timeout: 20000 });
  } catch (err) {
    if (err && err.response && err.response.headers && err.response.headers.location) {
      const location = String(err.response.headers.location);
      const threadMatch = location.match(/\/direct\/t\/(\d+)/) || location.match(/thread_id=(\d+)/);
      return { code, redirect: location, threadId: threadMatch ? threadMatch[1] : null };
    }
    throw new Error('@alaminnna/ica-unofficial: invite link resolve failed: ' + ((err && err.message) || err));
  }
  const finalUrl = (res.request && res.request.res && res.request.res.responseUrl) || null;
  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
  const threadMatch = (finalUrl && (finalUrl.match(/\/direct\/t\/(\d+)/) || finalUrl.match(/thread_id=(\d+)/))) ||
    body.match(/\/direct\/t\/(\d+)/);
  return {
    code,
    redirect: finalUrl,
    threadId: threadMatch ? threadMatch[1] : null,
    snippet: body.slice(0, 200),
  };
}

// UNVERIFIED join (see above): kept behind resolveGroupInvite evidence.
// Do NOT call until a live .resolink output shows a joinable target.
async function joinGroupInvite(client, input) {
  const code = inviteCodeFrom(input);
  if (!code) {
    throw new Error('@alaminnna/ica-unofficial: joinGroupInvite needs an ig.me/j/ link or invite code');
  }
  throw new Error('@alaminnna/ica-unofficial: join by invite link is not supported (no confirmed endpoint for code ' + code + ')');
}

async function getGroupMembers(client, threadId) {
  const thread = await getThread(client, threadId, { amount: 1 });
  return ((thread && thread.users) || []).map((u) => ({
    userId: u.pk ? String(u.pk) : (u.id ? String(u.id) : null),
    username: u.username || null,
    fullName: u.full_name || null,
    profilePicUrl: u.profile_pic_url || null,
  }));
}

// Honest heuristic inspector: real flags + LABELED bot-likelihood signals
// (no reliable on-platform "is bot" field exists — signals are hints, not verdicts).
async function inspectAccount(client, input) {
  const info = input !== null && typeof input === 'object' && (input.userId || input.username)
    ? await client.getUserInfoByUsername(input.username || input.userId)
    : await client.getUserInfoByUsername(String(input || ''));
  const signals = [];
  if (!info.profilePicUrl) {
    signals.push('no-profile-pic');
  }
  if (Number(info.mediaCount) === 0) {
    signals.push('zero-posts');
  }
  if (Number(info.followerCount) === 0) {
    signals.push('zero-followers');
  }
  if (info.isPrivate && Number(info.followingCount) === 0) {
    signals.push('private-zero-following');
  }
  if (/^\D*\d{4,}$/.test(info.username || '')) {
    signals.push('digits-heavy-username');
  }
  return {
    userId: info.userId,
    username: info.username,
    fullName: info.fullName,
    isPrivate: Boolean(info.isPrivate),
    isVerified: Boolean(info.isVerified),
    isBusiness: Boolean(info.isBusiness),
    followerCount: info.followerCount,
    followingCount: info.followingCount,
    mediaCount: info.mediaCount,
    profilePicUrl: info.profilePicUrl,
    botSignals: signals,
    botLikely: signals.length >= 3,
  };
}

module.exports = {
  requireAdmin,
  resolveUserIds,
  removeMember,
  setGroupTitle,
  leaveGroup,
  joinGroupInvite,
  resolveGroupInvite,
  inviteCodeFrom,
  getGroupMembers,
  inspectAccount,
};
