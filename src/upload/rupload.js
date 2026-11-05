/**
 * @alaminnna/ica-unofficial — upload/rupload
 *
 * RESPONSIBILITY: shared upload wire core only — upload ids/names, default
 *   configure data, compact JSON, rupload params/PUT/init calls, clip
 *   upload_settings, GraphQL www POST, media-id extraction.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../core/headers, ../core/delays, ../../exceptions
 * MUST NOT:       never implement per-type configure payloads here (photo/video/album/igtv/reel own those)
 *
 * DEBUG: when rupload returns non-200 or configure gets no media, start
 *   looking here — params shape, headers, upload_settings (clips)
 */

'use strict';

const { buildBaseHeaders } = require('../core/headers');
const { sleep } = require('../core/delays');

const API_DOMAIN = 'i.instagram.com';
const GRAPHQL_WWW_URL = 'https://b.i.instagram.com/graphql_www';
const GRAPHQL_QUERY_URL = 'https://i.instagram.com/graphql/query';
const RETRY_CONTEXT = '{"num_step_auto_retry":0,"num_reupload":0,"num_step_manual_retry":0}';

function msUploadId() {
  return String(Date.now());
}

function rand9() {
  return String(Math.floor(1000000000 + Math.random() * 9000000000));
}

function photoUploadName(uploadId) {
  return uploadId + '_0_' + rand9();
}

function dumps(obj) {
  return JSON.stringify(obj);
}

// Port of with_default_data: {_uuid, device_id, ...data}
function withDefaultData(client, data) {
  return { _uuid: client.uuid, device_id: client.androidDeviceId, ...(data || {}) };
}

// Port of date_time_original: local YYYYMMDDTHHMMSS.000Z
function dateTimeOriginal(date) {
  const d = date || new Date();
  const pad = (n, len) => String(n).padStart(len || 2, '0');
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.000Z';
}

// Port of config.SOFTWARE using this client's device pins
function softwareString(client) {
  const settings = (client.bundle && client.bundle.deviceSettings) || {};
  return (settings.model || '') + '-user+' + (settings.android_release || '') +
    '+OPR1.170623.032+V10.2.3.0.OAGMIXM+release-keys';
}

function uploadHeaders(client, extra) {
  const headers = { ...buildBaseHeaders(client), ...(extra || {}) };
  const auth = typeof client.getAuthHeader === 'function' ? client.getAuthHeader() : '';
  if (auth && !headers.Authorization && !headers.authorization) {
    headers.Authorization = auth;
  }
  return headers;
}

function failSnippet(res) {
  try {
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return String(text).slice(0, 300);
  } catch (ignored) {
    return '';
  }
}

// Photo rupload: single POST with bytes. Returns { uploadId }.
async function photoRupload(client, options) {
  const opts = options || {};
  const uploadId = opts.uploadId || msUploadId();
  const uploadName = photoUploadName(uploadId);
  const params = {
    retry_context: RETRY_CONTEXT,
    media_type: '1',
    xsharing_user_ids: '[]',
    upload_id: uploadId,
    image_compression: dumps({ lib_name: 'moz', lib_version: '3.1.m', quality: '80' }),
  };
  if (opts.toAlbum) {
    params.is_sidecar = '1';
  }
  const headers = uploadHeaders(client, {
    'Accept-Encoding': 'gzip',
    'X-Instagram-Rupload-Params': dumps(params),
    'X_FB_PHOTO_WATERFALL_ID': require('../core/utils').uuid4(),
    'X-Entity-Type': opts.imageType || 'image/jpeg',
    Offset: '0',
    'X-Entity-Name': uploadName,
    'X-Entity-Length': String(opts.buffer.length),
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(opts.buffer.length),
  });
  let res;
  try {
    res = await client.http.axios.post('https://' + API_DOMAIN + '/rupload_igphoto/' + uploadName, opts.buffer, { headers, timeout: 120000, maxBodyLength: Infinity });
  } catch (err) {
    const status = err && err.response && err.response.status;
    throw new Error('@alaminnna/ica-unofficial: photo rupload failed: HTTP ' + status + ': ' + failSnippet(err.response || {}));
  }
  if (!res || res.status !== 200) {
    throw new Error('@alaminnna/ica-unofficial: photo rupload failed: HTTP ' + (res && res.status) + ': ' + failSnippet(res || {}));
  }
  return { uploadId };
}

// Shared video rupload params (sent on init GET and re-sent on PUT bytes).
function videoRuploadParams(client, opts) {
  const params = {
    retry_context: RETRY_CONTEXT,
    media_type: '2',
    xsharing_user_ids: dumps([client.userId]),
    upload_id: opts.uploadId,
    upload_media_duration_ms: String(opts.durationMs),
    upload_media_width: String(opts.width),
    upload_media_height: String(opts.height),
  };
  if (opts.isIgtv) {
    params.is_igtv_video = '1';
  }
  if (opts.toDirect) {
    params.direct_v2 = '1';
  }
  if (opts.toAlbum) {
    params.is_sidecar = '1';
  }
  if (opts.toStory) {
    params.extract_cover_frame = '1';
    params.content_tags = 'has-overlay';
    params.for_album = '1';
  }
  return params;
}

// Video rupload step 1: GET init with params. Throws unless HTTP 200.
async function videoRuploadInit(client, options) {
  const opts = options || {};
  const params = videoRuploadParams(client, opts);
  const headers = uploadHeaders(client, {
    'Accept-Encoding': 'gzip, deflate',
    'X-Instagram-Rupload-Params': dumps(params),
    'X_FB_VIDEO_WATERFALL_ID': opts.waterfallId,
  });
  if (opts.toAlbum) {
    headers['Segment-Start-Offset'] = '0';
    headers['Segment-Type'] = '3';
  }
  let res;
  try {
    res = await client.http.axios.get('https://' + API_DOMAIN + '/rupload_igvideo/' + opts.uploadName, { headers, timeout: 60000 });
  } catch (err) {
    const status = err && err.response && err.response.status;
    throw new Error('@alaminnna/ica-unofficial: video rupload init failed: HTTP ' + status + ': ' + failSnippet(err.response || {}));
  }
  if (!res || res.status !== 200) {
    throw new Error('@alaminnna/ica-unofficial: video rupload init failed: HTTP ' + (res && res.status));
  }
  return { uploadId: opts.uploadId };
}

// Video rupload step 2: POST bytes. Throws unless HTTP 200.
async function videoRuploadPut(client, options) {
  const opts = options || {};
  const params = videoRuploadParams(client, opts);
  const headers = uploadHeaders(client, {
    Offset: '0',
    'X-Entity-Name': opts.uploadName,
    'X-Entity-Length': String(opts.buffer.length),
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(opts.buffer.length),
    'X-Entity-Type': 'video/mp4',
    'Accept-Encoding': 'gzip, deflate',
    'X-Instagram-Rupload-Params': dumps(params),
    'X_FB_VIDEO_WATERFALL_ID': opts.waterfallId,
  });
  if (opts.toAlbum) {
    headers['Segment-Start-Offset'] = '0';
    headers['Segment-Type'] = '3';
  }
  let res;
  try {
    res = await client.http.axios.post('https://' + API_DOMAIN + '/rupload_igvideo/' + opts.uploadName, opts.buffer, { headers, timeout: 300000, maxBodyLength: Infinity });
  } catch (err) {
    const status = err && err.response && err.response.status;
    throw new Error('@alaminnna/ica-unofficial: video rupload put failed: HTTP ' + status + ': ' + failSnippet(err.response || {}));
  }
  if (!res || res.status !== 200) {
    throw new Error('@alaminnna/ica-unofficial: video rupload put failed: HTTP ' + (res && res.status) + ': ' + failSnippet(res || {}));
  }
  return { uploadId: opts.uploadId };
}

// Clip step 0: POST upload_settings JSON to /upload_settings/{composerSessionId}.
async function clipUploadSettings(client, options) {
  const opts = options || {};
  const body = {
    composer_session_id: opts.composerSessionId,
    upload_setting_properties: {
      upload_settings_version: 'v0.1',
      codec: {},
      context: {
        source_attribution: null,
        enable_video_dimension_upscale: false,
        source_type: 'clips',
        quality: '',
        ...(opts.userId ? { target_id: Number(opts.userId) } : {}),
      },
      video: {
        video_height: opts.height,
        video_gop_size_sec: 0,
        video_rotation_angle: 0,
        video_width: opts.width,
        source_video_codec: null,
        video_partial_frame_size_bytes: 0,
        asset_id: opts.assetId,
        video_key_frame_size_bytes: 0,
        target_duration: Math.floor(opts.duration),
        video_original_file_size: opts.clipLen,
        video_duration_milliseconds: opts.durationMs,
        audio_bit_rate_bps: -1,
        video_bit_rate_bps: 0,
        audio_codec_type: null,
        video_fps: 30,
      },
      creative_tools: { transmuxing_eligible: false, transcoding_required: true },
      network: {
        download_latency_connection_quality: 'ig_dummy',
        network_connection_name: 'ig_dummy',
        download_bandwidth_connection_quality: 'ig_dummy',
      },
    },
    preview_spec: { spec_version: 1, video_dur_ms: opts.durationMs, audio_dur_ms: opts.durationMs },
  };
  const payload = dumps(body);
  const headers = uploadHeaders(client, {
    'Accept-Encoding': 'gzip',
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(payload)),
    Offset: '0',
    'X-Entity-Length': String(Buffer.byteLength(payload)),
    'X-Entity-Name': 'upload_settings',
    'X-Entity-Type': 'application/json',
    'X_FB_VIDEO_WATERFALL_ID': opts.composerSessionId + '_settings',
  });
  let res;
  try {
    res = await client.http.axios.post('https://' + API_DOMAIN + '/upload_settings/' + opts.composerSessionId, payload, { headers, timeout: 60000 });
  } catch (err) {
    const status = err && err.response && err.response.status;
    throw new Error('@alaminnna/ica-unofficial: clip upload_settings failed: HTTP ' + status + ': ' + failSnippet(err.response || {}));
  }
  if (!res || res.status !== 200) {
    throw new Error('@alaminnna/ica-unofficial: clip upload_settings failed: HTTP ' + (res && res.status));
  }
  return { composerSessionId: opts.composerSessionId };
}

// Private GraphQL www POST (port of private_graphql_www_request). Returns parsed JSON.
async function graphqlWww(client, options) {
  const opts = options || {};
  const body = {
    method: 'post',
    pretty: 'false',
    format: 'json',
    server_timestamps: 'true',
    locale: 'user',
    fb_api_req_friendly_name: opts.friendlyName,
    enable_canonical_naming: 'true',
    enable_canonical_variable_overrides: 'true',
    enable_canonical_naming_ambiguous_type_prefixing: 'true',
    variables: dumps(opts.variables || {}),
  };
  if (opts.purpose !== undefined && opts.purpose !== null) {
    body.purpose = opts.purpose;
  }
  if (opts.clientDocId) {
    body.client_doc_id = String(opts.clientDocId);
  }
  const form = Object.keys(body)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(body[k]))
    .join('&');
  const headers = uploadHeaders(client, {
    'X-FB-Friendly-Name': opts.friendlyName,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Host: 'b.i.instagram.com',
  });
  if (opts.clientDocId) {
    headers['X-Client-Doc-Id'] = String(opts.clientDocId);
  }
  Object.assign(headers, opts.extraHeaders || {});
  let res;
  try {
    res = await client.http.axios.post(opts.url || GRAPHQL_WWW_URL, form, { headers, timeout: 30000 });
  } catch (err) {
    const status = err && err.response && err.response.status;
    throw new Error('@alaminnna/ica-unofficial: graphql www request failed: HTTP ' + status + ': ' + failSnippet(err.response || {}));
  }
  const json = res.data;
  if (json && json.errors) {
    throw new Error('@alaminnna/ica-unofficial: graphql www errors: ' + dumps(json.errors).slice(0, 300));
  }
  if (json && json.status === 'fail') {
    throw new Error('@alaminnna/ica-unofficial: graphql www failed: ' + (json.message || ''));
  }
  return json;
}

// Extract media id from a configure response (port of _extract_configured_media).
function extractMediaId(configured, lastJson) {
  if (configured && configured.media && (configured.media.id || configured.media.pk)) {
    return String(configured.media.id || configured.media.pk);
  }
  const last = lastJson || {};
  if (last.media && (last.media.id || last.media.pk)) {
    return String(last.media.id || last.media.pk);
  }
  return null;
}

module.exports = {
  API_DOMAIN,
  GRAPHQL_WWW_URL,
  GRAPHQL_QUERY_URL,
  RETRY_CONTEXT,
  msUploadId,
  rand9,
  photoUploadName,
  dumps,
  withDefaultData,
  dateTimeOriginal,
  softwareString,
  uploadHeaders,
  photoRupload,
  videoRuploadParams,
  videoRuploadInit,
  videoRuploadPut,
  clipUploadSettings,
  graphqlWww,
  extractMediaId,
  sleep,
};