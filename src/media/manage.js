/**
 * @alaminnna/ica-unofficial — media/manage
 *
 * RESPONSIBILITY: media management writes + reads only — delete/edit/link,
 *   archive, pin, seen-state, oembed/author/refresh, cutout sticker, user
 *   clips/videos lists.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./info, ./codec, ../upload shared core, client.api
 * MUST NOT:       never upload bytes here (src/upload owns bytes)
 *
 * DEBUG: when edit/delete/archive returns false, start looking here — media_id
 *   form (needs full pk_userid) or login state
 */

'use strict';

const { getMediaInfo } = require('./info');
const { dumps } = require('../upload/rupload');

// Full "pk_userid" form; resolves bare pk/URL via getMediaInfo when needed.
async function ensureMediaId(client, input) {
  const text = String(input || '');
  if (text.indexOf('_') !== -1 && !/^https?:\/\//.test(text)) {
    return text;
  }
  const info = await getMediaInfo(client, input);
  if (info.mediaId && info.mediaId.indexOf('_') !== -1) {
    return info.mediaId;
  }
  if (info.pk && info.userId) {
    return info.pk + '_' + info.userId;
  }
  throw new Error('@alaminnna/ica-unofficial: cannot resolve full media id for: ' + input);
}

function withDefaults(client, data) {
  return { _uuid: client.uuid, device_id: client.androidDeviceId, ...(data || {}) };
}

async function deleteMedia(client, mediaId) {
  const id = await ensureMediaId(client, mediaId);
  const res = await client.api.request({
    endpoint: 'media/' + id + '/delete/',
    data: withDefaults(client, { media_id: id }),
  });
  return Boolean(res && res.did_delete);
}

async function editMedia(client, options) {
  const opts = options || {};
  const id = await ensureMediaId(client, opts.mediaId);
  const usertags = (opts.usertags || []).map((tag) => ({
    user_id: String(tag.userId || (tag.user && (tag.user.pk || tag.user.id))),
    position: [Number(tag.x) || 0, Number(tag.y) || 0],
  }));
  const data = {
    caption_text: opts.caption || '',
    container_module: 'edit_media_info',
    feed_position: '0',
    location: opts.location || '{}',
    usertags: dumps({ in: usertags }),
    is_carousel_bumped_post: 'false',
  };
  if (opts.productType === 'igtv') {
    data.title = opts.title || String(opts.caption || '').split('\n')[0].slice(0, 75);
    data.igtv_ads_toggled_on = '0';
  }
  const res = await client.api.request({
    endpoint: 'media/' + id + '/edit_media/',
    data: withDefaults(client, data),
  });
  return res;
}

async function linkReel(client, mediaId, targetMediaId, linkName) {
  const id = await ensureMediaId(client, mediaId);
  const target = await ensureMediaId(client, targetMediaId);
  const res = await client.api.request({
    endpoint: 'media/' + id + '/edit_media/',
    data: {
      _uid: String(client.userId),
      _uuid: client.uuid,
      linked_media_info: dumps({ media_id: target, link_name: linkName || 'Watch Next' }),
    },
  });
  return res && res.status === 'ok';
}

async function archiveMedia(client, mediaId, revert) {
  const id = await ensureMediaId(client, mediaId);
  const name = revert ? 'undo_only_me' : 'only_me';
  const res = await client.api.request({
    endpoint: 'media/' + id + '/' + name + '/',
    data: { radio_type: 'wifi-none', ...withDefaults(client, { media_id: id }) },
  });
  return res && res.status === 'ok';
}

async function unarchiveMedia(client, mediaId) {
  return archiveMedia(client, mediaId, true);
}

async function getArchivedMedias(client, amount) {
  const res = await client.api.request({ endpoint: 'feed/only_me_feed/', method: 'GET', params: {} });
  const items = (res || {}).items || [];
  const { normalizeMediaInfo } = require('./info');
  const out = items.map((item) => normalizeMediaInfo(item.media || item));
  return amount ? out.slice(0, amount) : out;
}

async function pinMedia(client, mediaPk, revert) {
  const name = revert ? 'unpin' : 'pin';
  const res = await client.api.request({
    endpoint: 'users/' + name + '_timeline_media/',
    data: withDefaults(client, { post_id: String(mediaPk) }),
  });
  return res && res.status === 'ok';
}

async function unpinMedia(client, mediaPk) {
  return pinMedia(client, mediaPk, true);
}

async function pinReel(client, mediaPk, revert) {
  const name = revert ? 'unpin' : 'pin';
  const res = await client.api.request({
    endpoint: 'users/' + name + '_timeline_media/',
    data: withDefaults(client, { post_id: String(mediaPk), profile_grid: 'clips' }),
  });
  return res && res.status === 'ok';
}

async function unpinReel(client, mediaPk) {
  return pinReel(client, mediaPk, true);
}

function seenEntry(mediaId) {
  const parts = String(mediaId).split('_');
  const pk = parts[0];
  const userId = parts[1] || parts[0];
  const end = Math.floor(Date.now() / 1000);
  const begin = end - (100 + Math.floor(Math.random() * 2900));
  const out = {};
  out[pk + '_' + userId + '_' + userId] = [begin + '_' + end];
  return out;
}

async function markMediaSeen(client, mediaIds, skippedIds) {
  const reels = {};
  (mediaIds || []).forEach((id) => Object.assign(reels, seenEntry(id)));
  const skipped = {};
  (skippedIds || []).forEach((id) => Object.assign(skipped, seenEntry(id)));
  const res = await client.api.request({
    endpoint: '/v2/media/seen/?reel=1&live_vod=0',
    data: withDefaults(client, {
      container_module: 'feed_timeline',
      live_vods_skipped: {},
      nuxes_skipped: {},
      nuxes: {},
      reels,
      live_vods: {},
      reel_media_skipped: skipped,
    }),
  });
  return res && res.status === 'ok';
}

async function markClipsSeen(client, mediaIds, blendIds) {
  const pks = (mediaIds || []).map((id) => String(id).split('_')[0]);
  const blend = (blendIds || []).map((id) => String(id).split('_')[0]);
  const res = await client.api.request({
    endpoint: 'clips/write_seen_state/',
    data: withDefaults(client, {
      impressions: dumps(pks),
      blend_impressions: dumps(blend),
    }),
  });
  return res && res.status === 'ok';
}

async function getMediaOembed(client, url) {
  const res = await client.api.request({ endpoint: 'oembed?url=' + encodeURIComponent(url), method: 'GET' });
  return res;
}

async function getMediaAuthor(client, mediaPk) {
  const info = await getMediaInfo(client, mediaPk);
  return { userId: info.userId, username: info.username };
}

async function getMediaInfoV2(client, mediaId) {
  const pk = String(mediaId).split('_')[0];
  const res = await client.api.request({ endpoint: 'discover/media_metadata/', method: 'GET', params: { media_id: pk } });
  const media = (res || {}).media_or_ad;
  if (!media) {
    const ex = require('../exceptions');
    throw new ex.ClientNotFoundError('@alaminnna/ica-unofficial: media v2 not found: ' + pk, {});
  }
  const { normalizeMediaInfo } = require('./info');
  return normalizeMediaInfo(media);
}

async function videoRefreshResources(client, mediaId, allVariants) {
  const pk = String(mediaId).split('_')[0];
  const res = await client.api.request({
    endpoint: 'video/refresh_resources/' + pk + '/',
    method: 'GET',
    params: { should_fetch_all_language_variants: String(Boolean(allVariants)).toLowerCase() },
  });
  return res;
}

// Cutout sticker: rupload bytes (shared upload core) + cutout configure.
async function uploadCutoutSticker(client, options) {
  const opts = options || {};
  if (!opts.path) {
    throw new Error('@alaminnna/ica-unofficial: uploadCutoutSticker needs { path }');
  }
  const { assertPhotoFile } = require('../upload/validate');
  const { preparePhoto } = require('../upload/thumb');
  const { photoRupload, extractMediaId } = require('../upload/rupload');
  assertPhotoFile(opts.path);
  const prepared = await preparePhoto({ src: opts.path, maxSide: 1080, quality: 80 });
  const { uploadId } = await photoRupload(client, { buffer: prepared.buffer, imageType: 'image/jpeg' });
  const data = {
    upload_id: uploadId,
    source_type: 'library',
    sticker_type: 'cutout_sticker',
    _uuid: client.uuid,
    _uid: String(client.userId),
    ...(opts.bypassAi === false
      ? { detect_subject: 'true' }
      : { cutout_sticker_data: dumps({ manual_mask: { box: [0.0, 0.0, 1.0, 1.0] } }) }),
    ...(opts.extraData || {}),
  };
  const res = await client.api.request({ endpoint: 'media/configure_to_cutout_sticker/', data });
  const mediaId = extractMediaId(res, client.api.lastJson);
  return { id: mediaId, mediaId, uploadId };
}

async function changeReelCoverByPath(client, mediaPk, coverPath) {
  const { changeReelCover } = require('../upload/reel');
  return changeReelCover(client, mediaPk, coverPath);
}

function normalizeClipItem(raw) {
  const media = (raw && raw.media) || raw || {};
  const { normalizeMediaInfo } = require('./info');
  return normalizeMediaInfo(media);
}

async function getUserClips(client, options) {
  const opts = options || {};
  const res = await client.api.request({
    endpoint: 'clips/user/',
    data: withDefaults(client, {
      target_user_id: Number(opts.userId),
      max_id: opts.endCursor || '',
      page_size: opts.amount || 12,
      include_feed_video: 'true',
    }),
  });
  const items = ((res || {}).items || []).map(normalizeClipItem);
  const paging = (res || {}).paging_info || {};
  return { medias: opts.amount ? items.slice(0, opts.amount) : items, endCursor: paging.max_id || '' };
}

async function getUserVideos(client, options) {
  const opts = options || {};
  const res = await client.api.request({
    endpoint: 'igtv/channel/',
    method: 'GET',
    params: { id: 'uservideo_' + opts.userId, count: 50 },
  });
  const { normalizeMediaInfo } = require('./info');
  const items = ((res || {}).items || []).map((m) => normalizeMediaInfo(m));
  return opts.amount ? items.slice(0, opts.amount) : items;
}

module.exports = {
  deleteMedia,
  editMedia,
  linkReel,
  archiveMedia,
  unarchiveMedia,
  getArchivedMedias,
  pinMedia,
  unpinMedia,
  pinReel,
  unpinReel,
  markMediaSeen,
  markClipsSeen,
  getMediaOembed,
  getMediaAuthor,
  getMediaInfoV2,
  videoRefreshResources,
  uploadCutoutSticker,
  changeReelCoverByPath,
  getUserClips,
  getUserVideos,
};