/**
 * @alaminnna/ica-unofficial — message/threads/rooms
 *
 * RESPONSIBILITY: thread room management: create/hide/retitle/add-users,
 * unread, mute (thread + video call), e2ee eligibility, spam inbox.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../../core/device (generateMutationToken), client.api, client.rateGuard
 * MUST NOT:       never send message content from here — sending/* owns that
 *
 * DEBUG: when create returns no id or mute never sticks, start looking
 * here — status checks per endpoint
 */

'use strict';

const { generateMutationToken } = require('../../core/device');

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

function asIdList(ids) {
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((id) => String(id).trim())
    .filter(Boolean);
  return [...new Set(list)];
}

function threadLog(client, ...args) {
  if (client.clientLog && typeof client.clientLog.debug === 'function') {
    client.clientLog.debug('[THREAD]', ...args);
  }
}

async function createThread(client, options) {
  const opts = options || {};
  const userIds = asIdList(opts.userIds);
  if (userIds.length < 2) {
    throw new Error('@alaminnna/ica-unofficial: createThread needs at least two recipient userIds');
  }
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'direct_v2/create_group_thread/',
    method: 'POST',
    data: {
      _uuid: client.uuid,
      _uid: String(client.userId),
      client_context: generateMutationToken(),
      is_partnership_folder: 'false',
      recipient_users: JSON.stringify(userIds.map(Number)),
      thread_title: String(opts.title || ''),
    },
  }));
  const threadId = (res || {}).thread_id || ((res || {}).thread || {}).thread_id;
  if (!threadId) {
    throw new Error('@alaminnna/ica-unofficial: create group thread response missing thread_id');
  }
  threadLog(client, 'created thread ' + threadId);
  return String(threadId);
}

async function hideThread(client, threadId, moveToSpam) {
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'direct_v2/threads/' + threadId + '/hide/',
    method: 'POST',
    data: { should_move_future_requests_to_spam: Boolean(moveToSpam), _uuid: client.uuid },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function updateThreadTitle(client, threadId, title) {
  if (!title) {
    throw new Error('@alaminnna/ica-unofficial: updateThreadTitle needs { title }');
  }
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'direct_v2/threads/' + threadId + '/update_title/',
    method: 'POST',
    data: { _uuid: client.uuid, title: String(title) },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function addUsersToThread(client, threadId, userIds) {
  const ids = asIdList(userIds);
  if (ids.length === 0) {
    throw new Error('@alaminnna/ica-unofficial: addUsersToThread needs at least one userId');
  }
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'direct_v2/threads/' + threadId + '/add_user/',
    method: 'POST',
    data: { _uuid: client.uuid, user_ids: JSON.stringify(ids) },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function markThreadUnread(client, threadId) {
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/' + threadId + '/mark_unread/',
    method: 'POST',
    data: { _uuid: client.uuid },
  });
  return ((res || {}).status || '') === 'ok';
}

async function muteThread(client, threadId, revert) {
  const name = revert ? 'unmute' : 'mute';
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'direct_v2/threads/' + threadId + '/' + name + '/',
    method: 'POST',
    data: { _uuid: client.uuid },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function unmuteThread(client, threadId) {
  return muteThread(client, threadId, true);
}

async function muteVideoCall(client, threadId, revert) {
  const name = revert ? 'unmute_video_call' : 'mute_video_call';
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'direct_v2/threads/' + threadId + '/' + name + '/',
    method: 'POST',
    data: { _uuid: client.uuid },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function unmuteVideoCall(client, threadId) {
  return muteVideoCall(client, threadId, true);
}

async function setE2eeEligibility(client, value) {
  const res = await client.api.request({
    endpoint: 'direct_v2/set_e2ee_eligibility/',
    method: 'POST',
    data: { _uuid: client.uuid, e2ee_eligibility: String(value === undefined ? 4 : value) },
  });
  return ((res || {}).status || '') === 'ok';
}

async function getSpamInboxChunk(client, cursor) {
  const params = {
    visual_message_return_type: 'unseen',
    persistentBadging: 'true',
    is_prefetching: 'false',
  };
  if (cursor) {
    params.cursor = cursor;
  }
  const res = await client.api.request({ endpoint: 'direct_v2/spam_inbox/', method: 'GET', params });
  const inbox = (res || {}).inbox || {};
  return { threads: inbox.threads || [], nextCursor: inbox.oldest_cursor || null };
}

async function getSpamInbox(client, amount) {
  const out = [];
  let cursor = null;
  for (;;) {
    const chunk = await getSpamInboxChunk(client, cursor);
    out.push(...chunk.threads);
    cursor = chunk.nextCursor;
    if (!cursor || (amount && out.length >= amount)) {
      break;
    }
  }
  return amount ? out.slice(0, amount) : out;
}

module.exports = {
  createThread,
  hideThread,
  updateThreadTitle,
  addUsersToThread,
  markThreadUnread,
  muteThread,
  unmuteThread,
  muteVideoCall,
  unmuteVideoCall,
  setE2eeEligibility,
  getSpamInboxChunk,
  getSpamInbox,
};