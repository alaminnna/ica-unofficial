/**
 * @alaminnna/ica-unofficial — auth/challenge
 * 
 * RESPONSIBILITY: challenge resolution: code/password dispatch and Bloks dismiss.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./bloks, ../exceptions
 * MUST NOT:       never loop challenges automatically
 * 
 * DEBUG: when challenge_required loops, start looking here — step dispatch
 */

'use strict';

const ex = require('../exceptions');
const { takeChallenge, changePasswordBloks } = require('./bloks');

const BLOKS_REDIRECT_ACTION = 'com.bloks.www.ig.challenge.redirect.async';

function alog(client, message) {
  try {
    if (client && typeof client.authLog === 'function') {
      client.authLog('[AUTH] ' + message);
    }
  } catch (err) {
    // logging must never break the challenge flow
  }
}

function normalizeApiPath(apiPath) {
  const path = String(apiPath || '');
  if (path.indexOf('/api/v1/') === 0) {
    return path.slice('/api/v1'.length);
  }
  if (path.indexOf('/api/') === 0) {
    return path.slice('/api'.length);
  }
  return path;
}

function errorContext(lastJson) {
  const out = {};
  Object.keys(lastJson || {}).forEach((key) => {
    if (key !== 'message') {
      out[key] = lastJson[key];
    }
  });
  return out;
}

function manualRequired(message, lastJson) {
  return new ex.ChallengeRequired(message + ' Complete it in the official Instagram app or web flow on a trusted device, then retry with the same saved settings, device identifiers, and proxy/IP.', errorContext(lastJson));
}

async function challengeCodeOrRaised(client, lastJson, choice, codeHandler) {
  alog(client, 'challenge code requested (choice ' + choice + ')');
  const code = await codeHandler(client.username, choice);
  alog(client, code ? 'challenge code provided' : 'challenge code missing');
  if (code) {
    return code;
  }
  throw new ex.ChallengeRequired('Challenge code required. Provide it via challengeCodeHandler or retry login after saving client settings.', errorContext(lastJson));
}

async function changePasswordOrRaised(client, lastJson, challengeContext, passwordHandler) {
  if (!challengeContext) {
    throw new ex.ChallengeRequired('Password change required, but Instagram did not return a challenge context. Complete the flow manually.', errorContext(lastJson));
  }
  const password = await passwordHandler(client.username);
  if (!password) {
    throw new ex.ChallengeRequired('Password change required. Provide a new password via changePasswordHandler or complete the flow manually.', errorContext(lastJson));
  }
  return changePasswordBloks(client, password, challengeContext);
}

async function challengeBloksDismiss(client) {
  const lastJson = client.api.lastJson || {};
  if (lastJson.bloks_action !== BLOKS_REDIRECT_ACTION || !lastJson.challenge_context) {
    throw new ex.ChallengeRequired('No pending Bloks redirect challenge context found. Retry the original login/request first, then approve it in the official app.', errorContext(lastJson));
  }
  const result = await takeChallenge(client, { challengeContext: lastJson.challenge_context });
  if (result && typeof result === 'object') {
    client.api.lastJson = result;
  }
  const current = client.api.lastJson || {};
  if (current.status !== 'ok') {
    throw manualRequired('Manual verification required via Instagram Bloks redirect checkpoint.', current);
  }
  return true;
}

async function resolveChallenge(client, lastJson, handlers) {
  const json = lastJson || {};
  const challenge = json.challenge || {};
  const apiPath = normalizeApiPath(challenge.api_path || json.api_path || '');
  alog(client, 'resolve start api_path=' + apiPath + ' step=' + (json.step_name || '(none)'));
  if (apiPath.indexOf('/auth_platform/') === 0) {
    throw manualRequired('Manual verification required via Instagram auth platform flow. This challenge is not supported automatically.', json);
  }
  if (challenge.native_flow && apiPath.indexOf('/challenge/') === 0) {
    throw manualRequired('Manual verification required via Instagram native challenge flow.', json);
  }
  if (json.step_name === 'ufac_www_bloks') {
    throw manualRequired('Manual verification required via Instagram UFAC web bloks checkpoint.', json);
  }
  if (json.step_name === 'selfie_captcha') {
    throw new ex.ChallengeSelfieCaptcha(json);
  }
  if (json.bloks_action === BLOKS_REDIRECT_ACTION) {
    if (json.challenge_type_enum_str === 'PASSWORD_RESET') {
      return changePasswordOrRaised(client, json, json.challenge_context, handlers.password);
    }
    if (!json.challenge_context) {
      throw manualRequired('Manual verification required via Instagram Bloks redirect checkpoint.', json);
    }
    const result = await takeChallenge(client, { challengeContext: json.challenge_context, choice: 0 });
    if (result && typeof result === 'object') {
      client.api.lastJson = result;
    }
    const current = client.api.lastJson || {};
    if (current.status !== 'ok') {
      throw manualRequired('Manual verification required via Instagram Bloks redirect checkpoint.', current);
    }
    if (current.action === 'close' || current.type === 'CHALLENGE_REDIRECTION') {
      return true;
    }
    if (current.bloks_action === BLOKS_REDIRECT_ACTION) {
      throw manualRequired('Manual verification required via Instagram Bloks redirect checkpoint.', current);
    }
    if (current.step_name) {
      return resolveSimple(client, apiPath, handlers);
    }
    return true;
  }
  if (!challenge.api_path) {
    if (json && json.step_name) {
      client.api.lastJson = json;
    }
    if (json.step_name) {
      return resolveSimple(client, apiPath, handlers);
    }
    if (json.action === 'close' && json.status === 'ok') {
      return true;
    }
    throw new ex.ChallengeUnknownStep('ChallengeResolve: unknown challenge shape for "' + client.username + '"', errorContext(json));
  }
  return resolveContactOrSimple(client, apiPath, json, handlers);
}async function apiGet(client, url, params) {
  return client.api.request({ endpoint: url.replace(/^\//, ''), method: 'GET', params });
}

async function apiPost(client, url, data) {
  return client.api.request({ endpoint: url.replace(/^\//, ''), method: 'POST', data });
}

async function resolveContactOrSimple(client, apiPath, lastJson, handlers) {
  const parts = apiPath.split('/');
  let params = {};
  if (parts.length >= 4) {
    const userId = parts[2];
    const nonce = parts[3];
    let challengeContext = ((lastJson.challenge || {}).challenge_context) || '';
    if (!challengeContext) {
      challengeContext = JSON.stringify({ step_name: '', nonce_code: nonce, user_id: Number(userId), is_stateless: false });
    }
    params = { guid: client.bundle.uuids.uuid, device_id: client.bundle.uuids.android_device_id, challenge_context: challengeContext };
  }
  try {
    await apiGet(client, apiPath, params);
  } catch (err) {
    if (err && err.name === 'ChallengeRequired') {
      return resolveContactForm(client, apiPath, handlers);
    }
    throw err;
  }
  return resolveSimple(client, apiPath, handlers);
}

async function resolveSimple(client, challengeUrl, handlers) {
  const lastJson = client.api.lastJson || {};
  const step = lastJson.step_name || '';
  if (step === 'delta_login_review' || step === 'delta_acknowledge_approved' || step === 'scraping_warning') {
    await apiPost(client, challengeUrl, { choice: '0' });
    return true;
  }
  if (step === 'add_birthday') {
    await apiPost(client, challengeUrl, {
      birthday_year: String(1970 + Math.floor(Math.random() * 35)),
      birthday_month: String(1 + Math.floor(Math.random() * 12)),
      birthday_day: String(1 + Math.floor(Math.random() * 28)),
    });
    return true;
  }
  if (step === 'verify_email' || step === 'verify_email_code' || step === 'verify_phone' || step === 'verify_phone_code' || step === 'verify_sms' || step === 'verify_sms_code' || step === 'select_verify_method') {
    let choice = step.indexOf('phone') !== -1 || step.indexOf('sms') !== -1 ? 1 : 0;
    let url = challengeUrl;
    if (step === 'select_verify_method') {
      const steps = Object.keys(lastJson.step_data || {});
      url = challengeUrl.replace(/^\//, '');
      if (steps.indexOf('email') !== -1) {
        choice = 0;
        await apiPost(client, url, { choice: '0' });
      } else if (steps.indexOf('phone_number') !== -1) {
        choice = 1;
        await apiPost(client, url, { choice: '1' });
      } else {
        throw new ex.ChallengeError('ChallengeResolve: Choice "email" or "phone_number" (sms) not available to this account', errorContext(lastJson));
      }
    }
    alog(client, 'submitting security code');
    const code = await challengeCodeOrRaised(client, client.api.lastJson || {}, choice, handlers.code);
    await apiPost(client, url, { security_code: code });
    const current = client.api.lastJson || {};
    if (current.action !== 'close' || current.status !== 'ok') {
      throw new ex.ChallengeError('ChallengeResolve: security code was not accepted', errorContext(current));
    }
    return true;
  }
  if (step === 'submit_phone') {
    if (!client.phoneNumber) {
      throw new ex.ChallengeRequired('Phone number required to continue submit_phone challenge. Set client.phoneNumber or complete the flow manually.', errorContext(lastJson));
    }
    await apiPost(client, challengeUrl, { phone_number: client.phoneNumber });
    if ((client.api.lastJson || {}).step_name === step) {
      throw new ex.ChallengeError('submit_phone challenge did not advance after phone submission', errorContext(client.api.lastJson || {}));
    }
    return resolveSimple(client, challengeUrl, handlers);
  }
  if (step === 'select_contact_point_recovery') {
    const steps = Object.keys((client.api.lastJson || {}).step_data || {});
    const url = challengeUrl.replace(/^\//, '');
    let choice = 0;
    if (steps.indexOf('email') !== -1) {
      await apiPost(client, url, { choice: '0' });
    } else if (steps.indexOf('phone_number') !== -1) {
      choice = 1;
      await apiPost(client, url, { choice: '1' });
    } else {
      throw new ex.ChallengeError('ChallengeResolve: Choice "email" or "phone_number" (sms) not available to this account', errorContext(lastJson));
    }
    alog(client, 'submitting security code');
    const code = await challengeCodeOrRaised(client, client.api.lastJson || {}, choice, handlers.code);
    await apiPost(client, url, { security_code: code });
    const current = client.api.lastJson || {};
    if (current.action === 'close' && current.status === 'ok') {
      return true;
    }
    if (current.step_name !== 'review_contact_point_change') {
      throw new ex.ChallengeError('Unexpected final challenge step after contact point recovery', errorContext(current));
    }
    await apiPost(client, url, { choice: 0 });
    return true;
  }
  if (step === 'change_password') {
    return changePasswordOrRaised(client, lastJson, lastJson.challenge_context || '', handlers.password);
  }
  if (step === '') {
    if (lastJson.action === 'close' && lastJson.status === 'ok') {
      return true;
    }
  }
  throw new ex.ChallengeUnknownStep('ChallengeResolve: Unknown step_name "' + step + '"', errorContext(lastJson));
}const WEB_UA = 'Mozilla/5.0 (Linux; Android 8.0.0; MI 5s Build/OPR1.170623.032; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/80.0.3987.149 Mobile Safari/537.36';

async function resolveContactForm(client, apiPath, handlers) {
  const challengeUrl = 'https://i.instagram.com' + apiPath;
  const ajaxSeed = '#PWD_INSTAGRAM_BROWSER:0:' + Math.floor(Date.now() / 1000) + ':';
  const instagramAjax = require('node:crypto').createHash('sha256').update(ajaxSeed).digest('hex').slice(0, 12);
  const axios = client.http.axios;
  const jar = client.http.jar;
  const cookiesOf = (names) => {
    const all = jar.getCookiesSync(challengeUrl);
    const out = {};
    all.forEach((c) => {
      if (names.indexOf(c.key) !== -1) {
        out[c.key] = c.value;
      }
    });
    return out;
  };
  const baseHeaders = {
    'User-Agent': WEB_UA,
    'upgrade-insecure-requests': '1',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'x-requested-with': 'com.instagram.android',
    'accept-language': 'en-US,en;q=0.9',
    'pragma': 'no-cache',
    'cache-control': 'no-cache',
  };
  const seed = cookiesOf(['mid', 'csrftoken']);
  const cookieHeader = Object.keys(seed).map((k) => k + '=' + seed[k]).join('; ');
  if (cookieHeader) {
    baseHeaders.Cookie = cookieHeader;
  }
  await axios.get(challengeUrl, { headers: baseHeaders });
  const postHeaders = {
    'x-ig-www-claim': '0',
    'x-instagram-ajax': instagramAjax,
    'content-type': 'application/x-www-form-urlencoded',
    accept: '*/*',
    'x-requested-with': 'XMLHttpRequest',
    'x-csrftoken': cookiesOf(['csrftoken']).csrftoken || '',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    referer: challengeUrl,
  };
  if (cookieHeader) {
    postHeaders.Cookie = cookieHeader;
  }
  const post = (data) => axios.post(challengeUrl, new URLSearchParams(data).toString(), { headers: postHeaders }).then((res) => res.data);
  let choice = 0;
  let result = await post({ choice: String(choice) });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      result = handleChallengeResult(result);
      break;
    } catch (err) {
      if (err && err.name === 'SelectContactPointRecoveryForm') {
        if (choice === 1) {
          throw err;
        }
        choice = 1;
        result = await post({ choice: '1' });
        continue;
      }
      if (err && err.name === 'SubmitPhoneNumberForm') {
        const fields = ((err.extra || {}).challenge || {}).fields || {};
        result = await post({ phone_number: fields.phone_number, challenge_context: (err.extra || {}).challenge.challenge_context });
        break;
      }
      throw err;
    }
  }
  const challengeType = result.challengeType;
  if (challengeType !== 'VerifyEmailCodeForm' && challengeType !== 'VerifySMSCodeForm' && challengeType !== 'VerifySMSCodeFormForSMSCaptcha') {
    throw new ex.ChallengeError('Unexpected contact-form challenge step after verification selection', { result });
  }
  for (let retry = 0; retry < 5; retry += 1) {
    alog(client, 'submitting security code');
    const code = await challengeCodeOrRaised(client, client.api.lastJson || {}, choice, handlers.code);
    result = await post({ security_code: code });
    result = result.challenge || result;
    const errors = result.errors || [''];
    if (String(errors[0]).indexOf('Please check the code we sent you and try again') === -1) {
      break;
    }
  }
  if (result.challengeType === 'LegacyForceSetNewPasswordForm') {
    throw new ex.LegacyForceSetNewPasswordForm('Log into your Instagram account from smartphone and change password!', { result });
  }
  if (result.challengeType !== 'ReviewContactPointChangeForm') {
    throw new ex.ChallengeError('Unexpected contact-form challenge step after security code submission', { result });
  }
  const navigation = result.navigation || {};
  if (!navigation.forward) {
    throw new ex.ChallengeError('Contact-form challenge response did not provide a forward navigation target.', { result });
  }
  const final = await axios.post('https://i.instagram.com' + navigation.forward, new URLSearchParams({ choice: '0', enc_new_password1: ajaxSeed, new_password1: '', enc_new_password2: ajaxSeed, new_password2: '' }).toString(), { headers: postHeaders }).then((res) => res.data);
  if (final.type !== 'CHALLENGE_REDIRECTION' || final.status !== 'ok') {
    throw new ex.ChallengeError('Unexpected final response after contact-form approval', { result: final });
  }
  return true;
}

function handleChallengeResult(challenge) {
  let payload = challenge && challenge.challenge ? challenge.challenge : challenge;
  if (payload && typeof payload !== 'object') {
    throw new ex.ChallengeError('Malformed nested challenge payload received from Instagram.', {});
  }
  const type = payload.challengeType;
  if (type === 'SelectContactPointRecoveryForm') {
    throw new ex.SelectContactPointRecoveryForm('Select a contact point recovery option', { challenge: payload });
  }
  if (type === 'RecaptchaChallengeForm') {
    throw new ex.RecaptchaChallengeForm((payload.errors || []).join('. '), { challenge: payload });
  }
  if (type === 'VerifyEmailCodeForm' || type === 'VerifySMSCodeForm' || type === 'VerifySMSCodeFormForSMSCaptcha') {
    return payload;
  }
  if (type === 'SubmitPhoneNumberForm') {
    throw new ex.SubmitPhoneNumberForm('Submit a phone number', { challenge: payload });
  }
  if (type) {
    throw new ex.ChallengeError('Unsupported challenge type: ' + type + '. (Please manual login)', { challenge: payload });
  }
  if (payload.type === 'CHALLENGE_REDIRECTION') {
    throw new ex.ChallengeRedirection('challenge redirection', {});
  }
  return payload;
}

module.exports = { resolveChallenge, challengeBloksDismiss, handleChallengeResult };