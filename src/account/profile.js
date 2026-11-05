/**
 * @alaminnna/ica-unofficial — account/profile
 *
 * RESPONSIBILITY: self profile read/edit only (info, edit merge, bio, links, picture, private/public, professional convert).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api.request + client.rateGuard only (+ ../user/lookup
 *                 privateGraphqlQuery for the AI-label mutation).
 * MUST NOT:       never touch auth internals; never log emails/phones unmasked.
 *
 * DEBUG: when .myinfo fields missing, start here — account_info shape; when edit fails with
 * "need email or confirmed phone", the merge pre-fetch below is the suspect.
 */

'use strict';

function normalizeAccount(raw) {
  const data = raw || {};
  return {
    userId: data.pk === undefined || data.pk === null ? null : String(data.pk),
    username: data.username || null,
    fullName: data.full_name || null,
    biography: data.biography || null,
    externalUrl: data.external_url || null,
    email: data.email || null,
    phoneNumber: data.phone_number || null,
    birthday: data.birthday || null,
    gender: data.gender === undefined ? null : data.gender,
    isPrivate: data.is_private === undefined ? null : data.is_private,
    isVerified: data.is_verified === undefined ? null : data.is_verified,
    profilePicUrl: data.profile_pic_url || null,
    bioLinks: data.bio_links || null,
  };
}

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

function actionData(client) {
  return { _uid: String(client.userId), _uuid: client.uuid };
}

async function getAccountInfo(client) {
  const res = await client.api.request({ endpoint: 'accounts/current_user/?edit=true', method: 'GET' });
  return normalizeAccount((res || {}).user || {});
}

async function editAccount(client, fields) {
  const input = fields || {};
  const allowed = ['external_url', 'username', 'full_name', 'biography', 'phone_number', 'email'];
  const data = {};
  allowed.forEach((key) => {
    if (input[key] !== undefined) {
      data[key] = input[key];
    }
  });
  if (input.fullName !== undefined && data.full_name === undefined) {
    data.full_name = input.fullName;
  }
  if (input.externalUrl !== undefined && data.external_url === undefined) {
    data.external_url = input.externalUrl;
  }
  if (input.phoneNumber !== undefined && data.phone_number === undefined) {
    data.phone_number = input.phoneNumber;
  }
  if (!data.email || !data.phone_number) {
    const current = await getAccountInfo(client);
    const fallback = {
      external_url: current.externalUrl,
      username: current.username,
      full_name: current.fullName,
      biography: current.biography,
      phone_number: current.phoneNumber,
      email: current.email,
    };
    Object.keys(fallback).forEach((key) => {
      if (data[key] === undefined && fallback[key] !== null) {
        data[key] = fallback[key];
      }
    });
  }
  const fullName = data.full_name;
  if (fullName !== undefined) {
    delete data.full_name;
    if (fullName) {
      data.first_name = fullName;
    }
  }
  const res = await guardOf(client).schedule(() => client.api.request({
    endpoint: 'accounts/edit_profile/',
    method: 'POST',
    data: { ...actionData(client), ...data },
  }));
  if (input.biography || data.biography) {
    await setBiography(client, input.biography || data.biography);
  }
  return normalizeAccount(((res || {}).user) || {});
}

async function setBiography(client, text) {
  const res = await client.api.request({
    endpoint: 'accounts/set_biography/',
    method: 'POST',
    data: { logged_in_uids: JSON.stringify([String(client.userId)]), raw_text: String(text || '') },
  });
  return (res || {}).status === 'ok';
}

async function setExternalUrl(client, url) {
  const res = await client.api.request({
    endpoint: 'accounts/update_bio_links/',
    method: 'POST',
    data: {
      ...actionData(client),
      updated_links: JSON.stringify([{ url: String(url || ''), title: '', link_type: 'external' }]),
    },
  });
  return (res || {}).status === 'ok';
}

async function removeBioLinks(client, linkIds) {
  const ids = (linkIds || []).map((id) => Number(id)).filter((n) => !Number.isNaN(n));
  const res = await client.api.request({
    endpoint: 'accounts/remove_bio_links/',
    method: 'POST',
    data: { ...actionData(client), link_ids: JSON.stringify(ids) },
  });
  return (res || {}).status === 'ok';
}

async function getBioLinks(client) {
  const info = await getAccountInfo(client);
  return info.bioLinks || [];
}

async function changeProfilePicture(client, options) {
  const opts = options || {};
  if (!opts.uploadId) {
    throw new Error('uploadId required (upload via media first)');
  }
  const res = await client.api.request({
    endpoint: 'accounts/change_profile_picture/',
    method: 'POST',
    data: { use_fbuploader: 'true', upload_id: String(opts.uploadId) },
  });
  const user = (res || {}).user || {};
  return { userId: user.pk ? String(user.pk) : null, username: user.username || null };
}

async function setPrivate(client) {
  const res = await guardOf(client).schedule(() => client.api.request({
    endpoint: 'accounts/set_private/',
    method: 'POST',
    data: actionData(client),
  }));
  return (res || {}).status === 'ok';
}

async function setPublic(client) {
  const res = await guardOf(client).schedule(() => client.api.request({
    endpoint: 'accounts/set_public/',
    method: 'POST',
    data: actionData(client),
  }));
  return (res || {}).status === 'ok';
}

function convertPayload(client, type, categoryId, opts) {
  const o = opts || {};
  return {
    entry_point: o.entryPoint || 'setting',
    creator_destination_migration: o.creatorDestinationMigration ? 'true' : 'false',
    to_account_type: String(type),
    category_id: String(categoryId || '2347428775505624'),
    should_show_category: o.shouldShowCategory === false ? '0' : '1',
    should_show_public_contacts: o.shouldShowPublicContacts ? '1' : '0',
    ...(o.extra || {}),
  };
}

async function convertToProfessional(client, type, categoryId, opts) {
  if (type !== 2 && type !== 3) {
    throw new Error('type must be 2 (business) or 3 (creator)');
  }
  await guardOf(client).schedule(() => client.api.request({
    endpoint: 'business/account/convert_account/',
    method: 'POST',
    data: { ...actionData(client), ...convertPayload(client, type, categoryId, opts) },
  }));
  return getAccountInfo(client);
}

async function convertToBusiness(client, categoryId, opts) {
  return convertToProfessional(client, 2, categoryId, opts);
}

async function convertToCreator(client, categoryId, opts) {
  return convertToProfessional(client, 3, categoryId, opts);
}

async function getNewsInbox(client, markAsSeen) {
  const res = await client.api.request({
    endpoint: 'news/inbox/',
    method: 'GET',
    params: { mark_as_seen: Boolean(markAsSeen) },
  });
  return res || {};
}

async function setAiInfoLabel(client, enabled) {
  const { privateGraphqlQuery } = require('../core/http');
  await privateGraphqlQuery(client, {
    friendlyName: 'AIGMUpdateAccountLabelVisibilityMutation',
    clientDocId: '85502578717429613610069073956',
    variables: { is_enabled: Boolean(enabled) },
    extraHeaders: { 'X-Client-Doc-Id': '85502578717429613610069073956' },
  });
  return getAccountInfo(client);
}

module.exports = {
  normalizeAccount,
  getAccountInfo,
  editAccount,
  setBiography,
  setExternalUrl,
  removeBioLinks,
  getBioLinks,
  changeProfilePicture,
  setPrivate,
  setPublic,
  convertToProfessional,
  convertToBusiness,
  convertToCreator,
  getNewsInbox,
  setAiInfoLabel,
};