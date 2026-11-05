/**
 * @alaminnna/ica-unofficial — auth/twofactor
 * 
 * RESPONSIBILITY: 2FA: legacy two_factor_login plus Bloks 2SV flows.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./bloks, ../exceptions
 * MUST NOT:       never log codes
 * 
 * DEBUG: when a correct 2FA code is rejected, start looking here — identifier and method routing
 */

'use strict';

const bloks = require('./bloks');
const ex = require('../exceptions');

function normalizeBackupCode(code) {
  return String(code).replace(/[\s-]+/g, '');
}

function looksLikeBackupCode(code) {
  return /^[0-9]{8}$/.test(normalizeBackupCode(code));
}

function inferBloksChallenge(loginJson, code) {
  if (looksLikeBackupCode(code)) {
    return 'backup_codes';
  }
  const flat = [];
  bloks.collectStrings(loginJson, flat);
  const text = flat.join(' ').toLowerCase();
  const smsOn = text.indexOf('sms_two_factor_on') !== -1;
  return smsOn ? 'sms' : 'totp';
}

function findKey(node, key) {
  if (Array.isArray(node)) {
    return node.some((child) => findKey(child, key));
  }
  if (node && typeof node === 'object') {
    if (node[key] === true || node[key] === 1 || node[key] === '1') {
      return true;
    }
    return Object.keys(node).some((k) => findKey(node[k], key));
  }
  return false;
}

function findBool(loginJson, key) {
  if (findKey(loginJson, key)) {
    return true;
  }
  const flat = [];
  bloks.collectStrings(loginJson, flat);
  return flat.some((text) => text.indexOf(key) !== -1);
}

async function legacyTwoFactor(client, username, code, identifier) {
  const data = {
    verification_code: String(code),
    phone_id: client.bundle.uuids.phone_id,
    _csrftoken: client.csrftoken,
    two_factor_identifier: identifier,
    username,
    trust_this_device: '0',
    guid: client.bundle.uuids.uuid,
    device_id: client.bundle.uuids.android_device_id,
    waterfall_id: require('../core/utils').uuid4(),
    verification_method: '3',
  };
  const logged = await client.api.request({ endpoint: 'accounts/two_factor_login/', data, login: true });
  const res = client.api.lastResponse;
  const headers = (res && res.headers) || {};
  const lowered = {};
  Object.keys(headers).forEach((key) => {
    lowered[key.toLowerCase()] = headers[key];
  });
  if (lowered['ig-set-authorization']) {
    client.authorizationData = bloks.parseAuthorization(lowered['ig-set-authorization']);
  }
  return logged;
}

async function bloksTwoFactor(client, loginJson, code) {
  const context = bloks.extract2svContext(loginJson);
  if (!context) {
    throw new ex.TwoFactorRequired('@alaminnna/ica-unofficial: Bloks two-factor context missing; complete verification in the Instagram app', {});
  }
  const challenge = looksLikeBackupCode(code)
    ? 'backup_codes'
    : (findBool(loginJson, 'sms_two_factor_on') && !findBool(loginJson, 'totp_two_factor_on') ? 'sms' : 'totp');
  await bloks.entrypoint2sv(client, context);
  await bloks.methodPicker2sv(client, context);
  await bloks.selectMethod2sv(client, context, challenge);
  if (challenge === 'backup_codes') {
    await bloks.bloksApp(client, 'com.bloks.www.two_factor_login.enter_backup_code', {
      server_params: {
        device_id: client.bundle.uuids.android_device_id,
        two_step_verification_context: context,
        flow_source: 'two_factor_login',
      },
    });
    const result = await bloks.verifyCode2sv(client, context, normalizeBackupCode(code), challenge);
    return bloks.applyLoginResponse(client, result);
  }
  const result = await bloks.verifyCode2sv(client, context, code, challenge);
  return bloks.applyLoginResponse(client, result);
}

module.exports = { legacyTwoFactor, bloksTwoFactor, normalizeBackupCode, looksLikeBackupCode, inferBloksChallenge };