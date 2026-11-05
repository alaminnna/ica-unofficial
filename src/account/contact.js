/**
 * @alaminnna/ica-unofficial — account/contact
 *
 * RESPONSIBILITY: email/phone two-step verification only (send + confirm).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api.request only.
 * MUST NOT:       never log codes; never auto-retry confirms (codes are single-use).
 *
 * DEBUG: when confirm returns fail, check here — wrong endpoint (verify_email_code vs
 * verify_sms_code) or stale code; resend first, then confirm once.
 */

'use strict';

function extraData(client, data) {
  return { ...data, _uid: String(client.userId), _uuid: client.uuid, _csrftoken: client.csrftoken };
}

async function sendConfirmEmail(client, email) {
  if (!email) {
    throw new Error('email required');
  }
  const res = await client.api.request({
    endpoint: 'accounts/send_confirm_email/',
    method: 'POST',
    data: extraData(client, { send_source: 'personal_information', email: String(email) }),
  });
  return { ok: (res || {}).status === 'ok', raw: res };
}

async function confirmEmail(client, email, code) {
  if (!email || !code) {
    throw new Error('email and code required');
  }
  const res = await client.api.request({
    endpoint: 'accounts/verify_email_code/',
    method: 'POST',
    data: extraData(client, { email: String(email), code: String(code) }),
  });
  return { ok: (res || {}).status === 'ok', raw: res };
}

async function sendConfirmPhone(client, phoneNumber) {
  if (!phoneNumber) {
    throw new Error('phoneNumber required');
  }
  const res = await client.api.request({
    endpoint: 'accounts/initiate_phone_number_confirmation/',
    method: 'POST',
    data: extraData(client, {
      android_build_type: 'release',
      send_source: 'edit_profile',
      phone_number: String(phoneNumber),
    }),
  });
  return { ok: (res || {}).status === 'ok', raw: res };
}

async function confirmPhone(client, phoneNumber, code, hasSmsConsent) {
  if (!phoneNumber || !code) {
    throw new Error('phoneNumber and code required');
  }
  const data = { phone_number: String(phoneNumber), verification_code: String(code) };
  if (hasSmsConsent) {
    data.has_sms_consent = 'true';
  }
  const res = await client.api.request({
    endpoint: 'accounts/verify_sms_code/',
    method: 'POST',
    data: extraData(client, data),
  });
  return { ok: (res || {}).status === 'ok', raw: res };
}

module.exports = { sendConfirmEmail, confirmEmail, sendConfirmPhone, confirmPhone };