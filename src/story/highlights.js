/**
 * @alaminnna/ica-unofficial — story/highlights
 *
 * RESPONSIBILITY: story highlights: tray, info, create/edit/cover/stories/delete.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:fs, ../upload/rupload (photoRupload), client.api, client.rateGuard
 * MUST NOT:       never burst writes — mutations go through rateGuard.schedule
 *
 * DEBUG: when create returns no reel or cover never applies, start looking
 * here — capabilities payload and cover upload_id
 */

'use strict';

const fs = require('node:fs');
const { photoRupload } = require('../upload/rupload');

// From instagrapi/config.py SUPPORTED_CAPABILITIES (verbatim).
const SUPPORTED_CAPABILITIES = [
  { value: '119.0,120.0,121.0,122.0,123.0,124.0,125.0,126.0,127.0,128.0,129.0,130.0,131.0,132.0,133.0,134.0,135.0,136.0,137.0,138.0,139.0,140.0,141.0,142.0', name: 'SUPPORTED_SDK_VERSIONS' },
  { value: '14', name: 'FACE_TRACKER_VERSION' },
  { value: 'ETC2_COMPRESSION', name: 'COMPRESSION' },
  { value: 'gyroscope_enabled', name: 'gyroscope' },
];

const DEFAULT_CROP_RECT = [0.0, 0.21830457, 1.0, 0.78094524];

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

function normalizeHighlight(raw) {
  const data = raw || {};
  const cover = data.cover_media || {};
  return {
    id: data.pk === undefined || data.pk === null ? null : String(data.pk),
    title: data.title || null,
    coverUrl: ((((cover.image_versions2 || {}).candidates || [])[0] || {}).url) || null,
    mediaCount: data.media_count === undefined ? null : data.media_count,
    raw: data,
  };
}

function highlightPkFromUrl(url) {
  const text = String(url || '');
  if (text.indexOf('/highlights/') === -1) {
    throw new Error('@alaminnna/ica-unofficial: URL must contain \'/highlights/\'');
  }
  const parts = text.split('?')[0].split('/').filter((p) => p && /^\d+$/.test(p));
  if (parts.length === 0) {
    throw new Error('@alaminnna/ica-unofficial: no highlight pk in URL');
  }
  return String(parts[0]);
}

async function getUserHighlights(client, userId, amount) {
  const params = {
    supported_capabilities_new: JSON.stringify(SUPPORTED_CAPABILITIES),
    phone_id: client.phoneId,
    battery_level: 50 + Math.floor(Math.random() * 50),
    panavision_mode: '',
    is_charging: Math.floor(Math.random() * 2),
    is_dark_mode: Math.floor(Math.random() * 2),
    will_sound_on: Math.floor(Math.random() * 2),
  };
  const res = await client.api.request({
    endpoint: 'highlights/' + userId + '/highlights_tray/',
    method: 'GET',
    params,
  });
  const tray = ((res || {}).tray) || [];
  const list = amount ? tray.slice(0, amount) : tray;
  return list.map(normalizeHighlight);
}

async function getHighlightInfo(client, highlightId) {
  const id = 'highlight:' + highlightId;
  const res = await client.api.request({
    endpoint: 'feed/reels_media/',
    method: 'POST',
    data: {
      exclude_media_ids: '[]',
      supported_capabilities_new: JSON.stringify(SUPPORTED_CAPABILITIES),
      source: 'profile',
      _uid: String(client.userId),
      _uuid: client.uuid,
      user_ids: [id],
    },
  });
  const reels = (res || {}).reels || {};
  if (!reels[id]) {
    throw new Error('@alaminnna/ica-unofficial: highlight not found: ' + highlightId);
  }
  return normalizeHighlight(reels[id]);
}

async function createHighlight(client, options) {
  const opts = options || {};
  const storyIds = (opts.storyIds || []).map(String);
  if (!opts.title || storyIds.length === 0) {
    throw new Error('@alaminnna/ica-unofficial: createHighlight needs { title, storyIds }');
  }
  const coverId = String(opts.coverStoryId || storyIds[0]);
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'highlights/create_reel/',
    method: 'POST',
    data: {
      supported_capabilities_new: JSON.stringify(SUPPORTED_CAPABILITIES),
      source: 'self_profile',
      creation_id: String(Math.floor(Date.now() / 1000)),
      _uid: String(client.userId),
      _uuid: client.uuid,
      cover: JSON.stringify({ media_id: coverId, crop_rect: JSON.stringify(opts.cropRect || DEFAULT_CROP_RECT) }),
      title: String(opts.title),
      media_ids: JSON.stringify(storyIds),
    },
  }));
  return normalizeHighlight((res || {}).reel || {});
}

async function editHighlight(client, highlightId, options) {
  const opts = options || {};
  const data = {
    supported_capabilities_new: JSON.stringify(SUPPORTED_CAPABILITIES),
    source: 'self_profile',
    _uid: String(client.userId),
    _uuid: client.uuid,
    added_media_ids: JSON.stringify(opts.addedMediaIds || []),
    removed_media_ids: JSON.stringify(opts.removedMediaIds || []),
  };
  if (opts.title) {
    data.title = String(opts.title);
  }
  if (opts.cover) {
    data.cover = JSON.stringify(opts.cover);
  }
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'highlights/highlight:' + highlightId + '/edit_reel/',
    method: 'POST',
    data,
  }));
  return normalizeHighlight((res || {}).reel || {});
}

async function changeHighlightTitle(client, highlightId, title) {
  return editHighlight(client, highlightId, { title });
}

async function changeHighlightCover(client, highlightId, coverPath) {
  const buffer = fs.readFileSync(coverPath);
  const out = await photoRupload(client, { buffer });
  return editHighlight(client, highlightId, {
    cover: { upload_id: String(out.uploadId), crop_rect: '[0.0,0.0,1.0,1.0]' },
  });
}

async function addStoriesToHighlight(client, highlightId, storyIds) {
  return editHighlight(client, highlightId, { addedMediaIds: (storyIds || []).map(String) });
}

async function removeStoriesFromHighlight(client, highlightId, storyIds) {
  return editHighlight(client, highlightId, { removedMediaIds: (storyIds || []).map(String) });
}

async function deleteHighlight(client, highlightId) {
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'highlights/highlight:' + highlightId + '/delete_reel/',
    method: 'POST',
    data: { _uid: String(client.userId), _uuid: client.uuid },
  }));
  return ((res || {}).status || '') === 'ok';
}

module.exports = {
  SUPPORTED_CAPABILITIES,
  normalizeHighlight,
  highlightPkFromUrl,
  getUserHighlights,
  getHighlightInfo,
  createHighlight,
  editHighlight,
  changeHighlightTitle,
  changeHighlightCover,
  addStoriesToHighlight,
  removeStoriesFromHighlight,
  deleteHighlight,
};