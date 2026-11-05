/**
 * @alaminnna/ica-unofficial — user/lookup
 *
 * RESPONSIBILITY: advanced lookups: streamed profile envelopes, web profile
 * info, doc_id GraphQL short/info lookups + shared public-GraphQL helper.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./social (normalizeShort), ./info (normalizeUser, normalizeUsername),
 *                 ../upload/rupload (graphqlWww), ../core/http (privateGraphqlQuery),
 *                 client.api, client.http.axios (shared jar), ../exceptions
 * MUST NOT:       never cache here (cache.js owns that)
 *
 * DEBUG: when short/info lookups 404 on valid users, start looking here —
 * doc_id variables and user-block extraction
 */

'use strict';

const { normalizeShort } = require('./social');
const { normalizeUser, normalizeUsername } = require('./info');
const { UserNotFound } = require('../exceptions');
const { privateGraphqlQuery } = require('../core/http');

const WEB_PROFILE_DOC_ID = '28036671149327607';
const USER_INFO_V2_DOC_ID = '28036671149327607';
const USER_INFO_BY_USERNAME_V2_DOC_ID = '26347858941511777';
const GRAPHQL_QUERY_URL = 'https://www.instagram.com/graphql/query/';

function relayVariables(extra) {
  return {
    enable_integrity_filters: true,
    render_surface: 'PROFILE',
    __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
    __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
    __relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider: false,
    __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: false,
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
    ...(extra || {}),
  };
}

async function publicGraphql(client, options) {
  const opts = options || {};
  const params = { variables: JSON.stringify(opts.variables || {}) };
  if (opts.queryHash) {
    params.query_hash = opts.queryHash;
  }
  if (opts.docId) {
    params.doc_id = opts.docId;
  }
  const headers = {};
  if (opts.referer) {
    headers.Referer = opts.referer;
  }
  const res = await client.http.axios.get(GRAPHQL_QUERY_URL, { params, headers, timeout: 30000 });
  return res && res.data;
}

// BLOCK E — streamed profile envelopes (app-side surface)

async function getUserStreamByUsername(client, username) {
  const clean = normalizeUsername(username);
  const res = await client.api.request({
    endpoint: 'users/' + encodeURIComponent(clean) + '/usernameinfo_stream/',
    method: 'POST',
    data: { is_prefetch: false, entry_point: 'profile', from_module: 'feed_timeline' },
  });
  if (!res) {
    throw new UserNotFound('@alaminnna/ica-unofficial: stream not found for username ' + clean, {});
  }
  return res;
}

async function getUserStreamById(client, userId) {
  const id = String(userId);
  const res = await client.api.request({
    endpoint: 'users/' + id + '/info_stream/',
    method: 'POST',
    data: { is_prefetch: false, entry_point: 'profile', from_module: 'feed_timeline' },
  });
  if (!res) {
    throw new UserNotFound('@alaminnna/ica-unofficial: stream not found for user ' + id, {});
  }
  return res;
}

function flattenStream(envelope, fallback) {
  const rows = ((envelope || {}).stream_rows) || [];
  const merged = {};
  rows.forEach((row) => {
    const user = (row || {}).user;
    if (user && typeof user === 'object') {
      Object.keys(user).forEach((key) => {
        merged[key] = user[key];
      });
    }
  });
  if (merged.pk === undefined && merged.pk_id !== undefined) {
    merged.pk = merged.pk_id;
  }
  if (fallback && merged.pk === undefined) {
    merged.pk = fallback;
  }
  return merged;
}

async function getUserStreamByIdFlat(client, userId) {
  const envelope = await getUserStreamById(client, userId);
  return flattenStream(envelope, String(userId));
}

async function getUserStreamByUsernameFlat(client, username) {
  const envelope = await getUserStreamByUsername(client, username);
  return flattenStream(envelope, null);
}

// BLOCK E — web profile info via private host (logged-in session)

async function getWebProfileInfo(client, username) {
  const clean = normalizeUsername(username);
  const res = await client.api.request({
    endpoint: 'users/web_profile_info/',
    method: 'GET',
    params: { username: clean },
  });
  const data = (res || {}).data;
  if (!data || Object.keys(data).length === 0) {
    throw new UserNotFound('@alaminnna/ica-unofficial: web profile not found: ' + clean, {});
  }
  return data;
}

// BLOCK E — doc_id GraphQL lookups

async function getUserShortGql(client, userId) {
  const id = String(userId);
  const data = await publicGraphql(client, {
    docId: WEB_PROFILE_DOC_ID,
    variables: relayVariables({ id }),
    referer: 'https://www.instagram.com/' + id + '/',
  });
  if (!data || !data.user) {
    throw new UserNotFound('@alaminnna/ica-unofficial: short gql user not found: ' + id, {});
  }
  return normalizeShort(data.user);
}

async function getUsernameFromUserIdGql(client, userId) {
  const short = await getUserShortGql(client, userId);
  return short.username;
}

function normalizePolarisProfile(userData) {
  const normalized = { ...(userData || {}) };
  if (normalized.pk === undefined && normalized.id !== undefined) {
    normalized.pk = normalized.id;
  }
  if (normalized.is_business === undefined && normalized.is_business_account !== undefined) {
    normalized.is_business = normalized.is_business_account;
  }
  if (normalized.category === undefined && normalized.category_name !== undefined) {
    normalized.category = normalized.category_name;
  }
  const friendship = normalized.friendship_status || {};
  if (normalized.followed_by_viewer === undefined) {
    normalized.followed_by_viewer = friendship.following || false;
  }
  if (normalized.follows_viewer === undefined) {
    normalized.follows_viewer = friendship.followed_by || false;
  }
  return normalized;
}

async function getUserInfoV2Gql(client, userId) {
  const id = String(userId);
  const data = await publicGraphql(client, {
    docId: USER_INFO_V2_DOC_ID,
    variables: relayVariables({ id }),
  });
  const userData = (data || {}).user;
  if (!userData) {
    throw new UserNotFound('@alaminnna/ica-unofficial: info v2 user not found: ' + id, {});
  }
  return normalizeUser(normalizePolarisProfile(userData));
}

async function getUserInfoByUsernameV2Gql(client, username) {
  const clean = normalizeUsername(username).toLowerCase();
  const data = await publicGraphql(client, {
    docId: USER_INFO_BY_USERNAME_V2_DOC_ID,
    variables: { hasQuery: true, query: clean },
  });
  const users = ((((data || {}).xdt_api__v1__fbsearch__non_profiled_serp) || {}).users) || [];
  const match = users.find((u) => String((u && u.username) || '').toLowerCase() === clean);
  if (!match) {
    throw new UserNotFound('@alaminnna/ica-unofficial: info v2 username not found: ' + clean, {});
  }
  return getUserInfoV2Gql(client, match.pk || match.id);
}

// Private mobile GraphQL (FollowersList/FollowingList/Clips/Inbox surfaces)

const FOLLOWERS_LIST_DOC_ID = '284797047911918316998205836755';
const FOLLOWING_LIST_DOC_ID = '16104639286363954576550227636';
const CLIPS_PROFILE_DOC_ID = '209049231614685382737238866578';
const INBOX_TRAY_DOC_ID = '2035639076042015234490020607';

async function getFollowersPrivateGqlChunk(client, options) {
  const opts = options || {};
  const variables = {
    user_id: String(opts.userId),
    skip_suggested_users: true,
    skip_more_groups_available: true,
    skip_friendship_followers_fields: true,
    request_data: { rank_token: opts.rankToken || client.rankToken, enableGroups: true },
    skip_page_size: true,
    skip_pending_admins: true,
    skip_has_more: true,
    search_surface: 'follow_list_page',
    query: '',
    skip_big_list: true,
    include_unseen_count: true,
  };
  if (opts.maxId) {
    variables.max_id = opts.maxId;
  }
  if (opts.order) {
    variables.order = opts.order;
  }
  const root = await privateGraphqlQuery(client, {
    friendlyName: 'FollowersList',
    rootField: 'xdt_api__v1__friendships__followers',
    clientDocId: FOLLOWERS_LIST_DOC_ID,
    variables,
    extraHeaders: { 'X-FB-RMD': 'state=URL_ELIGIBLE' },
  });
  const users = ((root || {}).users || []).map(normalizeShort);
  const list = opts.maxAmount ? users.slice(0, opts.maxAmount) : users;
  return { users: list, nextCursor: ((root || {}).next_max_id) || null };
}

async function getFollowersPrivateGql(client, options) {
  const opts = options || {};
  const amount = opts.amount || 0;
  const out = [];
  let maxId = null;
  for (;;) {
    const chunk = await getFollowersPrivateGqlChunk(client, { ...opts, maxAmount: amount ? amount - out.length : 0, maxId });
    out.push(...chunk.users);
    if ((amount && out.length >= amount) || !chunk.nextCursor) {
      break;
    }
    maxId = chunk.nextCursor;
  }
  return amount ? out.slice(0, amount) : out;
}

async function getFollowingPrivateGqlChunk(client, options) {
  const opts = options || {};
  const variables = {
    user_id: String(opts.userId),
    skip_use_clickable_see_more: true,
    skip_preview_hashtags: true,
    skip_should_limit_list_of_followers: true,
    skip_pending_admins: true,
    skip_more_groups_available: true,
    skip_friendship_followers_fields: false,
    request_data: { search_surface: 'follow_list_page', rank_token: opts.rankToken || client.rankToken, includes_hashtags: true },
    skip_page_size: true,
    skip_friend_requests: true,
    skip_big_list: true,
    query: '',
    include_profile_update_info: true,
    skip_suggested_users: true,
    include_unseen_count: true,
    skip_has_more: true,
    enable_groups: true,
    skip_hashtag_count: true,
  };
  if (opts.maxId) {
    variables.max_id = opts.maxId;
  }
  if (opts.order) {
    variables.order = opts.order;
  }
  const root = await privateGraphqlQuery(client, {
    friendlyName: 'FollowingList',
    rootField: 'xdt_api__v1__friendships__following',
    clientDocId: FOLLOWING_LIST_DOC_ID,
    variables,
    extraHeaders: { 'X-FB-RMD': 'state=URL_ELIGIBLE' },
  });
  const users = ((root || {}).users || []).map(normalizeShort);
  const list = opts.maxAmount ? users.slice(0, opts.maxAmount) : users;
  return { users: list, nextCursor: ((root || {}).next_max_id) || null };
}

async function getFollowingPrivateGql(client, options) {
  const opts = options || {};
  const amount = opts.amount || 0;
  const out = [];
  let maxId = null;
  for (;;) {
    const chunk = await getFollowingPrivateGqlChunk(client, { ...opts, maxAmount: amount ? amount - out.length : 0, maxId });
    out.push(...chunk.users);
    if ((amount && out.length >= amount) || !chunk.nextCursor) {
      break;
    }
    maxId = chunk.nextCursor;
  }
  return amount ? out.slice(0, amount) : out;
}

async function getClipsProfileGql(client, userId, options) {
  const opts = options || {};
  const inner = {
    target_user_id: String(userId),
    should_stream_response: false,
    sort_by_views: false,
    max_id: null,
    include_feed_video: true,
    audience: null,
    page_size: 12,
    no_of_medias_in_each_chunk: 6,
  };
  if (opts.pageSize) {
    inner.page_size = opts.pageSize;
  }
  return privateGraphqlQuery(client, {
    friendlyName: 'ClipsProfileQuery',
    rootField: 'xdt_user_clips_graphql',
    clientDocId: CLIPS_PROFILE_DOC_ID,
    variables: {
      use_stream: false,
      use_defer: false,
      enable_video_versions_in_light_media: true,
      exclude_caption_user_field: false,
      enable_thumbnails_in_light_media: false,
      enable_audience_in_light_media: false,
      enable_clips_metadata_in_light_media: false,
      exclude_main_user_field: false,
      enable_likers_in_full_media: false,
      data: inner,
      stream_use_customized_batch: false,
      initial_stream_count: 6,
    },
  });
}

async function getInboxTrayGql(client, userId) {
  return privateGraphqlQuery(client, {
    friendlyName: 'InboxTrayRequestForUserQuery',
    rootField: 'xdt_get_inbox_tray_items',
    clientDocId: INBOX_TRAY_DOC_ID,
    variables: { user_id: String(userId), should_fetch_content_note_stack_video_info: false },
  });
}

async function getFeedUserStreamItem(client, itemId, pullToRefresh) {
  const data = { _uuid: client.uuid };
  if (pullToRefresh) {
    data.is_pull_to_refresh = 'true';
  }
  return client.api.request({
    endpoint: 'feed/user_stream/' + itemId + '/',
    method: 'POST',
    data,
  });
}

module.exports = {
  WEB_PROFILE_DOC_ID,
  USER_INFO_V2_DOC_ID,
  USER_INFO_BY_USERNAME_V2_DOC_ID,
  publicGraphql,
  getUserStreamByUsername,
  getUserStreamById,
  getUserStreamByIdFlat,
  getUserStreamByUsernameFlat,
  flattenStream,
  getWebProfileInfo,
  getUserShortGql,
  getUsernameFromUserIdGql,
  normalizePolarisProfile,
  getUserInfoV2Gql,
  getUserInfoByUsernameV2Gql,
  FOLLOWERS_LIST_DOC_ID,
  FOLLOWING_LIST_DOC_ID,
  CLIPS_PROFILE_DOC_ID,
  INBOX_TRAY_DOC_ID,
  privateGraphqlQuery,
  getFollowersPrivateGqlChunk,
  getFollowersPrivateGql,
  getFollowingPrivateGqlChunk,
  getFollowingPrivateGql,
  getClipsProfileGql,
  getInboxTrayGql,
  getFeedUserStreamItem,
};