/**
 * @alaminnna/ica-unofficial — message/sending/media
 * 
 * RESPONSIBILITY: photo/video/voice upload sends over HTTP Direct API.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../threads/threads, ../../core/device, ../../exceptions
 * MUST NOT:       never touch listener state
 * 
 * DEBUG: when uploads fail or composition ids mismatch, start looking here — upload flow
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const axios = require('axios');
const { generateMutationToken } = require('../../core/device');
const { normalizeMessage, NAV_CHAIN } = require('../threads/threads');
const { DirectThreadNotFound } = require('../../exceptions');

function compactJson(obj) {
  return JSON.stringify(obj);
}

function asIdList(ids) {
  if (ids === undefined || ids === null) {
    return [];
  }
  if (typeof ids === 'number' || typeof ids === 'string') {
    return [String(ids)];
  }
  return ids.map((id) => String(id));
}

async function resolveTargetThread(client, options, kind) {
  const threadIds = asIdList(options.threadIds === undefined ? options.threadId : options.threadIds);
  const userIds = asIdList(options.userIds === undefined ? options.userId : options.userIds);
  if ((!threadIds.length && !userIds.length) || (threadIds.length && userIds.length)) {
    throw new Error('@alaminnna/ica-unofficial: specify threadIds or userIds, but not both');
  }
  if (threadIds.length > 0) {
    return threadIds.map((id) => String(id));
  }
  const res = await client.api.request({
    endpoint: 'direct_v2/thread_by_participants/',
    method: 'GET',
    params: { recipient_users: compactJson(userIds.map((id) => Number(id))) },
  });
  const thread = (res || {}).thread || {};
  const threadId = thread.thread_v2_id || thread.thread_id || ((client.api.lastJson || {}).thread || {}).thread_id;
  if (!threadId) {
    throw new DirectThreadNotFound('@alaminnna/ica-unofficial: no existing direct thread found for participants; direct ' + kind + ' send currently requires an existing thread', { user_ids: userIds });
  }
  return [String(threadId)];
}

async function loadSource(source, httpGet) {
  if (source.path) {
    return { bytes: fs.readFileSync(source.path), ext: path.extname(source.path).toLowerCase() };
  }
  if (source.url) {
    const get = httpGet || ((url) => axios.get(url, { responseType: 'arraybuffer', timeout: 60000 }).then((res) => Buffer.from(res.data)));
    const bytes = await get(source.url);
    const pathname = String(source.url).split('?')[0];
    return { bytes, ext: path.extname(pathname).toLowerCase() };
  }
  throw new Error('@alaminnna/ica-unofficial: media send needs { path } or { url }');
}

function hasJpegMagic(bytes) {
  return bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasFtyp(bytes) {
  if (bytes.length < 12) {
    return false;
  }
  return bytes.slice(4, 8).toString('ascii') === 'ftyp';
}

function validateImage(bytes, ext) {
  if (['.jpg', '.jpeg', '.png', '.webp'].indexOf(ext) === -1) {
    throw new Error('@alaminnna/ica-unofficial: invalid image format (only JPG/JPEG/PNG/WEBP)');
  }
  if (!hasJpegMagic(bytes)) {
    throw new Error('@alaminnna/ica-unofficial: only JPEG passthrough supported without re-encode deps (file is not JPEG)');
  }
  return true;
}

function validateVideoMp4(bytes) {
  if (!hasFtyp(bytes)) {
    throw new Error('@alaminnna/ica-unofficial: video must be MP4 with ftyp box (.mp4 H.264)');
  }
  return true;
}

function validateVoiceM4a(bytes, ext) {
  if (ext !== '.m4a') {
    throw new Error('@alaminnna/ica-unofficial: voice file must be .m4a (AAC in MP4)');
  }
  if (!hasFtyp(bytes)) {
    throw new Error('@alaminnna/ica-unofficial: voice file is not a valid MP4 container (ftyp missing)');
  }
  return true;
}

function mp4Dimensions(bytes) {
  const fallback = { width: 720, height: 1280, duration: 1.0 };
  try {
    let offset = 0;
    let mvhd = null;
    let tkhd = null;
    while (offset + 8 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      const boxType = bytes.slice(offset + 4, offset + 8).toString('ascii');
      if (size < 8) {
        break;
      }
      if (boxType === 'mvhd' && mvhd === null && size >= 32) {
        const version = bytes[offset + 8];
        if (version === 0) {
          const timescale = bytes.readUInt32BE(offset + 20);
          const duration = bytes.readUInt32BE(offset + 24);
          mvhd = timescale > 0 ? duration / timescale : fallback.duration;
        } else if (size >= 36) {
          const timescale = bytes.readUInt32BE(offset + 28);
          const durationHigh = bytes.readUInt32BE(offset + 32);
          const durationLow = bytes.readUInt32BE(offset + 36);
          const duration = durationHigh * 4294967296 + durationLow;
          mvhd = timescale > 0 ? duration / timescale : fallback.duration;
        }
      }
      if (boxType === 'tkhd' && tkhd === null && size >= 92) {
        const width = bytes.readUInt32BE(offset + 84) / 65536;
        const height = bytes.readUInt32BE(offset + 88) / 65536;
        if (width > 0 && height > 0) {
          tkhd = { width: Math.round(width), height: Math.round(height) };
        }
      }
      if (mvhd !== null && tkhd !== null) {
        break;
      }
      offset += size;
    }
    return { width: tkhd ? tkhd.width : fallback.width, height: tkhd ? tkhd.height : fallback.height, duration: mvhd || fallback.duration };
  } catch (err) {
    return fallback;
  }
}function uploadHeaders(client, extra) {
  const headers = {
    authorization: client.getAuthHeader ? client.getAuthHeader() : '',
    'ig-intended-user-id': String(client.userId || ''),
    'ig-u-ds-user-id': String(client.userId || ''),
    'accept-encoding': 'gzip',
    'accept-language': 'en-US',
    priority: 'u=6, i',
    'user-agent': client.userAgent || '',
    'x-fb-client-ip': 'True',
    'x-fb-friendly-name': 'undefined:media-upload',
    'x-fb-http-engine': 'Tigon/MNS/TCP',
    'x-fb-request-analytics-tags': '{"network_tags":{"product":"567067343352427","surface":"undefined","request_category":"media_upload","purpose":"none","retry_attempt":"0"}}',
    'x-fb-rmd': 'state=URL_ELIGIBLE',
    'x-fb-server-cluster': 'True',
    'x-tigon-is-retry': 'False',
    'x-ig-salt-ids': '51052545',
  };
  if (client.igURur) {
    headers['ig-u-rur'] = client.igURur;
  }
  if (client.mid) {
    headers['x-mid'] = client.mid;
  }
  return { ...headers, ...(extra || {}) };
}

function createUploadClient(deps) {
  const instance = axios.create({ timeout: 120000 });
  return {
    async get(url, headers) {
      const res = await instance.get(url, { headers });
      return res.data;
    },
    async post(url, bytes, headers) {
      const res = await instance.post(url, bytes, { headers, maxBodyLength: Infinity });
      return res.data;
    },
  };
}

async function ruploadOnce(upload, method, url, bytes, headers) {
  if (method === 'get') {
    return upload.get(url, headers);
  }
  return upload.post(url, bytes, headers);
}

async function ruploadPhoto(client, bytes, upload) {
  const entity = 'fb_uploader_' + Date.now();
  const url = 'https://rupload.facebook.com/messenger_image/' + entity;
  const base = uploadHeaders(client, {
    image_type: 'FILE_ATTACHMENT',
    'content-type': 'application/octet-stream',
    offset: '0',
    'x-entity-length': String(bytes.length),
    'x-entity-name': entity,
    'x-entity-type': 'image/jpeg',
  });
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await ruploadOnce(upload, 'post', url, bytes, base);
      if (res && res.media_id !== undefined) {
        return Number(res.media_id);
      }
      throw new Error('messenger_image response missing media_id');
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error('@alaminnna/ica-unofficial: photo upload failed: ' + ((lastError && lastError.message) || lastError));
}

async function ruploadVideo(client, bytes, upload) {
  const hexId = crypto.randomBytes(16).toString('hex');
  const ms = Date.now();
  const entity = hexId + '-0-' + bytes.length + '-' + ms + '-' + ms;
  const url = 'https://rupload.facebook.com/messenger_video/' + entity;
  const uploadId = String(100000000000 + Math.floor(Math.random() * 900000000000));
  const waterfall = uploadId + '_' + hexId.slice(0, 12).toUpperCase() + '_Mixed_0';
  const base = uploadHeaders(client, {
    video_type: 'FILE_ATTACHMENT',
    'segment-start-offset': '0',
    'segment-type': '3',
    ephemeral_media_view_mode: '2',
    ig_raven_metadata: '{}',
    x_fb_video_waterfall_id: waterfall,
  });
  const offsetRes = await ruploadOnce(upload, 'get', url, null, base).catch(() => ({ offset: 0 }));
  const offset = Number((offsetRes && offsetRes.offset) || 0);
  const postHeaders = { ...base, 'content-type': 'application/octet-stream', offset: String(offset), 'x-entity-length': String(bytes.length), 'x-entity-name': entity, 'x-entity-type': 'video/mp4' };
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await ruploadOnce(upload, 'post', url, bytes.slice(offset), postHeaders);
      if (res && res.media_id !== undefined) {
        return { mediaId: Number(res.media_id), uploadId, waterfallId: waterfall };
      }
      throw new Error('messenger_video response missing media_id');
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error('@alaminnna/ica-unofficial: video upload failed: ' + ((lastError && lastError.message) || lastError));
}

async function ruploadVoice(client, bytes, upload) {
  const uploadId = String(Date.now());
  const randKey = Math.floor(Math.random() * 4294967296) - 2147483648;
  const entity = uploadId + '_0_' + randKey;
  const url = 'https://rupload.facebook.com/messenger_audio/' + entity;
  const base = uploadHeaders(client, { audio_type: 'FILE_ATTACHMENT' });
  const offsetRes = await ruploadOnce(upload, 'get', url, null, base).catch(() => ({ offset: 0 }));
  const offset = Number((offsetRes && offsetRes.offset) || 0);
  const postHeaders = { ...base, 'content-type': 'application/octet-stream', offset: String(offset), 'x-entity-length': String(bytes.length), 'x-entity-name': entity, 'x-entity-type': 'audio/mp4' };
  const res = await ruploadOnce(upload, 'post', url, bytes.slice(offset), postHeaders);
  if (!res || res.media_id === undefined) {
    throw new Error('@alaminnna/ica-unofficial: voice upload failed (missing media_id)');
  }
  return { mediaId: Number(res.media_id), uploadId };
}async function sendPhoto(client, options, deps) {
  const opts = options || {};
  const upload = (deps && deps.upload) || createUploadClient();
  const threadIds = await resolveTargetThread(client, opts, 'photo');
  const { bytes, ext } = await loadSource(opts, deps && deps.httpGet);
  validateImage(bytes, ext);
  const mediaId = await ruploadPhoto(client, bytes, upload);
  const token = generateMutationToken();
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/broadcast/photo_attachment/',
    data: {
      action: 'send_item',
      is_x_transport_forward: 'false',
      is_shh_mode: '0',
      thread_ids: compactJson(threadIds),
      send_attribution: 'inbox',
      client_context: token,
      attachment_fbid: String(mediaId),
      device_id: client.androidDeviceId,
      mutation_token: token,
      _uuid: client.uuid,
      allow_full_aspect_ratio: 'true',
      btt_dual_send: 'false',
      is_ae_dual_send: 'false',
      offline_threading_id: token,
    },
  });
  return normalizeMessage((res || {}).payload || {});
}

async function sendVideo(client, options, deps) {
  const opts = options || {};
  const upload = (deps && deps.upload) || createUploadClient();
  const threadIds = await resolveTargetThread(client, opts, 'video');
  const { bytes } = await loadSource(opts, deps && deps.httpGet);
  validateVideoMp4(bytes);
  const meta = mp4Dimensions(bytes);
  const { mediaId, uploadId } = await ruploadVideo(client, bytes, upload);
  const token = generateMutationToken();
  const compositionId = require('../../core/utils').uuid4();
  const cameraSessionId = require('../../core/utils').uuid4();
  const nowSec = String(Math.floor(Date.now() / 1000));
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/broadcast/raven_attachment/?video=1',
    withSignature: true,
    data: {
      recipient_users: '[]',
      view_mode: 'permanent',
      has_camera_metadata: '1',
      camera_entry_point: '3',
      thread_ids: compactJson(threadIds),
      reshare_mode: 'allow_reshare',
      original_media_type: '2',
      send_attribution: 'direct_composer',
      client_context: token,
      camera_session_id: cameraSessionId,
      attachment_fbid: String(mediaId),
      include_e2ee_mentioned_user_list: '1',
      hide_from_profile_grid: 'false',
      timezone_offset: '0',
      client_shared_at: nowSec,
      configure_mode: '2',
      source_type: '3',
      camera_position: 'back',
      video_result: String(mediaId),
      _uid: String(client.userId || ''),
      device_id: client.androidDeviceId,
      composition_id: compositionId,
      mutation_token: token,
      _uuid: client.uuid,
      creation_surface: 'camera',
      has_ig_camera_edits: 'false',
      capture_type: 'normal',
      audience: 'default',
      upload_id: uploadId,
      client_timestamp: nowSec,
      media_transformation_info: compactJson({ width: String(meta.width), height: String(meta.height), x_transform: '0', y_transform: '0', zoom: '1.0', rotation: '0.0', background_coverage: '0.0' }),
      clips: compactJson([{ length: meta.duration, source_type: '3', camera_position: 'back' }]),
      poster_frame_index: 0,
      length: meta.duration,
      audio_muted: false,
      edits: compactJson({ filter_type: 0, filter_strength: 1.0 }),
      extra: compactJson({ source_width: meta.width, source_height: meta.height }),
      device: compactJson({ manufacturer: 'Google', model: 'sdk_gphone_arm64', android_version: 30, android_release: '11' }),
    },
  });
  return normalizeMessage((res || {}).payload || {});
}

async function sendVoice(client, options, deps) {
  const opts = options || {};
  const upload = (deps && deps.upload) || createUploadClient();
  const threadIds = await resolveTargetThread(client, opts, 'voice');
  const { bytes, ext } = await loadSource(opts, deps && deps.httpGet);
  validateVoiceM4a(bytes, ext);
  const { mediaId, uploadId } = await ruploadVoice(client, bytes, upload);
  const token = generateMutationToken();
  const waveform = Array.from({ length: 70 }, () => Math.round((0.2 + Math.random() * 0.75) * 1000) / 1000);
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/broadcast/voice_attachment/',
    data: {
      action: 'send_item',
      thread_ids: compactJson(threadIds),
      send_attribution: 'inbox',
      client_context: token,
      attachment_fbid: String(mediaId),
      device_id: client.androidDeviceId,
      mutation_token: token,
      _uuid: client.uuid,
      waveform: compactJson(waveform),
      waveform_sampling_frequency_hz: '10',
      upload_id: uploadId,
      offline_threading_id: token,
    },
  });
  return normalizeMessage((res || {}).payload || {});
}

async function sendFile(client, options, deps) {
  const opts = options || {};
  const source = String(opts.path || opts.url || '');
  const ext = (source.split('?')[0].split('.').pop() || '').toLowerCase();
  if (ext === 'mp4') {
    return sendVideo(client, opts, deps);
  }
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png' || ext === 'webp') {
    return sendPhoto(client, opts, deps);
  }
  throw new Error('@alaminnna/ica-unofficial: sendFile content_type must be photo or video (got .' + ext + ')');
}

module.exports = {
  sendPhoto,
  sendVideo,
  sendVoice,
  sendFile,
  resolveTargetThread,
  loadSource,
  validateImage,
  validateVideoMp4,
  validateVoiceM4a,
  mp4Dimensions,
  ruploadPhoto,
  ruploadVideo,
  ruploadVoice,
  createUploadClient,
};