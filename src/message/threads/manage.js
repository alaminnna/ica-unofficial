/**
 * @alaminnna/ica-unofficial — message/threads/manage
 * 
 * RESPONSIBILITY: thread-level writes: unsend/delete/seen/typing.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../sending/send, ./threads, client.api, client._realtime
 * MUST NOT:       never implement transport here
 * 
 * DEBUG: when seen never marks or typing is a no-op, start looking here — realtime vs HTTP path
 */

'use strict';

const { unsendMessage } = require('../sending/send');
const { markThreadSeen, getThread } = require('./threads');
const { sleep } = require('../../core/delays');

async function deleteMessage(client, threadId, messageId) {
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/' + threadId + '/items/' + messageId + '/delete/',
    data: { _uuid: client.uuid },
  });
  return ((res || {}).status || '') === 'ok';
}

async function setTyping(client, threadId, on) {
  if (on !== false) {
    if (typeof client.sendTyping === 'function') {
      return client.sendTyping(threadId);
    }
    return false;
  }
  const rt = client._realtime;
  if (rt && typeof rt.indicateActivity === 'function') {
    await rt.indicateActivity(threadId, false);
    return true;
  }
  return true;
}

async function resolveAdminNames(client, adminIds, users) {
  const byId = {};
  (users || []).forEach((u) => {
    if (u && (u.pk || u.id)) {
      byId[String(u.pk || u.id)] = u.username || null;
    }
  });
  const admins = [];
  for (const userId of adminIds) {
    let username = byId[userId] || null;
    if (!username && typeof client.usernameFromUserId === 'function') {
      try {
        username = await client.usernameFromUserId(userId);
      } catch (ignored) {
        username = null;
      }
    }
    admins.push({ userId, username });
  }
  return admins;
}

async function fetchAdminSnapshot(client, threadId) {
  const thread = await getThread(client, threadId, { amount: 1 });
  const adminIds = ((thread && thread.admin_user_ids) || []).map(String);
  return {
    threadId: String(threadId),
    title: (thread && (thread.thread_title || thread.title)) || null,
    admins: await resolveAdminNames(client, adminIds, thread && thread.users),
  };
}

// Membership changes propagate with server-side lag: right after a join the
// first fetch may return the stale admin list, the second the fresh one.
// Default refresh fetches twice with a delay and returns the LATEST snapshot.
async function getThreadAdmins(client, threadId, options) {
  if (!threadId) {
    throw new Error('@alaminnna/ica-unofficial: getThreadAdmins needs { threadId }');
  }
  const opts = options || {};
  const first = await fetchAdminSnapshot(client, threadId);
  if (opts.refresh === false) {
    return first;
  }
  await sleep(opts.refreshDelayMs === undefined ? 2000 : opts.refreshDelayMs);
  try {
    return await fetchAdminSnapshot(client, threadId);
  } catch (ignored) {
    return first;
  }
}

module.exports = { unsendMessage, deleteMessage, markThreadSeen, setTyping, getThreadAdmins };