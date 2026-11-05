/**
 * @alaminnna/ica-unofficial — user/extras
 *
 * RESPONSIBILITY: profile extras: "about this account" via bloks + guides.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../auth/bloks, client.api, ../exceptions
 * MUST NOT:       never throw raw bloks parse errors — best-effort fields + raw
 *
 * DEBUG: when about returns nulls, start looking here — bloks payload is
 * lispy-string scraping ported 1:1 from extractors._extract_about_lispy
 */

'use strict';

const { UserNotFound } = require('../exceptions');

function parseAbout(res, userId) {
  const out = {
    userId: String(userId),
    country: null,
    username: null,
    date: null,
    isVerified: null,
    formerUsernames: null,
    raw: res || {},
  };
  try {
    const data = res || {};
    const layout = data.layout || {};
    const payload = layout.bloks_payload || {};
    const first = (((payload.data || [])[0] || {}).data) || null;
    if (first && typeof first === 'object') {
      if (first.initial_lispy) {
        return parseAboutLispy(first.initial_lispy, out);
      }
      if (first.initial) {
        out.country = String(first.initial).split('"')[1] || null;
      }
    }
    const dumped = JSON.stringify(data);
    out.isVerified = dumped.indexOf('"Verified"') !== -1;
    const parts = dumped.split('"):');
    let dateFound = false;
    for (let i = 0; i < parts.length; i += 1) {
      const v = parts[i];
      if (v.indexOf('"bold"}') !== -1) {
        out.username = v.trim().split(',')[0].slice(1, -1) || null;
      }
      if (dateFound) {
        out.date = v.trim().split(',')[0].slice(1, -1) || null;
        dateFound = false;
      }
      if (v.indexOf('Former usernames') !== -1 && parts[i + 2]) {
        out.formerUsernames = parts[i + 2].trim().split(',')[0].slice(1, -1) || null;
      }
      if (v.indexOf('"Date joined"') !== -1) {
        dateFound = true;
      }
    }
  } catch (ignored) {
    // best-effort: nulls + raw
  }
  return out;
}

function parseAboutLispy(lispy, out) {
  const result = out;
  try {
    result.country = String(lispy).split('"')[1] || null;
  } catch (ignored) {
    // keep null
  }
  return result;
}

async function getUserAbout(client, userId) {
  const id = String(userId);
  const data = {
    referer_type: 'ProfileMore',
    target_user_id: id,
    bk_client_context: JSON.stringify({ bloks_version: client.bloksVersioningId, styles_id: 'instagram' }),
    bloks_versioning_id: client.bloksVersioningId,
  };
  let res;
  try {
    res = await client.bloksAction('com.instagram.interactions.about_this_account', data);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if ((err && (err.name === 'UserNotFound' || err.name === 'ClientNotFoundError'))
      || msg.indexOf('User not found') !== -1 || msg.indexOf('404') !== -1) {
      throw new UserNotFound('@alaminnna/ica-unofficial: about not found for user ' + id, {});
    }
    throw err;
  }
  return parseAbout(res, id);
}

function normalizeGuide(raw) {
  const data = raw || {};
  const cover = data.cover_media || {};
  const candidates = ((cover.image_versions2 || {}).candidates) || [];
  return {
    id: data.guide_id || data.id || null,
    title: data.title || null,
    coverUrl: (candidates[0] && candidates[0].url) || cover.thumbnail_url || null,
    raw: data,
  };
}

async function getUserGuides(client, userId) {
  const res = await client.api.request({ endpoint: 'guides/user/' + Number(userId) + '/', method: 'GET' });
  return ((res || {}).guides || []).map(normalizeGuide);
}

async function getCreatorInfo(client, userId, entryPoint) {
  const id = String(userId);
  const res = await client.api.request({
    endpoint: 'creator/creator_info/',
    method: 'GET',
    params: { entry_point: entryPoint || 'direct_thread', surface_type: 'android', user_id: id },
  });
  if (((res || {}).status || '') !== 'ok') {
    throw new Error('@alaminnna/ica-unofficial: creator info fetch failed for ' + id);
  }
  const user = { ...((res || {}).user || {}) };
  const creatorInfo = user.creator_info || {};
  delete user.creator_info;
  const { normalizeShort } = require('./social');
  return { user: normalizeShort(user), creatorInfo };
}

module.exports = { parseAbout, normalizeGuide, getUserAbout, getUserGuides, getCreatorInfo };