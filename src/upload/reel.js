/**
 * @alaminnna/ica-unofficial — upload/reel
 *
 * RESPONSIBILITY: reel publishing only — upload_settings, reels rupload,
 *   signed configure_to_clips, trial/topics/cover/music, preflights.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./validate, ./thumb, ./rupload, ./crosspost, ./photo
 * MUST NOT:       never reuse feed video configure here — clips has its own endpoint
 *
 * DEBUG: when reel configure fails, start looking here — upload_settings first
 *   (composer session), then reels rupload params, then clips payload
 */

'use strict';

const fs = require('node:fs');
const { assertVideoFile, assertPhotoFile, resolveUploadInput } = require('./validate');
const { readMp4Metadata, ensureVideoThumbnail } = require('./thumb');
const {
  dumps,
  withDefaultData,
  msUploadId,
  photoRupload,
  clipUploadSettings,
  uploadHeaders,
  extractMediaId,
  sleep,
  API_DOMAIN,
} = require('./rupload');
const { resolveReelsCrosspost } = require('./crosspost');
const { resolveUsertags, buildLocation } = require('./photo');

function runUpload(client, fn) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard.schedule(fn);
  }
  return fn();
}

function feedShowValue(showPreviewInFeed, feedShow) {
  if (feedShow !== undefined && feedShow !== null) {
    return String(feedShow);
  }
  return showPreviewInFeed === false ? '0' : '1';
}

// Reels rupload: same GET-init + POST-bytes shape, reels-specific params.
async function clipRupload(client, filePath, options) {
  const opts = options || {};
  const meta = readMp4Metadata(filePath);
  const uploadId = msUploadId();
  const buffer = fs.readFileSync(filePath);
  const durationMs = String(Math.floor(meta.duration * 1000));
  const composerSessionId = require('../core/utils').uuid4();
  const assetId = require('../core/utils').uuid4().replace(/-/g, '').slice(0, 12).toUpperCase();
  await clipUploadSettings(client, {
    composerSessionId,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
    durationMs: Number(durationMs),
    clipLen: buffer.length,
    assetId,
    userId: client.userId,
  });
  const uploadName = require('../core/utils').uuid4().replace(/-/g, '') +
    '-0-' + buffer.length + '-' + uploadId + '-' + uploadId;
  const params = {
    provenance_metadata: dumps({ origin: ['EXTERNAL'] }),
    upload_media_height: String(meta.height),
    share_type: 'reels',
    debug_segment_id: '0',
    extract_cover_frame: '1',
    upload_engine_config_enum: '0',
    xsharing_user_ids: '[]',
    upload_media_width: String(meta.width),
    stella_data: '{}',
    is_clips_video: '1',
    is_optimistic_upload: 'true',
    upload_media_duration_ms: durationMs,
    content_tags: 'use_default_cover',
    upload_id: uploadId,
    retry_context: '{"num_reupload":0,"num_step_manual_retry":0,"num_step_auto_retry":0}',
    session_id: uploadId,
    media_type: '2',
  };
  const waterfallId = composerSessionId + '_' + assetId + '_Mixed_0';
  const initHeaders = uploadHeaders(client, {
    'Accept-Encoding': 'gzip',
    'X-Instagram-Rupload-Params': dumps(params),
    'X_FB_VIDEO_WATERFALL_ID': waterfallId,
    'X-Entity-Type': 'video/mp4',
    'Segment-Start-Offset': '0',
    'Segment-Type': '3',
  });
  try {
    await client.http.axios.get('https://' + API_DOMAIN + '/rupload_igvideo/' + uploadName, { headers: initHeaders, timeout: 60000 });
  } catch (err) {
    throw new Error('@alaminnna/ica-unofficial: clip rupload init failed: HTTP ' + ((err && err.response && err.response.status) || '?'));
  }
  const putHeaders = uploadHeaders(client, {
    Offset: '0',
    'X-Entity-Name': uploadName,
    'X-Entity-Length': String(buffer.length),
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(buffer.length),
    ...initHeaders,
  });
  try {
    await client.http.axios.post('https://' + API_DOMAIN + '/rupload_igvideo/' + uploadName, buffer, { headers: putHeaders, timeout: 300000, maxBodyLength: Infinity });
  } catch (err) {
    throw new Error('@alaminnna/ica-unofficial: clip rupload put failed: HTTP ' + ((err && err.response && err.response.status) || '?'));
  }
  const thumbnail = await ensureVideoThumbnail({
    videoPath: filePath,
    thumbnailPath: opts.thumbnailPath,
    duration: meta.duration,
    outPath: opts.thumbOutPath || (filePath + '.jpg'),
  });
  return { uploadId, width: meta.width, height: meta.height, duration: meta.duration, thumbnail };
}

function reelConfigurePayload(client, options) {
  const opts = options || {};
  const feedShow = feedShowValue(opts.showPreviewInFeed, opts.feedShow);
  return withDefaultData(client, {
    filter_type: '0',
    timezone_offset: String(client.bundle.timezoneOffset),
    location: buildLocation(opts.location),
    source_type: '4',
    caption: opts.caption || '',
    usertags: dumps({ in: opts.usertags || [] }),
    clips_share_preview_to_feed: feedShow,
    upload_id: opts.uploadId,
    device: client.bundle,
    length: opts.duration,
    clips_segments_metadata: {
      num_segments: 1,
      clips_segments: [{
        index: 0,
        face_effect_id: null,
        speed: 100,
        source_type: 4,
        duration_ms: Math.floor(opts.duration * 1000),
        audio_type: 'original',
        from_draft: 0,
        camera_position: -1,
        media_folder: null,
        media_type: 'video',
        original_media_type: 2,
        original_segment_hash: null,
        is_remix: false,
        has_reusable_template_asset: false,
      }],
    },
    clips_audio_metadata: { original: { volume_level: 1.0 } },
    additional_audio_info: { has_voiceover_attribution: 0 },
    edits: { filter_type: 0, filter_strength: 1.0 },
    capture_type: 'clips_v2',
    clips_creation_entry_point: 'clips',
    camera_entry_point: '71',
    audience: 'default',
    include_e2ee_mentioned_user_list: '1',
    hide_from_profile_grid: 'false',
    original_width: opts.width,
    original_height: opts.height,
    extra: { source_width: opts.width, source_height: opts.height },
    audio_muted: false,
    poster_frame_index: 70,
    ...(opts.extraData || {}),
  });
}

async function uploadReel(client, options) {
  const opts = options || {};
  return runUpload(client, async () => {
    const input = await resolveUploadInput({ path: opts.path, url: opts.url }, { ext: '.mp4' });
    try {
      assertVideoFile(input.path);
      let extra = { ...(opts.extraData || {}) };
      extra = { ...(await resolveReelsCrosspost(client, { ...opts, extraData: extra })), ...extra };
      let feedShow = feedShowValue(opts.showPreviewInFeed, opts.feedShow);
      if (opts.trial) {
        feedShow = '0';
        if (!extra.trial_params) {
          extra.trial_params = { graduation_strategy: opts.trialGraduationStrategy || 'manual' };
        }
      }
      if (opts.topics && !extra.interest_topics) {
        extra.interest_topics = (opts.topics || []).map((t) => String(t));
      }
      const usertags = await resolveUsertags(client, opts.usertags);
      const up = await clipRupload(client, input.path, { thumbnailPath: opts.thumbnail });
      const thumbBuffer = fs.readFileSync(up.thumbnail);
      await photoRupload(client, { buffer: thumbBuffer, uploadId: up.uploadId, imageType: 'image/jpeg' });
      let configured = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(Number(opts.configureTimeout) || 10000);
        try {
          configured = await client.api.request({
            endpoint: 'media/configure_to_clips/?video=1',
            withSignature: true,
            data: reelConfigurePayload(client, {
              uploadId: up.uploadId,
              width: up.width,
              height: up.height,
              duration: up.duration,
              caption: opts.caption,
              usertags,
              location: opts.location,
              feedShow,
              showPreviewInFeed: opts.showPreviewInFeed,
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
        throw new Error('@alaminnna/ica-unofficial: reel configure succeeded without media payload');
      }
      return { id: mediaId, mediaId, uploadId: up.uploadId };
    } finally {
      await input.cleanup();
    }
  });
}

// Trial preflight: clips_info_for_creation → trial_config.is_enabled
async function clipTrialEligible(client) {
  const res = await client.api.request({
    endpoint: 'clips/clips_info_for_creation/',
    method: 'GET',
    params: { device_status: dumps({ hw_av1_dec: false, hw_vp9_dec: false, hw_avc_dec: false, chip_vendor: 'others', chip_name: 'unknown', core_count: 0 }) },
  });
  return Boolean(res && res.trial_config && res.trial_config.is_enabled);
}

// Topic catalog: interest_nux/list_all → sub_interests[] ({name, fit_id})
async function clipInterestTopics(client) {
  const res = await client.api.request({
    endpoint: 'interest_nux/list_all/',
    method: 'GET',
    params: { caller: 'INTEREST_NUX' },
  });
  return (res && res.sub_interests) || [];
}

// Change published reel cover: photo_rupload + configure_to_clips_cover_image
async function changeReelCover(client, mediaPk, coverPath) {
  if (!mediaPk) {
    throw new Error('@alaminnna/ica-unofficial: changeReelCover needs { mediaPk, coverPath }');
  }
  assertPhotoFile(coverPath);
  const { preparePhoto } = require('./thumb');
  const prepared = await preparePhoto({ src: coverPath, maxSide: 1080, quality: 80 });
  const { uploadId } = await photoRupload(client, { buffer: prepared.buffer, imageType: 'image/jpeg' });
  const res = await client.api.request({
    endpoint: 'media/configure_to_clips_cover_image/',
    data: withDefaultData(client, { upload_id: String(uploadId), clips_media_id: String(mediaPk) }),
  });
  return Boolean((res && res.success) || (res && res.status === 'ok'));
}

// Reel with music metadata (no local muxing).
async function uploadReelWithMusic(client, options) {
  const opts = options || {};
  const track = opts.track || {};
  const assetId = track.audio_asset_id || track.id;
  const clusterId = track.audio_cluster_id;
  if (!assetId || !clusterId) {
    throw new Error('@alaminnna/ica-unofficial: track needs { audio_asset_id|id, audio_cluster_id }');
  }
  const start = opts.audioStart !== undefined && opts.audioStart !== null ? Number(opts.audioStart) : 0;
  const data = {
    clips_audio_metadata: {
      original: { volume_level: 0 },
      song: {
        volume_level: 1.0,
        is_saved: '0',
        artist_name: track.display_artist || '',
        audio_asset_id: String(assetId),
        audio_cluster_id: String(clusterId),
        track_name: track.title || '',
        is_picked_precapture: '1',
      },
    },
    music_params: {
      audio_asset_id: String(assetId),
      audio_cluster_id: String(clusterId),
      audio_asset_start_time_in_ms: start,
      derived_content_start_time_in_ms: 0,
      overlap_duration_in_ms: Number(opts.overlap) || 30000,
      product: opts.product || 'story_camera_clips_v2',
      song_name: track.title || '',
      artist_name: track.display_artist || '',
      alacorn_session_id: track.alacorn_session_id || opts.alacornSessionId || 'null',
    },
  };
  if (track.music_canonical_id) {
    data.clips_audio_metadata.song.music_canonical_id = track.music_canonical_id;
    data.music_params.music_canonical_id = track.music_canonical_id;
  }
  return uploadReel(client, { ...opts, extraData: { ...(opts.extraData || {}), ...data } });
}

module.exports = {
  uploadReel,
  uploadReelWithMusic,
  reelConfigurePayload,
  clipRupload,
  clipTrialEligible,
  clipInterestTopics,
  changeReelCover,
};