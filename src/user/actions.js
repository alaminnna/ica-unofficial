/**
 * @alaminnna/ica-unofficial — user/actions
 * 
 * RESPONSIBILITY: social writes: follow/unfollow/block via rate guard with pre-checks.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api, client.rateGuard
 * MUST NOT:       never burst writes
 * 
 * DEBUG: when follow says already or block fails silently, start looking here — friendship pre-check
 */

'use strict';

const { generateMutationToken } = require('../core/device');

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

async function getFriendship(client, userId) {
  const res = await client.api.request({
    endpoint: 'friendships/show/' + userId + '/',
    method: 'GET',
    params: { is_external_deeplink_profile_view: 'false' },
  });
  const data = res || {};
  return {
    following: data.following === true,
    followedBy: data.followed_by === true,
    outgoingRequested: data.outgoing_request === true,
    blocking: data.blocking === true,
  };
}

async function getUserFriendship(client, userId) {
  const id = String(userId);
  const res = await client.api.request({
    endpoint: 'friendships/show/' + id + '/',
    method: 'GET',
    params: { is_external_deeplink_profile_view: 'false' },
  });
  const data = res || {};
  const following = data.following === true;
  const outgoingRequested = data.outgoing_request === true;
  return {
    userId: id,
    following,
    followedBy: data.followed_by === true,
    outgoingRequested,
    blocking: data.blocking === true,
    muting: data.muting === true,
    isPrivate: data.is_private === undefined ? null : data.is_private,
    relation: following ? 'following' : (outgoingRequested ? 'outgoing_request' : 'none'),
    raw: data,
  };
}

async function getUserFriendships(client, userIds) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).map(String).filter(Boolean);
  if (ids.length === 0) {
    throw new Error('@alaminnna/ica-unofficial: getUserFriendships needs non-empty userIds');
  }
  const res = await client.api.request({
    endpoint: 'friendships/show_many/',
    method: 'POST',
    data: { user_ids: ids.join(','), _uuid: client.uuid },
  });
  if (((res || {}).status || '') !== 'ok') {
    throw new Error('@alaminnna/ica-unofficial: friendships lookup failed');
  }
  const statuses = (res || {}).friendship_statuses || {};
  return Object.keys(statuses).map((id) => {
    const st = statuses[id] || {};
    return {
      userId: String(id),
      following: st.following === true,
      followedBy: st.followed_by === true,
      outgoingRequested: st.outgoing_request === true,
      blocking: st.blocking === true,
      muting: st.muting === true,
      isPrivate: st.is_private === undefined ? null : st.is_private,
      raw: st,
    };
  });
}

async function follow(client, options) {
  const userId = String((options || {}).userId);
  const guard = guardOf(client);
  const status = await guard.schedule(async () => {
    try {
      return await getFriendship(client, userId);
    } catch (err) {
      return null;
    }
  });
  if (status && (status.following || status.outgoingRequested)) {
    return { ok: false, reason: 'already' };
  }
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/create/' + userId + '/',
    data: { user_id: userId, _uid: String(client.userId), include_follow_friction_check: '1', container_module: 'profile' },
  }));
  const friendship = (res || {}).friendship_status || {};
  const ok = friendship.following === true || friendship.outgoing_request === true;
  return {
    ok,
    relationship: friendship.following === true ? 'following' : (friendship.outgoing_request === true ? 'requested' : 'none'),
  };
}

async function unfollow(client, options) {
  const userId = String((options || {}).userId);
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/destroy/' + userId + '/',
    data: { user_id: userId, _uid: String(client.userId), container_module: 'profile' },
  }));
  const following = ((res || {}).friendship_status || {}).following;
  return { ok: following === false };
}

async function block(client, options) {
  const opts = options || {};
  const userId = String(opts.userId);
  const surface = opts.surface || 'profile';
  const guard = guardOf(client);
  const data = { surface, is_auto_block_enabled: 'false', user_id: userId, _uid: String(client.userId), _uuid: client.uuid };
  if (surface === 'direct_thread_info') {
    data.client_request_id = generateMutationToken();
  }
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/block/' + userId + '/',
    data,
  }));
  const status = (res || {}).status;
  const blocking = ((res || {}).friendship_status || {}).blocking;
  return { ok: status === 'ok' && blocking === true };
}

async function unblock(client, options) {
  const opts = options || {};
  const userId = String(opts.userId);
  const surface = opts.surface || 'profile';
  const guard = guardOf(client);
  const data = { container_module: surface, user_id: userId, _uid: String(client.userId), _uuid: client.uuid };
  if (surface === 'direct_thread_info') {
    data.client_request_id = generateMutationToken();
  }
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/unblock/' + userId + '/',
    data,
  }));
  const status = (res || {}).status;
  const blocking = ((res || {}).friendship_status || {}).blocking;
  return { ok: status === 'ok' && blocking === false };
}

module.exports = { getFriendship, getUserFriendship, getUserFriendships, follow, unfollow, block, unblock };