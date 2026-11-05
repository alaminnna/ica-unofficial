/**
 * @alaminnna/ica-unofficial — user/info
 * 
 * RESPONSIBILITY: user identity: info by id/username plus id<->username resolution.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api
 * MUST NOT:       never cache here (cache.js owns that)
 * 
 * DEBUG: when uinfo shows nulls, start looking here — normalizeUser field mapping
 */

'use strict';

function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@+/, '');
}

function normalizeUser(raw) {
  const data = raw || {};
  const pick = (value) => (value === undefined ? null : value);
  return {
    userId: data.pk === undefined || data.pk === null ? null : String(data.pk),
    username: pick(data.username),
    fullName: pick(data.full_name),
    profilePicUrl: pick(data.profile_pic_url),
    isPrivate: pick(data.is_private),
    isVerified: pick(data.is_verified),
    followerCount: pick(data.follower_count),
    followingCount: pick(data.following_count),
    mediaCount: pick(data.media_count),
    biography: pick(data.biography),
    mutualFollowersCount: pick(data.mutual_followers_count),
    profileContext: pick(data.profile_context),
    isBusiness: pick(data.is_business),
    category: pick(data.category),
    externalUrl: pick(data.external_url),
  };
}

async function getUserInfo(client, userId) {
  const res = await client.api.request({ endpoint: 'users/' + userId + '/info/', method: 'GET' });
  return normalizeUser((res || {}).user || {});
}

async function getUserInfoByUsername(client, username) {
  const clean = normalizeUsername(username);
  const res = await client.api.request({ endpoint: 'users/' + encodeURIComponent(clean) + '/usernameinfo/', method: 'GET' });
  return normalizeUser((res || {}).user || {});
}

async function getUsernameFromUserId(client, userId) {
  const info = await getUserInfo(client, userId);
  return info.username;
}

async function getUserIdFromUsername(client, username) {
  const { getUserInfoByUsername } = module.exports;
  try {
    const info = await getUserInfoByUsername(client, username);
    if (info.userId) {
      return info.userId;
    }
  } catch (err) {
    // fall through to doc_id search
  }
  const { getUserInfoByUsernameV2Gql } = require('./lookup');
  const info = await getUserInfoByUsernameV2Gql(client, username);
  return info.userId;
}

function rememberUsername(client, userId, username) {
  if (client.identityCache && username) {
    client.identityCache.set(String(userId), username);
  }
  return username;
}

async function usernameFromUserId(client, userId) {
  const id = String(userId);
  if (client.identityCache) {
    const cached = client.identityCache.get(id);
    if (cached) {
      return cached;
    }
  }
  const { getUserInfo } = module.exports;
  try {
    const info = await getUserInfo(client, id);
    if (info.username) {
      return rememberUsername(client, id, info.username);
    }
  } catch (err) {
    // fall through to GraphQL fallback chain
  }
  const { getUsernameFromUserIdGql } = require('./lookup');
  const username = await getUsernameFromUserIdGql(client, id);
  return rememberUsername(client, id, username);
}

module.exports = { normalizeUsername, normalizeUser, getUserInfo, getUserInfoByUsername, getUserIdFromUsername, getUsernameFromUserId, usernameFromUserId };