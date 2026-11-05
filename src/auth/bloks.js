/**
 * @alaminnna/ica-unofficial — auth/bloks
 * 
 * RESPONSIBILITY: Bloks plumbing: CAA/2SV/challenge action helpers and context extractors.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api
 * MUST NOT:       never drive UX from here
 * 
 * DEBUG: when a Bloks flow stalls mid-flight, start looking here — action payload shape
 */

'use strict';

const VERSIONING_ASSERT = '@alaminnna/ica-unofficial: bloks_versioning_id is empty (hash expected)';

function bloksPayload(client, params) {
  const versioningId = client.bloksVersioningId;
  if (!versioningId) {
    throw new Error(VERSIONING_ASSERT);
  }
  return {
    params: JSON.stringify(params),
    _uuid: client.bundle.uuids.uuid,
    bk_client_context: JSON.stringify({ bloks_version: versioningId, styles_id: 'instagram' }),
    bloks_versioning_id: versioningId,
  };
}

async function bloksAsyncAction(client, action, params, options) {
  const opts = options || {};
  const headers = { 'X-FB-Friendly-Name': 'IgApi: bloks/async_action/' + action + '/' };
  if (opts.extraHeaders) {
    Object.assign(headers, opts.extraHeaders);
  }
  return client.api.request({
    endpoint: 'bloks/async_action/' + action + '/',
    data: bloksPayload(client, params),
    headers,
    domain: opts.domain,
    login: true,
  });
}

async function bloksApp(client, app, params, options) {
  const opts = options || {};
  return client.api.request({
    endpoint: 'bloks/apps/' + app + '/',
    data: bloksPayload(client, params),
    domain: opts.domain,
    login: true,
  });
}

async function takeChallenge(client, options) {
  const opts = options || {};
  const data = {
    _uuid: client.bundle.uuids.uuid,
    has_follow_up_screens: String(opts.hasFollowUpScreens || 0),
    bk_client_context: JSON.stringify({ bloks_version: client.bloksVersioningId, styles_id: 'instagram' }),
    bloks_versioning_id: client.bloksVersioningId,
  };
  if (opts.challengeContext !== undefined && opts.challengeContext !== null) {
    data.challenge_context = opts.challengeContext;
  }
  if (opts.choice !== undefined && opts.choice !== null) {
    data.choice = String(opts.choice);
  }
  if (opts.extraData) {
    Object.assign(data, opts.extraData);
  }
  return client.api.request({ endpoint: 'bloks/apps/com.instagram.challenge.navigation.take_challenge/', data, login: true });
}

function entrypoint2sv(client, context, flowSource) {
  return bloksApp(client, 'com.bloks.www.two_step_verification.entrypoint', {
    client_input_params: { device_id: client.bundle.uuids.android_device_id, is_whatsapp_installed: 0, machine_id: client.mid },
    server_params: {
      should_fallback_to_sms: 0,
      family_device_id: client.bundle.uuids.phone_id,
      device_id: client.bundle.uuids.android_device_id,
      two_step_verification_context: context,
      flow_source: flowSource || 'two_factor_login',
    },
  });
}

function methodPicker2sv(client, context, flowSource) {
  return bloksApp(client, 'com.bloks.www.two_step_verification.method_picker', {
    client_input_params: { is_whatsapp_installed: 0 },
    server_params: {
      should_fallback_to_sms: 0,
      device_id: client.bundle.uuids.android_device_id,
      two_step_verification_context: context,
      flow_source: flowSource || 'two_factor_login',
    },
  });
}

function selectMethod2sv(client, context, method, flowSource) {
  return bloksAsyncAction(client, 'com.bloks.www.two_step_verification.method_picker.navigation.async', {
    client_input_params: { selected_method: method, cloud_trust_token: null, network_bssid: null },
    server_params: {
      should_fallback_to_sms: 0,
      device_id: client.bundle.uuids.android_device_id,
      spectra_reg_login_data: null,
      two_step_verification_context: context,
      flow_source: flowSource || 'two_factor_login',
    },
  });
}

function verifyCode2sv(client, context, code, challenge, flowSource) {
  return bloksAsyncAction(client, 'com.bloks.www.two_step_verification.verify_code.async', {
    client_input_params: {
      auth_secure_device_id: '',
      block_store_machine_id: '',
      code: String(code),
      should_trust_device: 1,
      family_device_id: client.bundle.uuids.phone_id,
      device_id: client.bundle.uuids.android_device_id,
      cloud_trust_token: null,
      network_bssid: null,
      machine_id: client.mid,
    },
    server_params: {
      should_fallback_to_sms: 0,
      device_id: client.bundle.uuids.android_device_id,
      spectra_reg_login_data: null,
      challenge: challenge || 'totp',
      two_step_verification_context: context,
      flow_source: flowSource || 'two_factor_login',
    },
  });
}

function collectStrings(value, out) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((child) => collectStrings(child, out));
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => collectStrings(value[key], out));
  }
  return out;
}

function extractAac(result) {
  const data = ((result.layout || {}).bloks_payload || {}).data;
  if (!Array.isArray(data)) {
    return '';
  }
  for (const node of data) {
    const payload = node && node.data;
    if (!payload || typeof payload !== 'object' || payload.key !== 'CAA_ACCOUNT_ACCESS_CONTEXT:aac') {
      continue;
    }
    if (typeof payload.initial === 'string' && payload.initial.trim()) {
      return payload.initial;
    }
    if (typeof payload.initial_lispy === 'string' && payload.initial_lispy) {
      const found = extractFirstJsonString(payload.initial_lispy);
      if (found) {
        return found;
      }
    }
  }
  return '';
}

function firstJsonLiteral(value) {
  const match = /"(?:[^"\\]|\\.)*"/.exec(value);
  return match ? match[0] : '';
}

function extractFirstJsonString(value) {
  const literal = firstJsonLiteral(value);
  if (!literal) {
    return '';
  }
  try {
    const parsed = JSON.parse(literal);
    return typeof parsed === 'string' ? parsed : '';
  } catch (err) {
    return '';
  }
}

function balancedExpression(value, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < value.length; i += 1) {
    const ch = value[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, i + 1);
      }
    }
  }
  return '';
}function stringLiterals(value) {
  const out = [];
  const re = /"(?:[^"\\]|\\.)*"/g;
  let match;
  while ((match = re.exec(value)) !== null) {
    try {
      const parsed = JSON.parse(match[0]);
      if (typeof parsed === 'string') {
        out.push(parsed);
      }
    } catch (err) {
      // skip undecodable literal
    }
  }
  return out;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractContextData(result, appId) {
  const strings = collectStrings(result, []);
  const anchorRe = new RegExp(escapeRegExp(appId) + '(?![_a-zA-Z])');
  const appRe = /(?<![_a-zA-Z0-9])com\.bloks\.[_a-zA-Z0-9.]+/;
  for (const text of strings) {
    const found = anchorRe.exec(text);
    if (!found) {
      continue;
    }
    const afterAnchor = found.index + found[0].length;
    const mapStart = text.indexOf('(f4i', afterAnchor);
    if (mapStart < 0) {
      continue;
    }
    const nextApp = appRe.exec(text.slice(afterAnchor));
    if (nextApp && (afterAnchor + nextApp.index) < mapStart) {
      continue;
    }
    const expression = balancedExpression(text, mapStart);
    if (!expression) {
      continue;
    }
    const groups = [];
    let cursor = 0;
    for (;;) {
      const groupStart = expression.indexOf('(dkc', cursor);
      if (groupStart < 0) {
        break;
      }
      const group = balancedExpression(expression, groupStart);
      if (!group) {
        break;
      }
      groups.push(stringLiterals(group));
      cursor = groupStart + group.length;
    }
    for (let i = 0; i + 1 < groups.length; i += 1) {
      const keys = groups[i];
      const values = groups[i + 1];
      const at = keys.indexOf('context_data');
      if (at !== -1 && at < values.length) {
        return values[at];
      }
    }
  }
  return '';
}

function findBloksValue(data, key) {
  if (typeof data === 'string') {
    if (data.length < 10000 && data.indexOf(key) !== -1) {
      try {
        return findBloksValue(JSON.parse(data), key);
      } catch (err) {
        return null;
      }
    }
    return null;
  }
  if (Array.isArray(data)) {
    for (const child of data) {
      const found = findBloksValue(child, key);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (data && typeof data === 'object') {
    if (data[key]) {
      return data[key];
    }
    for (const k of Object.keys(data)) {
      const found = findBloksValue(data[k], key);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function extract2svContext(result) {
  const value = findBloksValue(result, 'two_step_verification_context');
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  const action = ((result.layout || {}).bloks_payload || {}).action;
  if (typeof action !== 'string' || action.indexOf('two_step_verification.entrypoint') === -1) {
    return '';
  }
  const marker = '"two_step_verification_context"';
  const markerIndex = action.indexOf(marker);
  if (markerIndex < 0) {
    return '';
  }
  const keyListEnd = action.indexOf(')', markerIndex);
  if (keyListEnd < 0) {
    return '';
  }
  const valueGroup = /\(dkc\s+/.exec(action.slice(keyListEnd));
  if (!valueGroup) {
    return '';
  }
  return extractFirstJsonString(action.slice(keyListEnd + valueGroup.index)).trim();
}

function extractLoginResponse(result) {
  const action = ((result.layout || {}).bloks_payload || {}).action;
  if (typeof action !== 'string') {
    return {};
  }
  let index = 0;
  while (index < action.length) {
    const literal = firstJsonLiteral(action.slice(index));
    if (!literal) {
      break;
    }
    index += action.slice(index).indexOf(literal) + literal.length;
    let value;
    try {
      value = JSON.parse(literal);
    } catch (err) {
      continue;
    }
    if (typeof value !== 'string' || value.indexOf('login_response') === -1) {
      continue;
    }
    try {
      const raw = JSON.parse(value);
      const loginResponse = JSON.parse(raw.login_response);
      const headers = JSON.parse(raw.headers || '{}');
      const rawCookies = raw.cookies || '';
      const cookies = {};
      String(rawCookies).split(';').forEach((part) => {
        const cleaned = part.replace(/Set-Cookie:\s*/g, '').trim();
        const eq = cleaned.indexOf('=');
        if (eq > 0) {
          cookies[cleaned.slice(0, eq).trim()] = cleaned.slice(eq + 1).trim();
        }
      });
      return { login_response: loginResponse, headers, cookies, raw_cookies: rawCookies, raw };
    } catch (err) {
      continue;
    }
  }
  return {};
}

function parseAuthorization(header) {
  if (!header) {
    return {};
  }
  try {
    const b64 = String(header).split(':').pop();
    if (!b64) {
      return {};
    }
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (err) {
    return {};
  }
}

function applyLoginResponse(client, result) {
  const parsed = (result && (result.headers || result.cookies)) ? result : extractLoginResponse(result);
  if (!parsed || (Object.keys(parsed).length === 0)) {
    return false;
  }
  const headers = parsed.headers || {};
  const lowered = {};
  Object.keys(headers).forEach((key) => {
    lowered[key.toLowerCase()] = headers[key];
  });
  const cookies = parsed.cookies || {};
  const authorization = lowered['ig-set-authorization'];
  if (authorization) {
    client.authorizationData = parseAuthorization(authorization);
  }
  Object.keys(cookies).forEach((name) => {
    client.http.jar.setCookieSync(name + '=' + cookies[name], 'https://i.instagram.com');
  });
  if (lowered['ig-set-ig-u-rur']) {
    client.igURur = lowered['ig-set-ig-u-rur'];
  }
  if (lowered['x-ig-set-www-claim']) {
    client.igWwwClaim = lowered['x-ig-set-www-claim'];
  }
  return Boolean(authorization || cookies.sessionid);
}

async function changePasswordBloks(client, password, challengeContext) {
  const { passwordEncrypt, fetchPasswordKey } = require('../core/crypto');
  const key = await fetchPasswordKey((url) => client.http.axios.get(url).then((res) => ({ headers: res.headers })));
  const enc = await passwordEncrypt(password, key);
  const res = await takeChallenge(client, {
    challengeContext,
    extraData: { enc_new_password1: enc, enc_new_password2: enc },
  });
  return ((res || {}).status || '') === 'ok';
}

module.exports = {
  bloksPayload,
  bloksAsyncAction,
  bloksApp,
  takeChallenge,
  entrypoint2sv,
  methodPicker2sv,
  selectMethod2sv,
  verifyCode2sv,
  collectStrings,
  extractAac,
  extractFirstJsonString,
  extractContextData,
  extract2svContext,
  extractLoginResponse,
  parseAuthorization,
  applyLoginResponse,
  changePasswordBloks,
};