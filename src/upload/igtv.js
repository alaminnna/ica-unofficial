/**
 * @alaminnna/ica-unofficial — upload/igtv
 *
 * RESPONSIBILITY: IGTV publishing only — analyze, rupload with is_igtv_video,
 *   signed configure_to_igtv with transcode retry.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./validate, ./thumb, ./rupload, ./photo
 * MUST NOT:       never reuse feed video configure here — igtv has its own endpoint
 *
 * DEBUG: when igtv configure fails, start looking here — composer session id,
 *   poster_frame_index, or signed-request flag
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
const { resolveUsertags, buildLocation } = require('./photo');

function runUpload(client, fn) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard.schedule(fn);
  }
  return fn();
}

function igtvConfigurePayload(client, options) {
  const opts = options || {};
  return withDefaultData(client, {
    igtv_ads_toggled_on: '0',
    filter_type: '0',
    timezone_offset: String(client.bundle.timezoneOffset),
    media_folder: 'ScreenRecorder',
    location: buildLocation(opts.location),
    source_type: '4',
    title: opts.title || '',
    caption: opts.caption || '',
    usertags: dumps({ in: opts.usertags || [] }),
    date_time_original: dateTimeOriginal(),
    igtv_share_preview_to_feed: '1',
    upload_id: opts.uploadId,
    igtv_composer_session_id: opts.composerSessionId,
    device: client.bundle,
    length: opts.duration,
    clips: [{ length: opts.duration, source_type: '4' }],
    extra: { source_width: opts.width, source_height: opts.height },
    audio_muted: false,
    poster_frame_index: 70,
    ...(opts.extraData || {}),
  });
}

async function uploadIGTV(client, options) {
  const opts = options || {};
  return runUpload(client, async () => {
    if (!opts.title) {
      throw new Error('@alaminnna/ica-unofficial: igtv upload needs { title }');
    }
    const input = await resolveUploadInput({ path: opts.path, url: opts.url }, { ext: '.mp4' });
    try {
      assertVideoFile(input.path);
      const usertags = await resolveUsertags(client, opts.usertags);
      const meta = readMp4Metadata(input.path);
      const uploadId = msUploadId();
      const uploadName = uploadId + '_0_' + rand9();
      const waterfallId = require('../core/utils').uuid4();
      const durationMs = String(Math.floor(meta.duration * 1000));
      const args = {
        uploadId, uploadName, waterfallId, durationMs,
        width: meta.width, height: meta.height, isIgtv: true,
      };
      await videoRuploadInit(client, args);
      await videoRuploadPut(client, { ...args, buffer: fs.readFileSync(input.path) });
      const thumbnail = await ensureVideoThumbnail({
        videoPath: input.path,
        thumbnailPath: opts.thumbnail,
        duration: meta.duration,
        outPath: input.path + '.jpg',
      });
      const thumbBuffer = fs.readFileSync(thumbnail);
      await photoRupload(client, { buffer: thumbBuffer, uploadId, imageType: 'image/jpeg' });
      const composerSessionId = require('../core/utils').uuid4();
      let configured = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(Number(opts.configureTimeout) || 10000);
        try {
          configured = await client.api.request({
            endpoint: 'media/configure_to_igtv/?video=1',
            withSignature: true,
            data: igtvConfigurePayload(client, {
              uploadId,
              width: meta.width,
              height: meta.height,
              duration: meta.duration,
              title: opts.title,
              caption: opts.caption,
              usertags,
              location: opts.location,
              composerSessionId,
              extraData: opts.extraData,
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
        throw new Error('@alaminnna/ica-unofficial: igtv configure succeeded without media payload');
      }
      return { id: mediaId, mediaId, uploadId };
    } finally {
      await input.cleanup();
    }
  });
}

module.exports = {
  uploadIGTV,
  igtvConfigurePayload,
};