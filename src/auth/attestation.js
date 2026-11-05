/**
 * @alaminnna/ica-unofficial — auth/attestation
 *
 * RESPONSIBILITY: USDID P-256 device identity (X-Meta-Usdid header,
 * registration token + mutation, keystore nonce params).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:crypto, ../core/utils (uuid4), ../upload/rupload (graphqlWww), client.api
 * MUST NOT:       never persist private keys outside the client/session object
 *
 * DEBUG: when X-Meta-Usdid goes stale, start looking here — header TTL cache
 */

'use strict';

const crypto = require('node:crypto');
const { uuid4 } = require('../core/utils');

const USDID_REGISTRATION_CLIENT_DOC_ID = '124930351917786857261002920888';
const USDID_TOKEN_TTL = 3600;
const USDID_REFRESH_MARGIN = 300;
const ATTESTATION_KEYSTORE_ERROR = -1013;
const IG_APP_ID = '567067343352427';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stateOf(client) {
  if (!client.usdid || typeof client.usdid !== 'object') {
    client.usdid = { usdid: '', kid: '', privateKey: '', registered: false, headerCache: '', headerExpiresAt: 0, challengeNonce: '', keyNonce: '' };
  }
  return client.usdid;
}

function getUsdidSettings(client) {
  const st = stateOf(client);
  if (!st.privateKey) {
    return {};
  }
  return { usdid: st.usdid, kid: st.kid, private_key: st.privateKey, registered: st.registered };
}

function setUsdidSettings(client, settings) {
  const st = stateOf(client);
  const data = settings || {};
  st.usdid = String(data.usdid || '');
  st.kid = String(data.kid || '');
  st.privateKey = String(data.private_key || '');
  st.registered = Boolean(data.registered);
  st.headerCache = '';
  st.headerExpiresAt = 0;
  st.challengeNonce = '';
  st.keyNonce = '';
  return Boolean(st.privateKey);
}

function usdidGenerate(client, force) {
  const st = stateOf(client);
  if (st.privateKey && !force) {
    return st.usdid;
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  st.privateKey = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  st.publicDer = publicKey.export({ type: 'spki', format: 'der' });
  st.usdid = uuid4();
  st.kid = b64url(crypto.randomBytes(32));
  st.registered = false;
  st.headerCache = '';
  st.headerExpiresAt = 0;
  return st.usdid;
}

function usdidKey(client) {
  const st = stateOf(client);
  if (!st.privateKey) {
    usdidGenerate(client);
  }
  return crypto.createPrivateKey(stateOf(client).privateKey);
}

function usdidSign(client, message) {
  return crypto.sign('sha256', Buffer.from(String(message), 'utf8'), { key: usdidKey(client), dsaEncoding: 'der' });
}

function usdidPublicKeyDer(client) {
  const st = stateOf(client);
  if (!st.privateKey) {
    usdidGenerate(client);
  }
  if (!st.publicDer) {
    st.publicDer = crypto.createPublicKey(usdidKey(client)).export({ type: 'spki', format: 'der' });
  }
  return st.publicDer;
}

function usdidHeader(client, ttl) {
  const st = stateOf(client);
  const now = Math.floor(Date.now() / 1000);
  if (st.headerCache && st.headerExpiresAt - now > USDID_REFRESH_MARGIN) {
    return st.headerCache;
  }
  const expiresAt = now + (ttl || USDID_TOKEN_TTL);
  const signedPart = st.usdid + '.' + expiresAt;
  const value = signedPart + '.' + b64url(usdidSign(client, signedPart));
  st.headerCache = value;
  st.headerExpiresAt = expiresAt;
  return value;
}

function usdidRegistrationToken(client, ttl) {
  const st = stateOf(client);
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(Buffer.from(JSON.stringify({
    sub: st.usdid,
    iat: now,
    aud: IG_APP_ID,
    exp: now + (ttl || USDID_TOKEN_TTL),
    pub: Buffer.from(usdidPublicKeyDer(client)).toString('base64'),
    alg: 'ES256',
  }), 'utf8'));
  const protectedHeader = b64url(Buffer.from(JSON.stringify({
    typ: 'JWT',
    alg: 'ES256',
    kid: st.kid,
    aid: IG_APP_ID,
    ver: '1',
  }), 'utf8'));
  const token = {
    payload,
    signatures: [{ protected: protectedHeader, signature: b64url(usdidSign(client, protectedHeader + '.' + payload)) }],
  };
  return b64url(Buffer.from(JSON.stringify(token), 'utf8'));
}

async function usdidRegister(client, clientDocId) {
  const st = stateOf(client);
  if (!st.privateKey) {
    usdidGenerate(client);
  }
  const { graphqlWww } = require('../upload/rupload');
  const result = await graphqlWww(client, {
    friendlyName: 'IGUSDIDRegistrationMutation',
    variables: {
      input: {
        usdid_token: { sensitive_string_value: usdidRegistrationToken(client) },
        fdid: { sensitive_string_value: client.phoneId },
      },
    },
    clientDocId: clientDocId || USDID_REGISTRATION_CLIENT_DOC_ID,
    extraHeaders: {
      'X-Root-Field-Name': 'usdid_registration',
      'X-Graphql-Client-Library': 'pando',
    },
  });
  const data = (result && result.data) || {};
  const registration = Object.keys(data)
    .map((k) => ({ key: k, value: data[k] }))
    .find((entry) => entry.key.indexOf('usdid_registration') !== -1 && entry.value && typeof entry.value === 'object');
  stateOf(client).registered = Boolean(registration && registration.value.success);
  return stateOf(client).registered;
}

async function attestationCreateAndroidKeystore(client, keyHash, domain) {
  const res = await client.api.request({
    endpoint: 'attestation/create_android_keystore/',
    method: 'POST',
    domain: domain || null,
    data: { app_scoped_device_id: client.uuid, key_hash: keyHash || '' },
  });
  const st = stateOf(client);
  st.challengeNonce = String((res || {}).challenge_nonce || '');
  st.keyNonce = String((res || {}).key_nonce || '');
  return res;
}

function attestationParams(client, challengeNonce) {
  const st = stateOf(client);
  const nonce = challengeNonce || st.challengeNonce;
  if (!nonce) {
    return '';
  }
  return JSON.stringify({
    attestation: [{
      version: 2,
      type: 'keystore',
      errors: [ATTESTATION_KEYSTORE_ERROR],
      challenge_nonce: nonce,
      signed_nonce: '',
      key_hash: '',
    }],
  });
}

module.exports = {
  USDID_REGISTRATION_CLIENT_DOC_ID,
  USDID_TOKEN_TTL,
  USDID_REFRESH_MARGIN,
  ATTESTATION_KEYSTORE_ERROR,
  getUsdidSettings,
  setUsdidSettings,
  usdidGenerate,
  usdidPublicKeyDer,
  usdidHeader,
  usdidRegistrationToken,
  usdidRegister,
  attestationCreateAndroidKeystore,
  attestationParams,
};