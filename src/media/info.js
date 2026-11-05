/**
 * @alaminnna/ica-unofficial — media/info
 * 
 * RESPONSIBILITY: media info normalization plus shortcode/pk resolution.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./codec, client.api
 * MUST NOT:       never download here
 * 
 * DEBUG: when mediainfo fails on URLs, start looking here — pk resolution
 */

'use strict';

const { decodeShortcode, shortcodeFromPk } = require('./codec');

function bestImageUrl(imageVersions) {
  const candidates = ((imageVersions || {}).candidates) || [];
  if (candidates.length === 0) {
    return null;
  }
  let best = candidates[0];
  let bestArea = -1;
  candidates.forEach((candidate) => {
    const area = (candidate.height || 0) * (candidate.width || 0);
    if (area > bestArea) {
      bestArea = area;
      best = candidate;
    }
  });
  return best.url || null;
}

function bestVideoUrl(videoVersions) {
  const versions = videoVersions || [];
  if (versions.length === 0) {
    return { url: null, duration: null };
  }
  let best = versions[0];
  let bestArea = -1;
  versions.forEach((version) => {
    const area = (version.height || 0) * (version.width || 0);
    if (area > bestArea) {
      bestArea = area;
      best = version;
    }
  });
  return { url: best.url || null, duration: best.duration || null };
}

function normalizeMediaInfo(raw) {
  const data = raw || {};
  const user = data.user || {};
  return {
    mediaId: data.id ? String(data.id) : null,
    pk: data.pk ? String(data.pk) : null,
    userId: user.pk ? String(user.pk) : null,
    username: user.username || null,
    mediaType: data.media_type === undefined ? null : data.media_type,
    caption: ((data.caption || {}).text) || null,
    thumbnailUrl: bestImageUrl(data.image_versions2),
    videoUrl: bestVideoUrl(data.video_versions).url,
    videoDuration: bestVideoUrl(data.video_versions).duration,
    takenAt: data.taken_at === undefined ? null : data.taken_at,
  };
}

function pkFromInput(input) {
  const text = String(input || '').trim();
  if (/^https?:\/\//.test(text)) {
    const { mediaPkFromUrl } = require('./codec');
    const code = mediaPkFromUrl(text);
    return decodeShortcode(code);
  }
  return String(text).split('_')[0];
}

async function getMediaInfo(client, input) {
  const pk = pkFromInput(input);
  const res = await client.api.request({ endpoint: 'media/' + pk + '/info/', method: 'GET' });
  const items = (res || {}).items || [];
  if (items.length === 0) {
    const ex = require('../exceptions');
    throw new ex.ClientNotFoundError('@alaminnna/ica-unofficial: media not found: ' + pk, {});
  }
  return normalizeMediaInfo(items[0]);
}

module.exports = { bestImageUrl, bestVideoUrl, normalizeMediaInfo, pkFromInput, getMediaInfo, shortcodeFromPk };