/**
 * @alaminnna/ica-unofficial — message/sending/share
 * 
 * RESPONSIBILITY: media/story/profile shares into threads.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../threads/threads, ../../core/device, ../../exceptions
 * MUST NOT:       never touch listener state
 * 
 * DEBUG: when a share returns no id, start looking here — media/thread resolution
 */

'use strict';

const axios = require('axios');
const { generateMutationToken } = require('../../core/device');
const { normalizeMessage, NAV_CHAIN } = require('../threads/threads');
const { DirectThreadNotFound } = require('../../exceptions');

function compactJson(obj) {
  return JSON.stringify(obj);
}

function asIdList(ids) {
  if (ids === undefined || ids === null) {
    return [];
  }
  if (typeof ids === 'number' || typeof ids === 'string') {
    return [String(ids)];
  }
  return ids.map((id) => String(id));
}

async function resolveThreadIds(client, lists, kind) {
  const threadIds = asIdList(lists.threadIds);
  const userIds = asIdList(lists.userIds);
  if ((!threadIds.length && !userIds.length) || (threadIds.length && userIds.length)) {
    throw new Error('@alaminnna/ica-unofficial: specify threadIds or userIds, but not both');
  }
  if (threadIds.length > 0) {
    return threadIds;
  }
  const res = await client.api.request({
    endpoint: 'direct_v2/thread_by_participants/',
    method: 'GET',
    params: { recipient_users: compactJson(userIds.map((id) => Number(id))) },
  });
  const thread = (res || {}).thread || {};
  const threadId = thread.thread_v2_id || thread.thread_id;
  if (!threadId) {
    throw new DirectThreadNotFound('@alaminnna/ica-unofficial: no existing direct thread found for participants; ' + kind + ' share currently requires an existing thread', { user_ids: userIds });
  }
  return [String(threadId)];
}

async function resolveMediaId(client, options) {
  if (options.mediaId) {
    const id = String(options.mediaId);
    if (id.indexOf('_') === -1) {
      throw new Error('@alaminnna/ica-unofficial: mediaId must be full "pk_userid" form (e.g. 2277033926878261772_1903424587)');
    }
    return id;
  }
  if (options.mediaUrl) {
    const res = await axios.get('https://api.instagram.com/oembed/?url=' + encodeURIComponent(options.mediaUrl), { timeout: 20000 });
    const data = res.data || {};
    if (!data.media_id || !data.author_id) {
      throw new Error('@alaminnna/ica-unofficial: oEmbed did not return media_id/author_id for URL');
    }
    return String(data.media_id) + '_' + String(data.author_id);
  }
  throw new Error('@alaminnna/ica-unofficial: shareMedia needs { mediaId } or { mediaUrl }');
}

function mediaPk(fullId) {
  return String(fullId).split('_')[0];
}

async function shareMedia(client, options) {
  const opts = options || {};
  const threadIds = await resolveThreadIds(client, { threadIds: opts.threadIds === undefined ? opts.threadId : opts.threadIds, userIds: opts.userIds === undefined ? opts.userId : opts.userIds }, 'media');
  const fullId = await resolveMediaId(client, opts);
  const token = generateMutationToken();
  const mediaType = opts.mediaType || 'photo';
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/broadcast/media_share/',
    params: { media_type: mediaType },
    data: {
      action: 'send_item',
      is_shh_mode: '0',
      send_attribution: opts.sendAttribution || 'feed_timeline',
      client_context: token,
      media_id: fullId,
      device_id: client.androidDeviceId,
      mutation_token: token,
      _uuid: client.uuid,
      btt_dual_send: 'false',
      nav_chain: NAV_CHAIN,
      is_ae_dual_send: 'false',
      offline_threading_id: token,
      ...(opts.sendAttribution === 'feed_contextual_chain' || opts.sendAttribution === 'feed_short_url' ? { inventory_source: 'recommended_explore_grid_cover_model' } : {}),
      ...((!opts.sendAttribution || opts.sendAttribution === 'feed_timeline') ? { inventory_source: 'media_or_ad' } : {}),
    },
  });
  return normalizeMessage((res || {}).payload || {});
}async function shareStory(client, options) {
  const opts = options || {};
  if (!opts.storyId) {
    throw new Error('@alaminnna/ica-unofficial: shareStory needs { storyId }');
  }
  const threadIds = await resolveThreadIds(client, { threadIds: opts.threadIds === undefined ? opts.threadId : opts.threadIds, userIds: opts.userIds === undefined ? opts.userId : opts.userIds }, 'story');
  const token = generateMutationToken();
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/broadcast/story_share/',
    data: {
      action: 'send_item',
      is_shh_mode: '0',
      send_attribution: 'reel_feed_timeline',
      client_context: token,
      mutation_token: token,
      nav_chain: '1qT:feed_timeline:1,ReelViewerFragment:reel_feed_timeline:4,DirectShareSheetFragment:direct_reshare_sheet:5',
      reel_id: mediaPk(opts.storyId),
      containermodule: 'reel_feed_timeline',
      story_media_id: String(opts.storyId),
      offline_threading_id: token,
      ...(threadIds.length > 0 ? { thread_ids: compactJson(threadIds.map((id) => Number(id))) } : {}),
    },
  });
  return normalizeMessage((res || {}).payload || {});
}

async function shareProfile(client, options) {
  const opts = options || {};
  if (opts.userId === undefined || opts.userId === null || opts.userId === '') {
    throw new Error('@alaminnna/ica-unofficial: shareProfile needs { userId }');
  }
  const threadIds = await resolveThreadIds(client, { threadIds: opts.threadIds === undefined ? opts.threadId : opts.threadIds, userIds: opts.userIds }, 'profile');
  const token = generateMutationToken();
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/broadcast/profile/',
    data: {
      profile_user_id: String(opts.userId),
      action: 'send_item',
      is_shh_mode: '0',
      send_attribution: 'profile',
      client_context: token,
      device_id: client.androidDeviceId,
      mutation_token: token,
      _uuid: client.uuid,
      btt_dual_send: 'false',
      nav_chain: NAV_CHAIN,
      is_ae_dual_send: 'false',
      offline_threading_id: token,
      ...(threadIds.length > 0 ? { thread_ids: compactJson(threadIds) } : {}),
    },
  });
  return normalizeMessage((res || {}).payload || {});
}

async function sendCutoutSticker(client, options) {
  const opts = options || {};
  if (!opts.stickerId) {
    throw new Error('@alaminnna/ica-unofficial: sendCutoutSticker needs { stickerId }');
  }
  const threadIds = await resolveThreadIds(client, { threadIds: opts.threadIds === undefined ? opts.threadId : opts.threadIds, userIds: opts.userIds === undefined ? opts.userId : opts.userIds }, 'cutout');
  const token = generateMutationToken();
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/broadcast/generic_share/',
    method: 'POST',
    data: {
      action: 'send_item',
      embedded_ent_type: '101',
      json_params: compactJson({ sticker_id: 'cutout_photo_' + opts.stickerId, embedded_ent_type: 101 }),
      client_context: token,
      mutation_token: token,
      device_id: client.androidDeviceId,
      _uuid: client.uuid,
      offline_threading_id: token,
      ...(threadIds.length > 0 ? { thread_ids: compactJson(threadIds.map((id) => Number(id))) } : {}),
    },
  });
  return normalizeMessage((res || {}).payload || {});
}

module.exports = { shareMedia, shareStory, shareProfile, sendCutoutSticker, resolveMediaId, resolveThreadIds, mediaPk };