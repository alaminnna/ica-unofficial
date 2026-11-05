/**
 * @alaminnna/ica-unofficial — core/headers
 * 
 * RESPONSIBILITY: per-request base headers (X-IG-*, UA, auth).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./utils
 * MUST NOT:       never hardcode per-user values
 * 
 * DEBUG: when requests 400 with missing headers, start looking here — header construction
 */

'use strict';

const { uuid4 } = require('./utils');
const APP_ID = '567067343352427';

function buildBaseHeaders(client) {
  const bundle = client.bundle;
  const uuids = bundle.uuids;
  const locale = bundle.locale.replace('-', '_');
  const acceptLanguage = ['en-US'];
  const lang = locale.replace('_', '-');
  if (acceptLanguage.indexOf(lang) === -1) {
    acceptLanguage.unshift(lang);
  }
  const headers = {
    'X-IG-App-Locale': locale,
    'X-IG-Device-Locale': locale,
    'X-IG-Mapped-Locale': locale,
    'X-Pigeon-Session-Id': 'UFS-' + uuid4() + '-1',
    'X-Pigeon-Rawclienttime': String(Math.round(Date.now() / 1000 * 1000) / 1000),
    'X-IG-Bandwidth-Speed-KBPS': String((2500000 + Math.floor(Math.random() * 500000)) / 1000),
    'X-IG-Bandwidth-TotalBytes-B': String(5000000 + Math.floor(Math.random() * 85000000)),
    'X-IG-Bandwidth-TotalTime-MS': String(2000 + Math.floor(Math.random() * 7000)),
    'X-IG-App-Startup-Country': String(bundle.country).toUpperCase(),
    'X-Bloks-Version-Id': client.bloksVersioningId,
    'X-IG-WWW-Claim': '0',
    'X-Bloks-Is-Layout-RTL': 'false',
    'X-Bloks-Is-Panorama-Enabled': 'true',
    'X-IG-Device-ID': uuids.uuid,
    'X-IG-Family-Device-ID': uuids.phone_id,
    'X-IG-Android-ID': uuids.android_device_id,
    'X-IG-Timezone-Offset': String(bundle.timezoneOffset),
    'X-IG-Connection-Type': 'WIFI',
    'X-IG-Capabilities': '3brTv10=',
    'X-IG-App-ID': APP_ID,
    Priority: 'u=3',
    'User-Agent': bundle.userAgent,
    'Accept-Language': acceptLanguage.join(', '),
    'Accept-Encoding': 'gzip, deflate',
    Host: 'i.instagram.com',
    'X-FB-HTTP-Engine': 'Tigon/MNS/TCP',
    'X-Tigon-Is-Retry': 'False',
    'X-Zero-Balance': 'INIT',
    'X-Zero-Eh': '',
    'X-Zero-State': 'unknown',
    'Zero-HTTP-Network-Interface': 'wifi',
    Connection: 'keep-alive',
    'X-FB-Client-IP': 'True',
    'X-FB-Server-Cluster': 'True',
    'IG-INTENDED-USER-ID': String(client.userId || 0),
    'X-IG-Nav-Chain': '9MV:self_profile:2,ProfileMediaTabFragment:self_profile:3,9Xf:self_following:4',
    'X-IG-SALT-IDS': String(1061162222 + Math.floor(Math.random() * 100000)),
  };
  if (client.mid) {
    headers['X-MID'] = client.mid;
  }
  if (client.userId) {
    const nextYear = Date.now() / 1000 + 31536000;
    headers['IG-U-DS-USER-ID'] = String(client.userId);
    headers['IG-U-IG-DIRECT-REGION-HINT'] = 'LLA,' + client.userId + ',' + nextYear + ':01f7bae7d8b131877d8e0ae1493252280d72f6d0d554447cb1dc9049b6b2c507c08605b7';
    headers['IG-U-SHBID'] = '12695,' + client.userId + ',' + nextYear + ':01f778d9c9f7546cf3722578fbf9b85143cd6e5132723e5c93f40f55ca0459c8ef8a0d9f';
    headers['IG-U-SHBTS'] = Math.floor(Date.now() / 1000) + ',' + client.userId + ',' + nextYear + ':01f7ace11925d0388080078d0282b75b8059844855da27e23c90a362270fddfb3fae7e28';
    headers['IG-U-RUR'] = 'RVA,' + client.userId + ',' + nextYear + ':01f7f627f9ae4ce2874b2e04463efdb184340968b1b006fa88cb4cc69a942a04201e544c';
  }
  if (client.igURur) {
    headers['IG-U-RUR'] = client.igURur;
  }
  if (client.igWwwClaim) {
    headers['X-IG-WWW-Claim'] = client.igWwwClaim;
  }
  return headers;
}

module.exports = { buildBaseHeaders, APP_ID };