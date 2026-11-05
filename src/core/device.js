/**
 * @alaminnna/ica-unofficial — core/device
 * 
 * RESPONSIBILITY: device bundle: UUIDs, UA, jazoest, app version pins.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:crypto, ./utils
 * MUST NOT:       never regenerate per run when a saved bundle exists
 * 
 * DEBUG: when every run looks like a new device, start looking here — bundle persistence
 */

'use strict';

const crypto = require('node:crypto');
const { uuid4 } = require('./utils');

const DEVICE_SETTINGS = {
  android_version: 34,
  android_release: '14',
  dpi: '480dpi',
  resolution: '1344x2992',
  manufacturer: 'Google/google',
  device: 'husky',
  model: 'Pixel 8 Pro',
  cpu: 'husky',
};

const DEFAULT_APP_VERSION = '448.0.0.0.20';

const APP_SETTINGS = {
  '448.0.0.0.20': {
    app_version: '448.0.0.0.20',
    version_code: '1065560286',
    bloks_versioning_id: '0bc46a03e177bfc9bc8d611918815acf248fa9c77754d807d6a5951dc9ce9432',
  },
};

const USER_AGENT_BASE = 'Instagram {app_version} Android ({android_version}/{android_release}; {dpi}; {resolution}; {manufacturer}; {model}; {device}; {cpu}; {locale}; {version_code})';

function buildUserAgent(settings, locale) {
  const data = { ...settings, locale };
  return USER_AGENT_BASE.replace(/\{(\w+)\}/g, (match, key) => String(data[key]));
}

function generateAndroidDeviceId() {
  const digest = crypto.createHash('sha256').update(String(Date.now())).digest('hex');
  return 'android-' + digest.slice(0, 16);
}

function generateUuids() {
  return {
    phone_id: uuid4(),
    uuid: uuid4(),
    client_session_id: uuid4(),
    advertising_id: uuid4(),
    android_device_id: generateAndroidDeviceId(),
    request_id: uuid4(),
    tray_session_id: uuid4(),
  };
}

function generateJazoest(phoneId) {
  let sum = 0;
  for (const ch of String(phoneId)) {
    sum += ch.charCodeAt(0);
  }
  return '2' + String(sum);
}

const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function genToken(size) {
  const length = size || 64;
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += TOKEN_CHARS[bytes[i] % TOKEN_CHARS.length];
  }
  return out;
}

function generateMutationToken() {
  const bytes = crypto.randomBytes(14);
  let digits = '';
  for (let i = 0; i < 14; i += 1) {
    digits += String(bytes[i] % 10);
  }
  return '68000' + digits;
}
function createDeviceBundle(saved) {
  const prev = (saved && saved.uuids) || {};
  const uuids = {
    phone_id: prev.phone_id || uuid4(),
    uuid: prev.uuid || uuid4(),
    client_session_id: prev.client_session_id || uuid4(),
    advertising_id: prev.advertising_id || uuid4(),
    android_device_id: prev.android_device_id || generateAndroidDeviceId(),
    request_id: prev.request_id || uuid4(),
    tray_session_id: prev.tray_session_id || uuid4(),
  };
  const prevSettings = (saved && saved.deviceSettings) || {};
  const hardware = { ...DEVICE_SETTINGS, ...prevSettings };
  const appTriple = APP_SETTINGS[DEFAULT_APP_VERSION];
  const deviceSettings = { ...hardware, app_version: appTriple.app_version, version_code: appTriple.version_code, bloks_versioning_id: appTriple.bloks_versioning_id };
  const locale = (saved && saved.locale) || 'en_US';
  return {
    uuids,
    deviceSettings,
    userAgent: buildUserAgent({ ...deviceSettings, app_version: deviceSettings.app_version, version_code: deviceSettings.version_code }, locale),
    locale,
    country: (saved && saved.country) || 'US',
    countryCode: (saved && saved.countryCode) || 1,
    timezoneOffset: (saved && saved.timezoneOffset !== undefined) ? saved.timezoneOffset : -14400,
    timezoneName: (saved && saved.timezoneName) || 'GMT-04:00',
    csrftoken: (saved && saved.csrftoken) || genToken(64),
  };
}

const SUPPORTED_CAPABILITIES = [
  { value: '119.0,120.0,121.0,122.0,123.0,124.0,125.0,126.0,127.0,128.0,129.0,130.0,131.0,132.0,133.0,134.0,135.0,136.0,137.0,138.0,139.0,140.0,141.0,142.0', name: 'SUPPORTED_SDK_VERSIONS' },
  { value: '14', name: 'FACE_TRACKER_VERSION' },
  { value: 'ETC2_COMPRESSION', name: 'COMPRESSION' },
  { value: 'gyroscope_enabled', name: 'gyroscope' },
];

module.exports = {
  DEVICE_SETTINGS,
  DEFAULT_APP_VERSION,
  APP_SETTINGS,
  USER_AGENT_BASE,
  buildUserAgent,
  generateAndroidDeviceId,
  generateUuids,
  generateJazoest,
  genToken,
  generateMutationToken,
  createDeviceBundle,
  SUPPORTED_CAPABILITIES,
};