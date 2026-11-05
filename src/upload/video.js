/**
 * @alaminnna/ica-unofficial — upload/video
 *
 * RESPONSIBILITY: feed video publishing only — analyze, thumbnail, two-call
 *   rupload, media/configure/?video=1 with transcode retry.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./validate, ./thumb, ./rupload, ./crosspost, ./photo
 * MUST NOT:       never import story/direct variants here (Phase 17 / direct own those)
 *
 * DEBUG: when video configure loops on "Transcode not finished yet", this is
 *   normal (up to 50 attempts) — otherwise check thumb re-upload or dimensions
 */

'use strict';

const fs = require('node:fs');
const { assertVideoFile, resolveUploadInput } = require('./validate');
const { readMp4Metadata, ensureVideoThumbnail } = require('./thumb');
const {
  dumps,
  withDefaultData,
  dateTimeOriginal,
  msUploadId,
  rand9,
  photoRupload,
  videoRuploadInit,
  videoRuploadPut,
  extractMediaId,
  sleep,
} = require('./rupload');
const { withCoauthorIds, withSchedule, resolveFeedCrosspost } = require('./crosspost');
const { resolveUsertags, buildLocation } = require('./photo');

function runUpload(client, fn) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard.schedule(fn);
  }
  return fn();
}

function videoConfigurePayload(client, options) {
  const opts = options || {};
  return withDefaultData(client, {
    multi_sharing: '1',
    creation_logger_session_id: client.bundle.uuids.client_session_id,
    upload_id: opts.uploadId,
    source_type: '4',
    location: buildLocation(opts.location),
    poster_frame_index: 0,
    length: opts.duration,
    audio_muted: false,
    usertags: dumps({ in: opts.usertags || [] }),
    filter_type: '0',
    date_time_original: dateTimeOriginal(),
    timezone_offset: String(client.bundle.timezoneOffset),
    clips: [{ length: opts.duration, source_type: '4' }],
    extra: { source_width: opts.width, source_height: opts.height },
    device: client.bundle,
    caption: opts.caption || '',
    ...(opts.extraData || {}),
  });
}

// Shared video rupload (init GET + PUT bytes). Returns { uploadId, width, height, duration, thumbnail }.
async function ruploadVideo(client, filePath, options) {
  const opts = options || {};
  const meta = readMp4Metadata(filePath);
  const uploadId = msUploadId();
  const uploadName = uploadId + '_0_' + rand9();
  const waterfallId = require('../core/utils').uuid4();
  const durationMs = String(Math.floor(meta.duration * 1000));
  const putArgs = {
    uploadId, uploadName, waterfallId, durationMs,
    width: meta.width, height: meta.height,
    toAlbum: opts.toAlbum, toStory: opts.toStory, toDirect: opts.toDirect, isIgtv: opts.isIgtv,
  };
  await videoRuploadInit(client, putArgs);
  const buffer = fs.readFileSync(filePath);
  await videoRuploadPut(client, { ...putArgs, buffer });
  const thumbnail = await ensureVideoThumbnail({
    videoPath: filePath,
    thumbnailPath: opts.thumbnailPath,
    duration: meta.duration,
    outPath: opts.thumbOutPath || (filePath + '.jpg'),
    crop: opts.thumbCrop,
  });
  return { uploadId, width: meta.width, height: meta.height, duration: meta.duration, thumbnail };
}

async function uploadVideo(client, options) {
  const opts = options || {};
  return runUpload(client, async () => {
    const input = await resolveUploadInput({ path: opts.path, url: opts.url }, { ext: '.mp4' });
    try {
      assertVideoFile(input.path);
      let extra = withCoauthorIds(opts.extraData, opts.coauthorUserIds);
      extra = withSchedule(extra, opts.scheduleAt);
      extra = { ...(await resolveFeedCrosspost(client, { ...opts, extraData: extra })), ...extra };
      const usertags = await resolveUsertags(client, opts.usertags);
      const up = await ruploadVideo(client, input.path, { thumbnailPath: opts.thumbnail });
      const thumbBuffer = fs.readFileSync(up.thumbnail);
      await photoRupload(client, { buffer: thumbBuffer, uploadId: up.uploadId, imageType: 'image/jpeg' });
      let configured = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(3000);
        try {
          configured = await client.api.request({
            endpoint: 'media/configure/?video=1',
            data: videoConfigurePayload(client, {
              uploadId: up.uploadId,
              width: up.width,
              height: up.height,
              duration: up.duration,
              caption: opts.caption,
              usertags,
              location: opts.location,
              extraData: extra,
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
      const mediaId = extractMediaId(configured, client.api.lastJson);
      if (!mediaId) {
        throw new Error('@alaminnna/ica-unofficial: video configure succeeded without media payload');
      }
      return { id: mediaId, mediaId, uploadId: up.uploadId };
    } finally {
      await input.cleanup();
    }
  });
}

module.exports = {
  uploadVideo,
  videoConfigurePayload,
  ruploadVideo,
};