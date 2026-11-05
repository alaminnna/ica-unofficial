/**
 * @alaminnna/ica-unofficial — discover/hashtag
 *
 * RESPONSIBILITY: hashtag reads + follow: info, medias by tab (top/recent/
 * clips) with opaque cursors, follow/unfollow, followed list.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../media/info (normalizeMediaInfo), ../user/lookup
 *                 (privateGraphqlQuery), client.api
 * MUST NOT:       never follow-up fetch here (return raw + normalized lists)
 *
 * DEBUG: when medias come back empty, start looking here — tab_key values
 *   ("top"|"recent"|"clips") and the base64 [page_id, media_ids] cursor
 */

'use strict';

const { normalizeMediaInfo } = require('../media/info');

const HASHTAG_TABS = ['top', 'recent', 'clips'];

function normalizeHashtagName(name) {
  return String(name || '').trim().replace(/^#+/, '').toLowerCase();
}

function checkTab(tab) {
  const value = tab || 'top';
  if (HASHTAG_TABS.indexOf(value) === -1) {
    throw new Error('@alaminnna/ica-unofficial: invalid tab_key ' + value + ' (top|recent|clips)');
  }
  return value;
}

function normalizeHashtag(raw) {
  const data = raw || {};
  return {
    id: data.id === undefined || data.id === null ? null : String(data.id),
    name: data.name || null,
    mediaCount: data.media_count === undefined ? null : data.media_count,
    profilePicUrl: data.profile_pic_url || null,
    raw: data,
  };
}

function encodeCursor(pageId, mediaIds) {
  return Buffer.from(JSON.stringify([pageId, mediaIds]), 'utf8').toString('base64');
}

function decodeCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2) {
      return parsed;
    }
  } catch (ignored) {
    // fall through
  }
  throw new Error('@alaminnna/ica-unofficial: invalid hashtag cursor');
}

async function getHashtagInfo(client, name) {
  const clean = normalizeHashtagName(name);
  const res = await client.api.request({ endpoint: 'tags/' + encodeURIComponent(clean) + '/info/', method: 'GET' });
  return normalizeHashtag(res || {});
}

async function getHashtagMediasChunk(client, options) {
  const opts = options || {};
  const name = normalizeHashtagName(opts.name);
  const tab = checkTab(opts.tab);
  const recency = { top: 'default', recent: 'top_recent_posts' };
  const data = {
    tab,
    media_recency_filter: recency[tab] || tab,
    _uuid: client.uuid,
    include_persistent: 'false',
    rank_token: client.rankToken,
  };
  if (opts.maxId) {
    const [pageId, mediaIds] = decodeCursor(opts.maxId);
    data.max_id = pageId;
    data.next_media_ids = JSON.stringify(mediaIds);
  }
  const res = await client.api.request({
    endpoint: 'tags/' + encodeURIComponent(name) + '/sections/',
    method: 'POST',
    data,
  });
  const medias = [];
  ((res || {}).sections || []).forEach((section) => {
    const nodes = [];
    const collect = (value) => {
      if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value && typeof value === 'object') {
        if (value.media) {
          nodes.push(value.media);
        }
        Object.keys(value).forEach((k) => { if (k !== 'media') collect(value[k]); });
      }
    };
    collect(section);
    nodes.forEach((node) => {
      if (opts.maxAmount && medias.length >= opts.maxAmount) {
        return;
      }
      try {
        medias.push(normalizeMediaInfo(node));
      } catch (ignored) {
        // skip malformed nodes
      }
    });
  });
  let nextCursor = null;
  if (res.next_max_id) {
    nextCursor = encodeCursor(res.next_max_id, res.next_media_ids);
  }
  if (!((res || {}).more_available)) {
    nextCursor = null;
  }
  const list = opts.maxAmount ? medias.slice(0, opts.maxAmount) : medias;
  return { medias: list, nextCursor };
}

async function getHashtagMedias(client, options) {
  const opts = options || {};
  const amount = opts.amount === undefined ? 27 : opts.amount;
  const out = [];
  let maxId = opts.maxId || null;
  for (;;) {
    const chunk = await getHashtagMediasChunk(client, { name: opts.name, tab: opts.tab, maxAmount: amount - out.length, maxId });
    out.push(...chunk.medias);
    if ((amount && out.length >= amount) || !chunk.nextCursor) {
      break;
    }
    maxId = chunk.nextCursor;
  }
  return amount ? out.slice(0, amount) : out;
}

async function getHashtagMediasTop(client, name, amount) {
  const { getHashtagMedias: list } = module.exports;
  return list(client, { name, tab: 'top', amount: amount === undefined ? 9 : amount });
}

async function getHashtagMediasRecent(client, name, amount) {
  const { getHashtagMedias: list } = module.exports;
  return list(client, { name, tab: 'recent', amount: amount === undefined ? 27 : amount });
}

async function getHashtagMediasReels(client, name, amount) {
  const { getHashtagMedias: list } = module.exports;
  return list(client, { name, tab: 'clips', amount: amount === undefined ? 27 : amount });
}

async function followHashtag(client, name, unfollow) {
  const clean = normalizeHashtagName(name);
  const action = unfollow ? 'unfollow' : 'follow';
  const res = await client.api.request({
    endpoint: 'web/tags/' + action + '/' + encodeURIComponent(clean) + '/',
    method: 'POST',
    domain: 'www.instagram.com',
    data: { user_id: String(client.userId), _uuid: client.uuid },
  });
  return ((res || {}).status || '') === 'ok';
}

async function unfollowHashtag(client, name) {
  return followHashtag(client, name, true);
}

async function getFollowedHashtags(client, amount) {
  const { privateGraphqlQuery } = require('../user/lookup');
  const root = await privateGraphqlQuery(client, {
    friendlyName: 'FollowingList',
    rootField: 'xdt_api__v1__friendships__following',
    clientDocId: '16104639286363954576550227636',
    priority: 'u=3, i',
    variables: {
      user_id: String(client.userId),
      skip_use_clickable_see_more: true,
      skip_preview_hashtags: false,
      skip_should_limit_list_of_followers: true,
      skip_pending_admins: true,
      skip_more_groups_available: true,
      skip_friendship_followers_fields: false,
      request_data: { search_surface: 'follow_list_page', rank_token: client.rankToken, includes_hashtags: true },
      skip_page_size: true,
      skip_friend_requests: true,
      skip_big_list: true,
      query: '',
      include_profile_update_info: true,
      skip_suggested_users: true,
      include_unseen_count: true,
      skip_has_more: true,
      enable_groups: true,
      skip_hashtag_count: false,
    },
    extraHeaders: { 'X-FB-RMD': 'state=URL_ELIGIBLE' },
  });
  const out = [];
  ((root || {}).preview_hashtags || []).forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }
    const node = { ...(item.hashtag || item.node || item) };
    node.id = node.id || node.pk || null;
    node.media_count = node.media_count || node.post_count || node.postCount || null;
    node.profile_pic_url = node.profile_pic_url || node.profilePictureUrl || null;
    if (!node.id || !node.name) {
      return;
    }
    out.push(normalizeHashtag(node));
  });
  return amount ? out.slice(0, amount) : out;
}

module.exports = {
  HASHTAG_TABS,
  normalizeHashtagName,
  normalizeHashtag,
  getHashtagInfo,
  getHashtagMediasChunk,
  getHashtagMedias,
  getHashtagMediasTop,
  getHashtagMediasRecent,
  getHashtagMediasReels,
  followHashtag,
  unfollowHashtag,
  getFollowedHashtags,
};