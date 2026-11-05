/**
 * @alaminnna/ica-unofficial — story/reads
 *
 * RESPONSIBILITY: story reads + downloads only — user stories, single story,
 *   story download (moved verbatim from src/media/story.js).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../media/download, ../media/info, client.api
 * MUST NOT:       never publish here (upload.js owns publishing)
 *
 * DEBUG: when no current stories return, start looking here — feed endpoint params
 */

'use strict';

const { downloadUrl, sanitizeFilename } = require('../media/download');
const { bestImageUrl, bestVideoUrl } = require('../media/info');
const path = require('node:path');

function normalizeStory(raw, userId) {
  const data = raw || {};
  const isVideo = data.media_type === 2;
  return {
    id: data.pk ? String(data.pk) : null,
    mediaType: data.media_type === undefined ? null : data.media_type,
    thumbnailUrl: bestImageUrl(data.image_versions2),
    videoUrl: bestVideoUrl(data.video_versions).url,
    takenAt: data.taken_at === undefined ? null : data.taken_at,
    userId: userId ? String(userId) : null,
  };
}

async function getUserStories(client, userId, amount) {
  const res = await client.api.request({
    endpoint: 'feed/user/' + userId + '/story/',
    method: 'GET',
    params: { supported_capabilities_new: JSON.stringify(require('../core/device').SUPPORTED_CAPABILITIES || []) },
  });
  const items = (((res || {}).reel) || {}).items || [];
  const stories = items.map((item) => normalizeStory(item, userId));
  return amount ? stories.slice(0, amount) : stories;
}

async function getStory(client, storyId) {
  const full = String(storyId);
  const pk = full.split('_')[0];
  const userId = full.split('_')[1] || null;
  if (!userId) {
    throw new Error('@alaminnna/ica-unofficial: getStory needs full "pk_userid" story id');
  }
  const stories = await getUserStories(client, userId);
  const found = stories.find((story) => String(story.id).split('_')[0] === pk);
  if (!found) {
    const ex = require('../exceptions');
    throw new ex.ClientNotFoundError('@alaminnna/ica-unofficial: story not found: ' + storyId, {});
  }
  return found;
}

async function downloadStory(client, options) {
  const opts = options || {};
  const story = await getStory(client, opts.storyId);
  const isVideo = story.mediaType === 2;
  const url = isVideo ? story.videoUrl : story.thumbnailUrl;
  if (!url) {
    throw new Error('@alaminnna/ica-unofficial: story has no downloadable URL (expired?)');
  }
  const folder = opts.path ? path.dirname(opts.path) : (opts.folder || client.downloadFolder || './downloads');
  const filename = opts.path ? path.basename(opts.path) : sanitizeFilename('story_' + (story.id || 'file')) + (isVideo ? '.mp4' : '.jpg');
  return downloadUrl({ url, path: path.resolve(folder, filename) });
}

function dateTimeOriginalStory(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.000Z';
}

module.exports = { normalizeStory, getUserStories, getStory, downloadStory, dateTimeOriginalStory };