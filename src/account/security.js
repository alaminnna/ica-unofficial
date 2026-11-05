/**
 * @alaminnna/ica-unofficial — account/security
 *
 * RESPONSIBILITY: password + security-info + www password-reset only.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api.request + client.rateGuard + client.http.axios (www reset only).
 * MUST NOT:       never log passwords/codes; never import from src/auth internals.
 *
 * DEBUG: when changePassword returns ok=false, check here — enc_* trio shape or
 * missing _csrftoken; when reset gets no email, the www ajax (not private API) is the suspect.
 */

'use strict';

const { passwordEncrypt, fetchPasswordKey } = require('../core/crypto');

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

async function getSecurityInfo(client) {
  const res = await client.api.request({
    endpoint: 'accounts/account_security_info/',
    method: 'POST',
    data: {},
  });
  const data = res || {};
  return {
    isPhoneConfirmed: data.is_phone_confirmed === undefined ? null : data.is_phone_confirmed,
    isTwoFactorEnabled: data.is_two_factor_enabled === undefined ? null : data.is_two_factor_enabled,
    isTotpEnabled: data.is_totp_two_factor_enabled === undefined ? null : data.is_totp_two_factor_enabled,
    backupCodes: data.backup_codes || [],
    trustedDevices: data.trusted_devices || [],
    hasReachableEmail: data.has_reachable_email === undefined ? null : data.has_reachable_email,
    raw: data,
  };
}

async function changePassword(client, oldPassword, newPassword) {
  if (!oldPassword || !newPassword) {
    throw new Error('oldPassword and newPassword required');
  }
  return guardOf(client).schedule(async () => {
    const publicGet = async (url) => client.http.axios.get(url, { timeout: 15000 });
    const key = await fetchPasswordKey(publicGet);
    const encOld = await passwordEncrypt(String(oldPassword), key);
    const encNew = await passwordEncrypt(String(newPassword), key);
    const res = await client.api.request({
      endpoint: 'accounts/change_password/',
      method: 'POST',
      data: {
        enc_old_password: encOld,
        enc_new_password1: encNew,
        enc_new_password2: encNew,
        _uid: String(client.userId),
        _uuid: client.uuid,
        _csrftoken: client.csrftoken,
      },
    });
    return { ok: (res || {}).status === 'ok', raw: res };
  });
}

async function sendPasswordReset(client, identifier) {
  if (!identifier) {
    throw new Error('identifier required');
  }
  return guardOf(client).schedule(async () => {
    const csrftoken = client.csrftoken || 'missing';
    const body = new URLSearchParams({
      email_or_username: String(identifier),
      recaptcha_challenge_field: '',
    }).toString();
    const res = await client.http.axios.post(
      'https://www.instagram.com/accounts/account_recovery_send_ajax/',
      body,
      {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': csrftoken,
          Referer: 'https://www.instagram.com/accounts/password/reset/',
        },
      }
    );
    const data = (res || {}).data || {};
    return { ok: (data.status || data.state || 'ok') === 'ok', raw: data };
  });
}

module.exports = { getSecurityInfo, changePassword, sendPasswordReset };