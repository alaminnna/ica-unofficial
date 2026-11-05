/**
 * @alaminnna/ica-unofficial — upload/photo
 *
 * RESPONSIBILITY: feed photo publishing only — rupload, media/configure retry,
 *   music variant. Crosspost/schedule/coauthor via crosspost.js builders.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./validate, ./thumb, ./rupload, ./crosspost, ../../core/delays
 * MUST NOT:       never import story/direct variants here (Phase 17 / direct own those)
 *
 * DEBUG: when photo configure returns no media, start looking here — retry count,
 *   usertag shape, or image dimensions from preparePhoto
 */

'use strict';

const { assertPhotoFile, resolveUploadInput } = require('./validate');
const { preparePhoto } = require('./thumb');
const {
  dumps,
  withDefaultData,
  dateTimeOriginal,
  softwareString,
  photoRupload,
  extractMediaId,
  sleep,
} = require('./rupload');
const { withCoauthorIds, withSchedule, resolveFeedCrosspost } = require('./crosspost');

const NAV_CHAIN = '8rL:self_profile:4,ProfileMediaTabFragment:self_profile:5,' +
  'UniversalCreationMenuFragment:universal_creation_menu:7,' +
  'ProfileMediaTabFragment:self_profile:8,' +
  'MediaCaptureFragment:tabbed_gallery_camera:9,' +
  'Dd3:photo_filter:10,' +
  'FollowersShareFragment:metadata_followers_share:11';

async function resolveUsertags(client, usertags) {
  const out = [];
  for (const tag of usertags || []) {
    let userId = tag.userId || (tag.user && (tag.user.pk || tag.user.id));
    if (!userId && tag.username && typeof client.getUserIdFromUsername === 'function') {
      userId = await client.getUserIdFromUsername(tag.username);
    }
    if (!userId) {
      throw new Error('@alaminnna/ica-unofficial: usertag needs { userId } or resolvable { username }');
    }
    out.push({ user_id: String(userId), position: [Number(tag.x) || 0, Number(tag.y) || 0] });
  }
  return out;
}

function buildLocation(location) {
  if (!location) {
    return '{}';
  }
  if (typeof location === 'string') {
    return location;
  }
  return dumps({
    name: location.name || '',
    address: location.address || '',
    lat: location.lat || '',
    lng: location.lng || '',
    external_source: location.external_id_source || location.externalSource || '',
    facebook_places_id: location.external_id || location.externalId || '',
  });
}

function photoConfigurePayload(client, options) {
  const opts = options || {};
  const settings = (client.bundle && client.bundle.deviceSettings) || {};
  return withDefaultData(client, {
    timezone_offset: String(client.bundle.timezoneOffset),
    camera_model: settings.model || '',
    camera_make: settings.manufacturer || '',
    scene_type: '?',
    nav_chain: NAV_CHAIN,
    date_time_original: dateTimeOriginal(),
    date_time_digitalized: dateTimeOriginal(),
    creation_logger_session_id: client.bundle.uuids.client_session_id,
    scene_capture_type: 'standard',
    software: softwareString(client),
    multi_sharing: '1',
    location: buildLocation(opts.location),
    media_folder: 'Camera',
    source_type: '4',
    caption: opts.caption || '',
    upload_id: opts.uploadId,
    device: client.bundle,
    usertags: dumps({ in: opts.usertags || [] }),
    edits: {
      crop_original_size: [opts.width * 1.0, opts.height * 1.0],
      crop_center: [0.0, 0.0],
      crop_zoom: 1.0,
    },
    extra: { source_width: opts.width, source_height: opts.height },
    ...(opts.extraData || {}),
  });
}

async function previousMediaIds(client) {
  try {
    if (typeof client.getUserMedias !== 'function' || !client.userId) {
      return null;
    }
    const list = await client.getUserMedias({ userId: client.userId, amount: 20 });
    return new Set((list || []).map((m) => String(m.mediaId || m.id)));
  } catch (ignored) {
    return null;
  }
}

async function recentMediaAfter(client, previousIds) {
  if (!previousIds || typeof client.getUserMedias !== 'function' || !client.userId) {
    return null;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const list = await client.getUserMedias({ userId: client.userId, amount: 20 });
      const found = (list || []).find((m) => !previousIds.has(String(m.mediaId || m.id)));
      if (found) {
        return String(found.mediaId || found.id);
      }
    } catch (ignored) {
      // keep polling
    }
    await sleep(3000);
  }
  return null;
}

async function runUpload(client, fn) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard.schedule(fn);
  }
  return fn();
}

async function uploadPhoto(client, options) {
  const opts = options || {};
  return runUpload(client, async () => {
    const input = await resolveUploadInput({ path: opts.path, url: opts.url }, { ext: '.jpg' });
    try {
      const ext = assertPhotoFile(input.path);
      let extra = withCoauthorIds(opts.extraData, opts.coauthorUserIds);
      extra = withSchedule(extra, opts.scheduleAt);
      extra = { ...(await resolveFeedCrosspost(client, { ...opts, extraData: extra })), ...extra };
      const usertags = await resolveUsertags(client, opts.usertags);
      const previousIds = await previousMediaIds(client);
      const prepared = await preparePhoto({ src: input.path, maxSide: 1080, quality: 80 });
      const imageType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      const { uploadId } = await photoRupload(client, { buffer: prepared.buffer, imageType });
      let configured = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await sleep(3000);
        configured = await client.api.request({
          endpoint: 'media/configure/',
          data: photoConfigurePayload(client, {
            uploadId,
            width: prepared.width,
            height: prepared.height,
            caption: opts.caption,
            usertags,
            location: opts.location,
            extraData: extra,
          }),
        });
        if (configured) {
          break;
        }
      }
      let mediaId = extractMediaId(configured, client.api.lastJson);
      if (!mediaId) {
        mediaId = await recentMediaAfter(client, previousIds);
      }
      if (!mediaId) {
        throw new Error('@alaminnna/ica-unofficial: photo configure succeeded without media payload');
      }
      return { id: mediaId, mediaId, uploadId };
    } finally {
      await input.cleanup();
    }
  });
}

// Feed photo with music metadata (no local muxing — metadata only).
async function uploadPhotoWithMusic(client, options) {
  const opts = options || {};
  const track = opts.track || {};
  const assetId = track.audio_asset_id || track.id;
  const clusterId = track.audio_cluster_id;
  if (!assetId || !clusterId) {
    throw new Error('@alaminnna/ica-unofficial: track needs { audio_asset_id|id, audio_cluster_id }');
  }
  const start = opts.audioStart !== undefined && opts.audioStart !== null ? Number(opts.audioStart) : 0;
  const alacorn = track.alacorn_session_id || opts.alacornSessionId;
  if (!alacorn) {
    throw new Error('@alaminnna/ica-unofficial: alacornSessionId required (from music browser) for photo music upload');
  }
  const musicParams = {
    audio_asset_id: String(assetId),
    audio_cluster_id: String(clusterId),
    audio_asset_start_time_in_ms: start,
    derived_content_start_time_in_ms: 0,
    overlap_duration_in_ms: Number(opts.overlap) || 30000,
    browse_session_id: opts.browseSessionId,
    product: 'music_in_feed',
    song_name: track.title || '',
    artist_name: track.display_artist || '',
    alacorn_session_id: alacorn,
    audio_apply_source: 0,
  };
  if (track.music_canonical_id) {
    musicParams.music_canonical_id = track.music_canonical_id;
  }
  return uploadPhoto(client, { ...opts, extraData: { ...(opts.extraData || {}), music_params: musicParams } });
}

module.exports = {
  uploadPhoto,
  uploadPhotoWithMusic,
  photoConfigurePayload,
  resolveUsertags,
  buildLocation,
};