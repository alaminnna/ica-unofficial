/**
 * @alaminnna/ica-unofficial — auth/signup
 *
 * RESPONSIBILITY: legacy account registration: pre-checks (email/username/
 * phone/age), verification codes, accounts_create, interactive orchestrator.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../core/crypto (passwordEncrypt, fetchPasswordKey),
 *                 ../core/utils (uuid4, sleep), ../exceptions, client.api
 * MUST NOT:       never auto-retry challenge_required — throw for the caller
 *                 to resolve via the normal challenge flow
 *
 * DEBUG: when create returns challenge_required, start looking here — the
 * challenge payload is rethrown for the caller, not consumed
 */

'use strict';

const crypto = require('node:crypto');
const { passwordEncrypt, fetchPasswordKey } = require('../core/crypto');
const { uuid4, sleep } = require('../core/utils');
const { ClientError, ChallengeRequired } = require('../exceptions');

function waterfallId(client) {
  return client.caaWaterfallId || uuid4();
}

async function fetchKey(client) {
  if (client.publicGet) {
    return fetchPasswordKey(client.publicGet);
  }
  await client.api.request({ endpoint: 'qe/sync/', method: 'POST', data: { id: client.bundle.uuids.uuid, server_config_retrieval: '1' } });
  const headers = ((client.api.lastResponse || {}).headers) || {};
  const lowered = {};
  Object.keys(headers).forEach((key) => {
    lowered[String(key).toLowerCase()] = headers[key];
  });
  return {
    keyId: Number(lowered['ig-set-password-encryption-key-id']),
    pubKey: lowered['ig-set-password-encryption-pub-key'],
  };
}

async function getSignupConfig(client) {
  return client.api.request({
    endpoint: 'consent/get_signup_config/',
    method: 'GET',
    params: { guid: client.uuid, main_account_selected: false },
  });
}

async function checkEmail(client, email) {
  return client.api.request({
    endpoint: 'users/check_email/',
    method: 'POST',
    data: {
      android_device_id: client.androidDeviceId,
      login_nonce_map: '{}',
      login_nonces: '[]',
      email: String(email),
      qe_id: uuid4(),
      waterfall_id: waterfallId(client),
    },
  });
}

async function checkUsername(client, username) {
  return client.api.request({
    endpoint: 'users/check_username/',
    method: 'POST',
    data: { username: String(username), _uuid: client.uuid },
  });
}

async function checkPhoneNumber(client, phoneNumber) {
  const phone = String(phoneNumber).replace(' ', '+');
  return client.api.request({
    endpoint: 'accounts/check_phone_number/',
    method: 'POST',
    data: {
      phone_id: client.phoneId,
      login_nonce_map: '{}',
      phone_number: phone,
      guid: client.uuid,
      device_id: client.androidDeviceId,
      prefill_shown: 'False',
    },
  });
}

async function sendSignupSmsCode(client, phoneNumber) {
  const phone = String(phoneNumber).replace(' ', '+');
  return client.api.request({
    endpoint: 'accounts/send_signup_sms_code/',
    method: 'POST',
    data: {
      phone_id: client.phoneId,
      phone_number: phone,
      guid: client.uuid,
      device_id: client.androidDeviceId,
      android_build_type: 'release',
      waterfall_id: waterfallId(client),
    },
  });
}

async function sendVerifyEmail(client, email) {
  return client.api.request({
    endpoint: 'accounts/send_verify_email/',
    method: 'POST',
    data: {
      phone_id: client.phoneId,
      device_id: client.androidDeviceId,
      email: String(email),
      waterfall_id: waterfallId(client),
      auto_confirm_only: 'false',
    },
  });
}

async function checkConfirmationCode(client, email, code) {
  return client.api.request({
    endpoint: 'accounts/check_confirmation_code/',
    method: 'POST',
    data: {
      code: String(code),
      device_id: client.androidDeviceId,
      email: String(email),
      waterfall_id: waterfallId(client),
    },
  });
}

async function checkAgeEligibility(client, year, month, day) {
  return client.api.request({
    endpoint: 'consent/check_age_eligibility/',
    method: 'POST',
    data: { _csrftoken: client.csrftoken || client.bundle.csrftoken, day, year, month },
  });
}

async function accountsCreate(client, options) {
  const opts = options || {};
  if (!opts.email && !opts.phoneNumber) {
    throw new ClientError('@alaminnna/ica-unofficial: accountsCreate needs email or phoneNumber', {});
  }
  const key = await fetchKey(client);
  const encPassword = await passwordEncrypt(String(opts.password || ''), key);
  let jazoest = String(22300 + Math.floor(Math.random() * 99));
  try {
    const { generateJazoest } = require('../core/device');
    if (typeof generateJazoest === 'function') {
      jazoest = generateJazoest();
    }
  } catch (ignored) {
    // fallback above
  }
  const data = {
    jazoest,
    tos_version: 'row',
    suggestedUsername: '',
    sn_result: '',
    do_not_auto_login_if_credentials_match: 'false',
    phone_id: client.phoneId,
    enc_password: encPassword,
    username: String(opts.username),
    first_name: String(opts.fullName || ''),
    adid: '',
    guid: client.uuid,
    day: opts.day === undefined ? null : opts.day,
    month: opts.month === undefined ? null : opts.month,
    year: opts.year === undefined ? null : opts.year,
    device_id: client.androidDeviceId,
    _uuid: client.uuid,
    waterfall_id: waterfallId(client),
    one_tap_opt_in: 'true',
    ...(opts.extra || {}),
  };
  let endpoint = 'accounts/create_validated/';
  let domain = null;
  if (opts.email && !opts.phoneNumber) {
    endpoint = 'accounts/create/';
    domain = 'www.instagram.com';
    data.email = String(opts.email);
    data.force_sign_up_code = String(opts.signupCode || '');
    data.qs_stamp = '';
    data.sn_nonce = Buffer.from(opts.email + '|' + Math.floor(Date.now() / 1000) + '|' + crypto.randomBytes(24).toString('hex'), 'utf8');
  } else {
    data.phone_number = String(opts.phoneNumber || '');
    data.verification_code = String(opts.phoneCode || '');
    data.force_sign_up_code = '';
    data.has_sms_consent = 'true';
  }
  const res = await client.api.request({ endpoint, method: 'POST', domain, data });
  if ((res || {}).message === 'challenge_required') {
    throw new ChallengeRequired('@alaminnna/ica-unofficial: signup challenge required', { challenge: (res || {}).challenge || null });
  }
  return res;
}

async function waitForCode(client, username, choice) {
  const handler = client.challengeCodeHandler;
  if (typeof handler !== 'function') {
    throw new ClientError('@alaminnna/ica-unofficial: signup needs challengeCodeHandler for verification codes', {});
  }
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const code = await handler(username, choice);
    if (code) {
      return { code: String(code), attempts: attempt };
    }
    await sleep(1500 * attempt);
  }
  throw new ClientError('@alaminnna/ica-unofficial: no verification code provided', {});
}

async function signup(client, options) {
  const opts = options || {};
  if (!opts.email && !opts.phoneNumber) {
    throw new ClientError('@alaminnna/ica-unofficial: signup needs email or phoneNumber', {});
  }
  await getSignupConfig(client);
  const extra = {
    username: opts.username,
    password: opts.password,
    fullName: opts.fullName || '',
    year: opts.year,
    month: opts.month,
    day: opts.day,
  };
  if (opts.email) {
    const check = await checkEmail(client, opts.email);
    if (!check.valid) {
      throw new ClientError('@alaminnna/ica-unofficial: email not valid', {});
    }
    if (!check.available) {
      throw new ClientError('@alaminnna/ica-unofficial: email not available', {});
    }
    const sent = await sendVerifyEmail(client, opts.email);
    if (!sent.email_sent) {
      throw new ClientError('@alaminnna/ica-unofficial: failed to send verification email', {});
    }
    if (opts.year && opts.month && opts.day) {
      const age = await checkAgeEligibility(client, opts.year, opts.month, opts.day);
      const eligible = age.eligible_to_register !== undefined ? age.eligible_to_register : age.eligible;
      if (!eligible) {
        throw new ClientError('@alaminnna/ica-unofficial: account not eligible based on age criteria', {});
      }
    }
    const { code } = await waitForCode(client, opts.username, 'email');
    const confirmed = await checkConfirmationCode(client, opts.email, code);
    extra.email = opts.email;
    extra.signupCode = confirmed.signup_code;
  } else {
    extra.phoneNumber = opts.phoneNumber;
    const check = await checkPhoneNumber(client, opts.phoneNumber);
    if (check.status !== 'ok' && !check.valid) {
      throw new ClientError('@alaminnna/ica-unofficial: phone number not valid', {});
    }
    const sms = await sendSignupSmsCode(client, opts.phoneNumber);
    if (sms.status !== 'ok') {
      throw new ClientError('@alaminnna/ica-unofficial: error verifying phone number', {});
    }
    if (sms.verification_code) {
      extra.phoneCode = sms.verification_code;
    } else {
      const { code } = await waitForCode(client, opts.username, 'sms');
      extra.phoneCode = code;
    }
  }
  let last = null;
  for (let retries = 0; retries < 3; retries += 1) {
    const data = await accountsCreate(client, extra);
    if ((data || {}).message !== 'challenge_required') {
      last = data;
      break;
    }
    last = data;
  }
  const created = (last || {}).created_user;
  if (!created) {
    throw new ClientError('@alaminnna/ica-unofficial: signup did not return created_user', {});
  }
  return { userId: String(created.pk || created.id || ''), username: created.username || null, raw: created };
}

async function getFeaturedAccounts(client, targetUserId) {
  return client.api.request({
    endpoint: 'multiple_accounts/get_featured_accounts/',
    method: 'GET',
    params: { target_user_id: String(targetUserId) },
  });
}

async function getAccountFamily(client) {
  return client.api.request({ endpoint: 'multiple_accounts/get_account_family/', method: 'GET' });
}

module.exports = {
  getSignupConfig,
  checkEmail,
  checkUsername,
  checkPhoneNumber,
  sendSignupSmsCode,
  sendVerifyEmail,
  checkConfirmationCode,
  checkAgeEligibility,
  accountsCreate,
  signup,
  getFeaturedAccounts,
  getAccountFamily,
};