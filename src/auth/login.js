/**
 * @alaminnna/ica-unofficial — auth/login
 * 
 * RESPONSIBILITY: credentials login: Bloks CAA first, legacy fallback, post-login sync.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./caa, ./bloks, ../core/crypto, ../core/device, ../exceptions
 * MUST NOT:       never store passwords beyond the call
 * 
 * DEBUG: when login 400s or bad_password with correct creds, start looking here — password encryption and CAA routing
 */

'use strict';

const { caaLogin, collectCaaMarkers } = require('./caa');
const { extract2svContext } = require('./bloks');
const { passwordEncrypt, fetchPasswordKey } = require('../core/crypto');
const { generateJazoest } = require('../core/device');
const ex = require('../exceptions');

const PREFLIGHT_FAIL_REASON = 'CAA preflight did not return account access data';

function isCaaUnavailable(err) {
  if (!err || err.name !== 'ClientError') {
    return false;
  }
  const extra = err.extra || {};
  if (extra.statusCode === 404) {
    return true;
  }
  return extra.error_type === 'field_exception' && /payload returned is null/i.test(String(err.message));
}

function hasFallbackMarker(result) {
  return collectCaaMarkers(result || {}).some((marker) => marker.indexOf('CAA_LOGIN_FALLBACK:') === 0);
}

function normalizeBackupCode(code) {
  return String(code).replace(/[\s-]+/g, '');
}

function looksLikeBackupCode(code) {
  return /^[0-9]{8}$/.test(normalizeBackupCode(code));
}

function captureAuthFromLastResponse(client) {
  const res = client.api.lastResponse;
  const headers = (res && res.headers) || {};
  const lowered = {};
  Object.keys(headers).forEach((key) => {
    lowered[key.toLowerCase()] = headers[key];
  });
  const value = lowered['ig-set-authorization'];
  if (value) {
    const { parseAuthorization } = require('./bloks');
    client.authorizationData = parseAuthorization(value);
  }
}

async function finishLogin(client) {
  client.lastLogin = Date.now();
  client.reloginAttempt = 0;
  await client.getCurrentUser();
  return true;
}

async function preLogin(client) {
  try {
    await client.api.request({
      endpoint: 'launcher/sync/',
      data: { id: client.bundle.uuids.uuid, server_config_retrieval: '1' },
      login: true,
    });
  } catch (err) {
    if (err && (err.name === 'ClientThrottledError' || err.name === 'PleaseWaitFewMinutes')) {
      return;
    }
    throw err;
  }
}

function keyFromHeaders(headers) {
  const lowered = {};
  Object.keys(headers || {}).forEach((k) => {
    lowered[k.toLowerCase()] = headers[k];
  });
  return { keyId: Number(lowered['ig-set-password-encryption-key-id']), pubKey: lowered['ig-set-password-encryption-pub-key'] };
}

async function fetchKey(client) {
  if (client.publicGet) {
    return fetchPasswordKey(client.publicGet);
  }
  await client.api.request({ endpoint: 'qe/sync/', data: { id: client.bundle.uuids.uuid, server_config_retrieval: '1' }, login: true });
  const res = client.api.lastResponse || {};
  return keyFromHeaders(res.headers);
}

async function legacyTwoFactorLogin(client, username, code, identifier) {
  const data = {
    verification_code: String(code),
    phone_id: client.bundle.uuids.phone_id,
    _csrftoken: client.csrftoken,
    two_factor_identifier: identifier,
    username,
    trust_this_device: '0',
    guid: client.bundle.uuids.uuid,
    device_id: client.bundle.uuids.android_device_id,
    _uuid: client.bundle.uuids.uuid,
    waterfall_id: require('../core/utils').uuid4(),
    verification_method: '3',
  };
  const logged = await client.api.request({ endpoint: 'accounts/two_factor_login/', data, login: true });
  captureAuthFromLastResponse(client);
  return logged;
}

async function attemptCaaFallback(client, username, password, code, originalError) {
  let outcome = null;
  try {
    outcome = await caaLogin(client, { username, password, verificationCode: code, key: await fetchKey(client) });
  } catch (err) {
    if (!isCaaUnavailable(err)) {
      throw err;
    }
    throw originalError;
  }
  if (outcome.loggedIn) {
    return true;
  }
  if (outcome.context && String(code || '').trim()) {
    const { bloksTwoFactor } = require('./twofactor');
    const lastJson = client.api.lastJson || {};
    if (await bloksTwoFactor(client, lastJson, code)) {
      return true;
    }
  }
  throw originalError;
}

async function loginLegacy(client, username, password, code) {
  await preLogin(client);
  const key = await fetchKey(client);
  const encPassword = await passwordEncrypt(password, key);
  const data = {
    jazoest: generateJazoest(client.bundle.uuids.phone_id),
    country_codes: '[{"country_code":"' + client.bundle.countryCode + '","source":["default"]}]',
    phone_id: client.bundle.uuids.phone_id,
    enc_password: encPassword,
    username,
    adid: client.bundle.uuids.advertising_id,
    guid: client.bundle.uuids.uuid,
    device_id: client.bundle.uuids.android_device_id,
    _uuid: client.bundle.uuids.uuid,
    google_tokens: '[]',
    login_attempt_count: '0',
  };
  try {
    await client.api.request({ endpoint: 'accounts/login/', data, login: true });
    captureAuthFromLastResponse(client);
  } catch (err) {
    if (err && err.name === 'BadPassword') {
      const context = extract2svContext(client.api.lastJson || {});
      if (context) {
        if (!String(code || '').trim()) {
          throw new ex.TwoFactorRequired(String(err.message) + ' (Instagram returned a Bloks two-factor context; provide verificationCode for login)', {});
        }
        const { bloksTwoFactor } = require('./twofactor');
        if (await bloksTwoFactor(client, client.api.lastJson || {}, code)) {
          return finishLogin(client);
        }
        throw err;
      }
      if (await attemptCaaFallback(client, username, password, code, err)) {
        return finishLogin(client);
      }
    }
    if (err && err.name === 'UnknownError' && err.extra && String(err.extra.error_type || '').toLowerCase() === 'needs_upgrade') {
      if (await attemptCaaFallback(client, username, password, code, err)) {
        return finishLogin(client);
      }
    }
    if (err && err.name === 'TwoFactorRequired') {
      const lastJson = client.api.lastJson || {};
      const context = extract2svContext(lastJson);
      if (looksLikeBackupCode(code) && context) {
        const { bloksTwoFactor } = require('./twofactor');
        if (await bloksTwoFactor(client, lastJson, code)) {
          return finishLogin(client);
        }
        throw err;
      }
      if (!String(code || '').trim()) {
        throw err;
      }
      const identifier = ((lastJson.two_factor_info || {}).two_factor_identifier) || '';
      try {
        await legacyTwoFactorLogin(client, username, code, identifier);
      } catch (inner) {
        if (inner && inner.name === 'UnknownError' && String(inner.message || '').toLowerCase() === 'invalid parameters' && extract2svContext(client.api.lastJson || {})) {
          const { bloksTwoFactor } = require('./twofactor');
          if (await bloksTwoFactor(client, client.api.lastJson || {}, code)) {
            return finishLogin(client);
          }
        }
        throw inner;
      }
      captureAuthFromLastResponse(client);
      return finishLogin(client);
    }
    if (err && (err.name === 'ChallengeRequired' || err.name === 'ChallengeRedirection')) {
      const { resolveChallenge } = require('./challenge');
      await resolveChallenge(client, client.api.lastJson || {}, {
        code: optionsCodeHandler(client),
        password: optionsPasswordHandler(client),
      });
      return finishLogin(client);
    }
    throw err;
  }
  return finishLogin(client);
}

function optionsCodeHandler(client) {
  return (username, choice) => {
    if (typeof client.challengeCodeHandler === 'function') {
      return client.challengeCodeHandler(username, choice);
    }
    return '';
  };
}

function optionsPasswordHandler(client) {
  return (username) => {
    if (typeof client.changePasswordHandler === 'function') {
      return client.changePasswordHandler(username);
    }
    return '';
  };
}

async function loginWithCredentials(client, options) {
  const opts = options || {};
  if (opts.username && opts.password !== undefined) {
    client.username = opts.username;
    client.password = opts.password;
  }
  if (client.username === null || client.username === undefined || client.password === null || client.password === undefined) {
    throw new ex.BadCredentials('Both username and password must be provided.', {});
  }
  if (typeof client.username === 'string') {
    client.username = client.username.trim();
  }
  const code = opts.verificationCode || opts.twoFactorCode || '';
  if (typeof opts.challengeCodeHandler === 'function') {
    client.challengeCodeHandler = opts.challengeCodeHandler;
  }
  if (typeof opts.changePasswordHandler === 'function') {
    client.changePasswordHandler = opts.changePasswordHandler;
  }
  if (opts.relogin) {
    client.authorizationData = {};
    client.userId = null;
    if (client.reloginAttempt > 1) {
      throw new ex.ReloginAttemptExceeded('Relogin attempt exceeded.', {});
    }
    client.reloginAttempt += 1;
  }
  if (client.userId && !opts.relogin) {
    try {
      await client.getCurrentUser();
      return true;
    } catch (err) {
      if (err && err.name === 'SessionExpired') {
        return loginWithCredentials(client, { ...opts, relogin: true });
      }
      throw err;
    }
  }
  const key = await fetchKey(client);
  let outcome = null;
  try {
    outcome = await caaLogin(client, { username: client.username, password: client.password, verificationCode: code, key });
  } catch (err) {
    if (!isCaaUnavailable(err)) {
      throw err;
    }
  }
  if (outcome && outcome.loggedIn) {
    return finishLogin(client);
  }
  if (outcome && outcome.context) {
    if (!String(code).trim()) {
      throw new ex.TwoFactorRequired('Instagram returned a Bloks two-factor context from the CAA login flow; provide verificationCode for login', {});
    }
    const { bloksTwoFactor } = require('./twofactor');
    if (await bloksTwoFactor(client, outcome.result, code)) {
      return finishLogin(client);
    }
    throw new ex.TwoFactorRequired('Bloks two-factor verification did not return a session', {});
  }
  if (!outcome || outcome.reason === PREFLIGHT_FAIL_REASON || hasFallbackMarker(outcome.result)) {
    return loginLegacy(client, client.username, client.password, code);
  }
  throw new ex.ClientError(outcome.reason || 'CAA login did not return a session', {});
}

module.exports = { loginWithCredentials, loginLegacy, preLogin, isCaaUnavailable };