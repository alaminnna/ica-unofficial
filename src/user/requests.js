/**
 * @alaminnna/ica-unofficial — user/requests
 *
 * RESPONSIBILITY: follow-request inbox (private accounts) + social writes:
 * close friends, mutes, notification favorites, remove follower, FRX report.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./social (normalizeShort), client.api, client.rateGuard
 * MUST NOT:       never burst writes — every write goes through rateGuard.schedule
 *
 * DEBUG: when approve returns false or besties never sticks, start looking
 * here — friendship_status field checks per endpoint
 */

'use strict';

const { normalizeShort } = require('./social');
const { UserNotFound } = require('../exceptions');

const NOTIF_KINDS = {
  posts: '',
  videos: '_for_igtv',
  reels: '_for_clips',
  stories: '_for_stories',
};

const REPORT_REASONS = ['spam'];
const REPORT_TAGS = ['ig_report_account', 'ig_its_inappropriate', 'ig_spam_v3'];

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

function userLog(client, ...args) {
  if (client.clientLog && typeof client.clientLog.debug === 'function') {
    client.clientLog.debug('[USER]', ...args);
  }
}

// BLOCK A — follow requests (private-account surface, NOT Direct requests)

async function getFollowRequestsChunk(client, options) {
  const opts = options || {};
  const maxAmount = opts.maxAmount || 0;
  let maxId = opts.maxId || '';
  const users = [];
  const seen = new Set();
  for (;;) {
    const params = { count: maxAmount ? Math.min(maxAmount - users.length, 200) : 200 };
    if (maxId) {
      params.max_id = maxId;
    }
    const res = await client.api.request({ endpoint: 'friendships/pending/', method: 'GET', params });
    ((res || {}).users || []).forEach((raw) => {
      const user = normalizeShort(raw);
      const id = user.userId || (raw && raw.pk !== undefined ? String(raw.pk) : null);
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      users.push(user.userId ? user : { ...user, userId: id });
    });
    maxId = ((res || {}).next_max_id) || '';
    if (!maxId || (maxAmount && users.length >= maxAmount)) {
      break;
    }
  }
  return { users: maxAmount ? users.slice(0, maxAmount) : users, nextCursor: maxId };
}

async function getFollowRequests(client, options) {
  const opts = options || {};
  const chunk = await getFollowRequestsChunk(client, { maxAmount: opts.amount || 0 });
  return chunk.users;
}

async function approveFollowRequest(client, userId) {
  const id = String(userId);
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/approve/' + id + '/',
    method: 'POST',
    data: { user_id: id, _uuid: client.uuid },
  }));
  const status = (res || {}).friendship_status || {};
  const ok = ('followed_by' in status) ? status.followed_by === true : ((res || {}).status === 'ok');
  userLog(client, 'approve follow request ' + id + ' -> ' + ok);
  return ok;
}

async function declineFollowRequest(client, userId) {
  const id = String(userId);
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/ignore/' + id + '/',
    method: 'POST',
    data: { user_id: id, _uuid: client.uuid },
  }));
  const status = (res || {}).friendship_status || {};
  const ok = ('followed_by' in status) ? status.followed_by === false : ((res || {}).status === 'ok');
  userLog(client, 'decline follow request ' + id + ' -> ' + ok);
  return ok;
}

async function approveFollowRequests(client, userIds) {
  const out = {};
  for (const userId of (userIds || [])) {
    out[String(userId)] = await approveFollowRequest(client, userId);
  }
  return out;
}

async function declineFollowRequests(client, userIds) {
  const out = {};
  for (const userId of (userIds || [])) {
    out[String(userId)] = await declineFollowRequest(client, userId);
  }
  return out;
}

// BLOCK B — close friends (wires to story "besties" audience)

async function closeFriendAdd(client, userId) {
  const id = String(userId);
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/set_besties/',
    method: 'POST',
    data: {
      block_on_empty_thread_creation: 'false',
      module: 'CLOSE_FRIENDS_V2_SEARCH',
      source: 'audience_manager',
      _uid: String(client.userId),
      _uuid: client.uuid,
      remove: [],
      add: [id],
    },
  }));
  const statuses = (res || {}).friendship_statuses || {};
  const ok = Boolean(statuses[id] && statuses[id].is_bestie);
  userLog(client, 'close friend add ' + id + ' -> ' + ok);
  return ok;
}

async function closeFriendRemove(client, userId) {
  const id = String(userId);
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/set_besties/',
    method: 'POST',
    data: {
      block_on_empty_thread_creation: 'false',
      module: 'CLOSE_FRIENDS_V2_SEARCH',
      source: 'audience_manager',
      _uid: String(client.userId),
      _uuid: client.uuid,
      remove: [id],
      add: [],
    },
  }));
  const statuses = (res || {}).friendship_statuses || {};
  const ok = Boolean(statuses[id]) && statuses[id].is_bestie === false;
  userLog(client, 'close friend remove ' + id + ' -> ' + ok);
  return ok;
}

// BLOCK B — mutes

async function mutePostsFromFollow(client, userId, revert) {
  const id = String(userId);
  const guard = guardOf(client);
  const name = revert ? 'unmute' : 'mute';
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/' + name + '_posts_or_story_from_follow/',
    method: 'POST',
    data: { target_posts_author_id: id, container_module: 'media_mute_sheet' },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function unmutePostsFromFollow(client, userId) {
  return mutePostsFromFollow(client, userId, true);
}

async function muteStoriesFromFollow(client, userId, revert) {
  const id = String(userId);
  const guard = guardOf(client);
  const name = revert ? 'unmute' : 'mute';
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/' + name + '_posts_or_story_from_follow/',
    method: 'POST',
    data: { target_reel_author_id: id, container_module: 'media_mute_sheet' },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function unmuteStoriesFromFollow(client, userId) {
  return muteStoriesFromFollow(client, userId, true);
}

// BLOCK B — notification favorites (8 endpoints → 4 wrappers)

async function setPostsNotifications(client, userId, enabled) {
  return setNotifications(client, 'posts', userId, enabled);
}

async function setVideosNotifications(client, userId, enabled) {
  return setNotifications(client, 'videos', userId, enabled);
}

async function setReelsNotifications(client, userId, enabled) {
  return setNotifications(client, 'reels', userId, enabled);
}

async function setStoriesNotifications(client, userId, enabled) {
  return setNotifications(client, 'stories', userId, enabled);
}

async function setNotifications(client, kind, userId, enabled) {
  if (!(kind in NOTIF_KINDS)) {
    throw new Error('@alaminnna/ica-unofficial: unknown notification kind ' + kind + ' (posts|videos|reels|stories)');
  }
  const id = String(userId);
  const guard = guardOf(client);
  const name = enabled ? 'favorite' : 'unfavorite';
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/' + name + NOTIF_KINDS[kind] + '/' + id + '/',
    method: 'POST',
    data: { user_id: id, _uid: String(client.userId) },
  }));
  return ((res || {}).status || '') === 'ok';
}

// BLOCK B — remove follower + FRX report (real account action)

async function removeFollower(client, userId) {
  const id = String(userId);
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'friendships/remove_follower/' + id + '/',
    method: 'POST',
    data: { user_id: id, _uuid: client.uuid },
  }));
  return ((res || {}).friendship_status || {}).followed_by === false;
}

async function reportUser(client, userId, reason) {
  const id = String(userId);
  const why = reason || 'spam';
  if (REPORT_REASONS.indexOf(why) === -1) {
    throw new Error('@alaminnna/ica-unofficial: unsupported report reason "' + why + '" (spam only)');
  }
  const guard = guardOf(client);
  const first = await guard.schedule(() => client.api.request({
    endpoint: 'reports/get_frx_prompt/',
    method: 'POST',
    data: {
      _uuid: client.uuid,
      container_module: 'profile',
      entry_point: '1',
      frx_prompt_request_type: '1',
      is_dark_mode: 'false',
      location: '2',
      nua_action: '',
      object_id: id,
      object_type: '5',
    },
  }));
  let context = ((first || {}).response || first || {}).context;
  if (!context) {
    throw new UserNotFound('@alaminnna/ica-unofficial: report flow returned no context for ' + id, {});
  }
  let response = null;
  for (const tag of REPORT_TAGS) {
    const step = await guard.schedule(() => client.api.request({
      endpoint: 'reports/get_frx_prompt/',
      method: 'POST',
      data: {
        _uuid: client.uuid,
        context,
        frx_prompt_request_type: '2',
        is_dark_mode: 'false',
        nua_action: '',
        selected_tag_types: JSON.stringify([tag]),
      },
    }));
    response = (step || {}).response || step || {};
    context = response.context;
    if (!context) {
      throw new Error('@alaminnna/ica-unofficial: report flow lost context after tag ' + tag);
    }
  }
  userLog(client, 'report user ' + id + ' submitted');
  return Boolean(response && response.follow_up_actions);
}

module.exports = {
  NOTIF_KINDS,
  REPORT_REASONS,
  getFollowRequestsChunk,
  getFollowRequests,
  approveFollowRequest,
  declineFollowRequest,
  approveFollowRequests,
  declineFollowRequests,
  closeFriendAdd,
  closeFriendRemove,
  mutePostsFromFollow,
  unmutePostsFromFollow,
  muteStoriesFromFollow,
  unmuteStoriesFromFollow,
  setPostsNotifications,
  setVideosNotifications,
  setReelsNotifications,
  setStoriesNotifications,
  removeFollower,
  reportUser,
};