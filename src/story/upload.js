/**
 * @alaminnna/ica-unofficial — story/upload
 *
 * RESPONSIBILITY: story publishing only — photo/video story rupload,
 *   sticker payloads (mention/location/link/hashtag/media/sticker/poll),
 *   configure with retry, delete.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../upload/*, ../media/manage, client.api
 * MUST NOT:       never feed-publish here (src/upload owns feed)
 *
 * DEBUG: when stickers don't appear in-app, start looking here — tap_models
 *   field names (x/y/width/height/z/type) or missing story_sticker_ids
 */

'use strict';

const fs = require('node:fs');
const { assertPhotoFile, assertVideoFile, resolveUploadInput } = require('../upload/validate');
const { preparePhoto, readMp4Metadata } = require('../upload/thumb');
const {
  dumps,
  withDefaultData,
  msUploadId,
  rand9,
  photoRupload,
  videoRuploadInit,
  videoRuploadPut,
  extractMediaId,
  sleep,
} = require('../upload/rupload');
const { deleteMedia } = require('../media/manage');

function runUpload(client, fn) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard.schedule(fn);
  }
  return fn();
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isNaN(n) ? fallback : n;
}

// Resolve mention userIds (accepts userId or username).
async function resolveMentions(client, mentions) {
  const out = [];
  for (const mention of mentions || []) {
    let userId = mention.userId || (mention.user && (mention.user.pk || mention.user.id));
    if (!userId && mention.username && typeof client.getUserIdFromUsername === 'function') {
      userId = await client.getUserIdFromUsername(mention.username);
    }
    if (!userId) {
      throw new Error('@alaminnna/ica-unofficial: story mention needs { userId } or resolvable { username }');
    }
    out.push({ ...mention, userId: String(userId) });
  }
  return out;
}

async function validateLink(client, webUri) {
  try {
    await client.api.request({
      endpoint: 'media/validate_reel_url/',
      data: { url: String(webUri), _uid: String(client.userId), _uuid: client.uuid },
    });
  } catch (ignored) {
    // link validation is advisory only
  }
}

// Shared tap_models builder. Mode 'photo' keeps reel_mentions; 'video' uses text_metadata.
async function buildTapModels(client, parts, mode) {
  const tapModels = [];
  const storyStickerIds = [];
  const extra = {};
  const mentions = await resolveMentions(client, parts.mentions);
  if (mentions.length > 0) {
    const reelMentions = mentions.map((mention) => ({
      x: num(mention.x, 0.5),
      y: num(mention.y, 0.5),
      z: 0,
      width: num(mention.width, 0.3),
      height: num(mention.height, 0.1),
      rotation: 0.0,
      type: 'mention',
      user_id: String(mention.userId),
      is_sticker: false,
      display_type: 'mention_username',
    }));
    if (mode === 'photo') {
      extra.reel_mentions = dumps(reelMentions);
    } else {
      extra.text_metadata = dumps(mentions.map((mention) => ({
        font_size: 24.0, scale: 1.0, width: 366.0, height: 102.0,
        x: num(mention.x, 0.5), y: num(mention.y, 0.5), rotation: 0.0,
      })));
    }
    tapModels.push(...reelMentions);
  }
  (parts.hashtags || []).forEach((tag) => {
    storyStickerIds.push('hashtag_sticker');
    tapModels.push({
      x: num(tag.x, 0.5), y: num(tag.y, 0.5), z: 0,
      width: num(tag.width, 0.3), height: num(tag.height, 0.1), rotation: 0.0,
      type: 'hashtag', tag_name: tag.hashtag || tag.tag, is_sticker: true,
      tap_state: 0, tap_state_str_id: 'hashtag_sticker_gradient',
    });
  });
  (parts.locations || []).forEach((loc) => {
    storyStickerIds.push('location_sticker');
    tapModels.push({
      x: num(loc.x, 0.5), y: num(loc.y, 0.5), z: 0,
      width: num(loc.width, 0.3), height: num(loc.height, 0.1), rotation: 0.0,
      type: 'location', location_id: String(loc.locationId || loc.location_id || ''),
      is_sticker: true, tap_state: 0, tap_state_str_id: 'location_sticker_vibrant',
    });
  });
  const links = parts.links || [];
  const stickers = [...(parts.stickers || [])];
  if (links.length > 0) {
    const link = links[0];
    await validateLink(client, link.webUri || link.url);
    stickers.push({
      type: 'story_link', x: num(link.x, 0.5), y: num(link.y, 0.1), z: 0,
      width: num(link.width, 0.3), height: num(link.height, 0.1), rotation: 0,
      extra: { link_type: 'web', url: String(link.webUri || link.url), tap_state_str_id: 'link_sticker_default' },
    });
    storyStickerIds.push('link_sticker_default');
  }
  stickers.forEach((sticker) => {
    const stickerExtra = { ...(sticker.extra || {}) };
    if (sticker.id) {
      stickerExtra.str_id = sticker.id;
      storyStickerIds.push(sticker.id);
    }
    tapModels.push({
      x: num(sticker.x, 0.5), y: num(sticker.y, 0.5), z: num(sticker.z, 0),
      width: num(sticker.width, 0.3), height: num(sticker.height, 0.1),
      rotation: num(sticker.rotation, 0), type: sticker.type,
      is_sticker: true, selected_index: 0, tap_state: 0,
      ...stickerExtra,
    });
    if (sticker.type === 'gif') {
      extra.has_animated_sticker = '1';
    }
  });
  (parts.medias || []).forEach((feedMedia) => {
    if (!feedMedia.mediaPk) {
      throw new Error('@alaminnna/ica-unofficial: story media sticker needs { mediaPk }');
    }
    tapModels.push({
      x: num(feedMedia.x, 0.5), y: num(feedMedia.y, 0.5), z: 0,
      width: num(feedMedia.width, 0.4), height: num(feedMedia.height, 0.4), rotation: 0,
      type: 'feed_media', media_id: String(feedMedia.mediaPk),
      media_owner_id: String(feedMedia.userId || ''),
      product_type: 'feed', is_sticker: true, tap_state: 0,
      tap_state_str_id: 'feed_post_sticker_square',
    });
    extra.reshared_media_id = String(feedMedia.mediaPk);
  });
  (parts.polls || []).forEach((poll) => {
    storyStickerIds.push('polling_sticker_v2');
    tapModels.push({
      x: num(poll.x, 0.5), y: num(poll.y, 0.5), z: 0,
      width: num(poll.width, 0.5), height: num(poll.height, 0.2), rotation: 0,
      type: poll.type || 'poll', poll_type: poll.poll_type || 'text',
      is_sticker: true, tap_state: 0, tap_state_str_id: 'polling_sticker_v2',
      question: poll.question || '', color: poll.color || '#ffffff',
      tallies: (poll.options || ['Yes', 'No']).map((o) => ({ count: 0, font_size: 39.0, text: o })),
    });
  });
  return { tapModels, storyStickerIds, extra };
}

function applyTapModels(data, built, extraData) {
  if (built.tapModels.length > 0) {
    data.tap_models = dumps(built.tapModels);
  }
  if (built.storyStickerIds.length > 0) {
    data.story_sticker_ids = built.storyStickerIds.join(',');
  }
  Object.assign(data, built.extra, extraData || {});
  return data;
}

function photoStoryPayload(client, options) {
  const opts = options || {};
  const timestamp = Math.floor(Date.now() / 1000);
  const data = {
    text_metadata: '[{"font_size":40.0,"scale":1.0,"width":611.0,"height":169.0,' +
      '"x":0.51414347,"y":0.8487708,"rotation":0.0,' +
      '"format_type":"modern_refreshed_v2","effects":["default"]}]',
    has_original_sound: '1',
    camera_session_id: client.bundle.uuids.client_session_id,
    scene_capture_type: '',
    timezone_offset: String(client.bundle.timezoneOffset),
    client_shared_at: String(timestamp - 5),
    story_sticker_ids: '',
    media_folder: 'Camera',
    configure_mode: '1',
    source_type: '4',
    creation_surface: 'camera',
    imported_taken_at: timestamp - 3 * 24 * 3600,
    capture_type: 'normal',
    rich_text_format_types: '["modern_refreshed_v2"]',
    upload_id: opts.uploadId,
    client_timestamp: String(timestamp),
    device: client.bundle,
    _uid: String(client.userId),
    _uuid: client.uuid,
    device_id: client.androidDeviceId,
    composition_id: require('../core/utils').uuid4(),
    app_attribution_android_namespace: '',
    media_transformation_info: dumps({
      width: String(opts.width), height: String(opts.height),
      x_transform: '0', y_transform: '0', zoom: '1.0', rotation: '0.0', background_coverage: '0.0',
    }),
    original_media_type: 'photo',
    camera_entry_point: String(25 + Math.floor(Math.random() * 140)),
    edits: {
      crop_original_size: [opts.width * 1.0, opts.height * 1.0],
      filter_type: 0,
      filter_strength: 1.0,
    },
    extra: { source_width: opts.width, source_height: opts.height },
  };
  if (opts.caption) {
    data.caption = opts.caption;
  }
  return withDefaultData(client, applyTapModels(data, opts.built, opts.extraData));
}

function videoStoryPayload(client, options) {
  const opts = options || {};
  const timestamp = Math.floor(Date.now() / 1000);
  const data = {
    _uid: String(client.userId),
    has_original_sound: '1',
    filter_type: '0',
    camera_session_id: client.bundle.uuids.client_session_id,
    camera_entry_point: String(35 + Math.floor(Math.random() * 130)),
    composition_id: require('../core/utils').uuid4(),
    timezone_offset: String(client.bundle.timezoneOffset),
    client_timestamp: String(timestamp),
    client_shared_at: String(timestamp - 7),
    date_time_original: require('./reads').dateTimeOriginalStory(),
    configure_mode: '1',
    source_type: '3',
    video_result: '',
    creation_surface: 'camera',
    capture_type: 'normal',
    upload_id: opts.uploadId,
    original_media_type: 'video',
    camera_position: 'back',
    device: client.bundle,
    length: opts.duration,
    clips: [{ length: opts.duration, source_type: '3', camera_position: 'back' }],
    media_transformation_info: dumps({
      width: String(opts.width), height: String(opts.height),
      x_transform: '0', y_transform: '0', zoom: '1.0', rotation: '0.0', background_coverage: '0.0',
    }),
    extra: { source_width: opts.width, source_height: opts.height },
    audio_muted: false,
    poster_frame_index: 0,
  };
  if (opts.caption) {
    data.caption = opts.caption;
  }
  applyTapModels(data, opts.built, opts.extraData);
  if (opts.threadIds && opts.threadIds.length > 0) {
    const token = '68' + String(Math.floor(Math.random() * 1e17)).padStart(17, '0');
    Object.assign(data, {
      configure_mode: '2',
      allow_multi_configures: '1',
      client_context: token,
      is_shh_mode: '0',
      mutation_token: token,
      nav_chain: '1qT:feed_timeline:1,1qT:feed_timeline:7,ReelViewerFragment:reel_feed_timeline:21,5HT:attribution_quick_camera_fragment:22,4ji:reel_composer_preview:23,8wg:direct_story_audience_picker:24,4ij:reel_composer_camera:25,ReelViewerFragment:reel_feed_timeline:26',
      recipient_users: '[]',
      send_attribution: 'direct_story_audience_picker',
      thread_ids: dumps(opts.threadIds.map((id) => String(id))),
      view_mode: 'replayable',
    });
  }
  return withDefaultData(client, data);
}

async function recentStoryAfter(client, previousIds) {
  try {
    const { getUserStories } = require('./reads');
    const stories = await getUserStories(client, client.userId, 20);
    const found = stories.find((s) => !previousIds.has(String(s.id).split('_')[0]));
    return found ? String(found.id) : null;
  } catch (ignored) {
    return null;
  }
}

async function previousStoryIds(client) {
  try {
    const { getUserStories } = require('./reads');
    const stories = await getUserStories(client, client.userId, 20);
    return new Set(stories.map((s) => String(s.id).split('_')[0]));
  } catch (ignored) {
    return new Set();
  }
}

async function uploadPhotoStory(client, options) {
  const opts = options || {};
  return runUpload(client, async () => {
    const input = await resolveUploadInput({ path: opts.path, url: opts.url }, { ext: '.jpg' });
    try {
      const ext = assertPhotoFile(input.path);
      const built = await buildTapModels(client, opts, 'photo');
      const previousIds = await previousStoryIds(client);
      const prepared = await preparePhoto({ src: input.path, maxSide: 1080, quality: 80 });
      const imageType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const { uploadId } = await photoRupload(client, { buffer: prepared.buffer, imageType });
      let configured = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await sleep(3000);
        configured = await client.api.request({
          endpoint: 'media/configure_to_story/',
          data: photoStoryPayload(client, {
            uploadId, width: prepared.width, height: prepared.height,
            caption: opts.caption, built, extraData: opts.extraData,
          }),
        });
        if (configured) {
          break;
        }
      }
      let id = extractMediaId(configured, client.api.lastJson);
      if (!id) {
        id = await recentStoryAfter(client, previousIds);
      }
      if (!id) {
        throw new Error('@alaminnna/ica-unofficial: story configure succeeded without media payload');
      }
      return { id, storyId: id, uploadId };
    } finally {
      await input.cleanup();
    }
  });
}

async function uploadVideoStory(client, options) {
  const opts = options || {};
  return runUpload(client, async () => {
    const input = await resolveUploadInput({ path: opts.path, url: opts.url }, { ext: '.mp4' });
    try {
      assertVideoFile(input.path);
      const built = await buildTapModels(client, opts, 'video');
      const previousIds = await previousStoryIds(client);
      const meta = readMp4Metadata(input.path);
      const uploadId = msUploadId();
      const uploadName = uploadId + '_0_' + rand9();
      const waterfallId = require('../core/utils').uuid4();
      const durationMs = String(Math.floor(meta.duration * 1000));
      const args = {
        uploadId, uploadName, waterfallId, durationMs,
        width: meta.width, height: meta.height, toStory: true,
      };
      await videoRuploadInit(client, args);
      await videoRuploadPut(client, { ...args, buffer: fs.readFileSync(input.path) });
      let configured = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(3000);
        try {
          configured = await client.api.request({
            endpoint: 'media/configure_to_story/?video=1',
            data: videoStoryPayload(client, {
              uploadId, width: meta.width, height: meta.height, duration: meta.duration,
              caption: opts.caption, built, threadIds: opts.threadIds, extraData: opts.extraData,
            }),
          });
        } catch (err) {
          if (String((err && err.message) || err).indexOf('Transcode not finished yet') !== -1) {
            await sleep(10000);
            continue;
          }
          throw err;
        }
        if (configured) {
          break;
        }
      }
      let id = extractMediaId(configured, client.api.lastJson);
      if (!id) {
        id = await recentStoryAfter(client, previousIds);
      }
      if (!id) {
        throw new Error('@alaminnna/ica-unofficial: story configure succeeded without media payload');
      }
      return { id, storyId: id, uploadId };
    } finally {
      await input.cleanup();
    }
  });
}

async function deleteStory(client, storyId) {
  return deleteMedia(client, storyId);
}

module.exports = {
  uploadPhotoStory,
  uploadVideoStory,
  deleteStory,
  buildTapModels,
  photoStoryPayload,
  videoStoryPayload,
};