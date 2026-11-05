/**
 * @alaminnna/ica-unofficial — upload/album
 *
 * RESPONSIBILITY: carousel publishing only — per-child rupload, children_metadata
 *   waterfall, configure_sidecar retry, music variant.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./validate, ./thumb, ./rupload, ./crosspost, ./photo, ./video
 * MUST NOT:       never reuse feed photo/video configure here — sidecar has its own endpoint
 *
 * DEBUG: when sidecar configure fails per-child, start looking here — child meta
 *   shapes (photo edits vs video clips) or thumb re-upload
 */

'use strict';

const fs = require('node:fs');
const { assertPhotoFile, assertVideoFile, resolveUploadInput, extOf } = require('./validate');
const { ensureVideoThumbnail } = require('./thumb');
const {
  dumps,
  withDefaultData,
  dateTimeOriginal,
  msUploadId,
  photoRupload,
  extractMediaId,
  sleep,
} = require('./rupload');
const { withCoauthorIds, withSchedule, resolveFeedCrosspost } = require('./crosspost');
const { resolveUsertags, buildLocation } = require('./photo');
const { ruploadVideo } = require('./video');

function runUpload(client, fn) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard.schedule(fn);
  }
  return fn();
}

async function resolveItem(input) {
  if (typeof input === 'string') {
    return { path: input, cleanup: async () => {} };
  }
  const resolved = await resolveUploadInput({ path: input.path, url: input.url }, { ext: '.bin' });
  return { path: resolved.path, cleanup: resolved.cleanup };
}

async function uploadChildPhoto(client, filePath) {
  const ext = assertPhotoFile(filePath);
  const { preparePhoto } = require('./thumb');
  const prepared = await preparePhoto({ src: filePath, maxSide: 1080, quality: 80 });
  const imageType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const { uploadId } = await photoRupload(client, { buffer: prepared.buffer, imageType, toAlbum: true });
  return {
    upload_id: uploadId,
    edits: dumps({
      crop_original_size: [prepared.width, prepared.height],
      crop_center: [0.0, -0.0],
      crop_zoom: 1.0,
    }),
    extra: dumps({ source_width: prepared.width, source_height: prepared.height }),
    scene_capture_type: '',
    scene_type: null,
  };
}

async function uploadChildVideo(client, filePath) {
  assertVideoFile(filePath);
  const up = await ruploadVideo(client, filePath, { toAlbum: true });
  const thumbBuffer = fs.readFileSync(up.thumbnail);
  await photoRupload(client, { buffer: thumbBuffer, uploadId: up.uploadId, imageType: 'image/jpeg' });
  return {
    upload_id: up.uploadId,
    clips: dumps([{ length: up.duration, source_type: '4' }]),
    extra: dumps({ source_width: up.width, source_height: up.height }),
    length: up.duration,
    poster_frame_index: '0',
    filter_type: '0',
    video_result: '',
    date_time_original: dateTimeOriginal(),
    audio_muted: 'false',
  };
}

function albumConfigurePayload(client, options) {
  const opts = options || {};
  const uploadId = msUploadId();
  const children = (opts.children || []).map((child, index) => {
    const enriched = { ...child };
    const tags = opts.usertagsByIndex && opts.usertagsByIndex[index];
    if (tags && tags.length > 0) {
      enriched.usertags = dumps({ in: tags });
    }
    return {
      source_type: '4',
      timezone_offset: String(client.bundle.timezoneOffset),
      device: dumps(client.bundle),
      ...enriched,
    };
  });
  return withDefaultData(client, {
    timezone_offset: String(client.bundle.timezoneOffset),
    source_type: '4',
    creation_logger_session_id: client.bundle.uuids.client_session_id,
    location: buildLocation(opts.location),
    caption: opts.caption || '',
    client_sidecar_id: uploadId,
    upload_id: uploadId,
    suggested_venue_position: -1,
    device: client.bundle,
    is_suggested_venue: false,
    children_metadata: children,
    ...(opts.extraData || {}),
  });
}

async function normalizeUsertags(client, usertags, childCount) {
  if (!usertags || usertags.length === 0) {
    return null;
  }
  if (Array.isArray(usertags[0])) {
    const perIndex = [];
    for (const group of usertags) {
      perIndex.push(await resolveUsertags(client, group));
    }
    return perIndex;
  }
  const flat = await resolveUsertags(client, usertags);
  const perIndex = new Array(childCount).fill(null).map(() => []);
  perIndex[0] = flat;
  return perIndex;
}

async function uploadAlbum(client, options) {
  const opts = options || {};
  return runUpload(client, async () => {
    if (!Array.isArray(opts.paths) || opts.paths.length === 0) {
      throw new Error('@alaminnna/ica-unofficial: album upload requires at least one media path.');
    }
    let extra = withCoauthorIds(opts.extraData, opts.coauthorUserIds);
    extra = withSchedule(extra, opts.scheduleAt);
    extra = { ...(await resolveFeedCrosspost(client, { ...opts, extraData: extra })), ...extra };
    const usertagsByIndex = await normalizeUsertags(client, opts.usertags, opts.paths.length);
    const children = [];
    const cleanups = [];
    try {
      for (const item of opts.paths) {
        const resolved = await resolveItem(item);
        cleanups.push(resolved.cleanup);
        const ext = extOf(resolved.path);
        if (ext === '.mp4') {
          children.push(await uploadChildVideo(client, resolved.path));
        } else {
          children.push(await uploadChildPhoto(client, resolved.path));
        }
      }
      let configured = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(3000);
        try {
          configured = await client.api.request({
            endpoint: 'media/configure_sidecar/',
            data: albumConfigurePayload(client, {
              children,
              caption: opts.caption,
              usertagsByIndex,
              location: opts.location,
              extraData: extra,
            }),
          });
        } catch (err) {
          if (String((err && err.message) || err).indexOf('Transcode not finished yet') !== -1) {
            continue;
          }
          throw err;
        }
        if (configured) {
          break;
        }
      }
      const mediaId = extractMediaId(configured, client.api.lastJson);
      if (!mediaId) {
        throw new Error('@alaminnna/ica-unofficial: album configure succeeded without media payload');
      }
      return { id: mediaId, mediaId, uploadId: mediaId };
    } finally {
      for (const cleanup of cleanups) {
        await cleanup();
      }
    }
  });
}

async function uploadAlbumWithMusic(client, options) {
  const opts = options || {};
  const track = opts.track || {};
  const assetId = track.audio_asset_id || track.id;
  const clusterId = track.audio_cluster_id;
  if (!assetId || !clusterId) {
    throw new Error('@alaminnna/ica-unofficial: track needs { audio_asset_id|id, audio_cluster_id }');
  }
  const alacorn = track.alacorn_session_id || opts.alacornSessionId;
  if (!alacorn) {
    throw new Error('@alaminnna/ica-unofficial: alacornSessionId required (from music browser) for album music upload');
  }
  const musicParams = {
    audio_asset_id: String(assetId),
    audio_cluster_id: String(clusterId),
    audio_asset_start_time_in_ms: opts.audioStart !== undefined && opts.audioStart !== null ? Number(opts.audioStart) : 0,
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
  return uploadAlbum(client, { ...opts, extraData: { ...(opts.extraData || {}), music_params: musicParams } });
}

module.exports = {
  uploadAlbum,
  uploadAlbumWithMusic,
  albumConfigurePayload,
};