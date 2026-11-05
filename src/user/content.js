/**
 * @alaminnna/ica-unofficial — user/content
 * 
 * RESPONSIBILITY: user content lists: medias, tags, stories passthrough.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../media/story, client.api
 * MUST NOT:       never send from here
 * 
 * DEBUG: when medias/tags come back empty, start looking here — feed endpoint and paging
 */

'use strict';

const { getUserStories } = require('../media/story');

function normalizeContentMedia(raw, fallbackUserId) {
  const data = raw || {};
  const user = data.user || {};
  const pk = data.pk ? String(data.pk) : null;
  return {
    mediaId: data.id ? String(data.id) : (pk && fallbackUserId ? pk + '_' + fallbackUserId : pk),
    pk,
    mediaType: data.media_type === undefined ? null : data.media_type,
    caption: ((data.caption || {}).text) || null,
    thumbnailUrl: null,
    videoUrl: null,
    takenAt: data.taken_at === undefined ? null : data.taken_at,
    userId: user.pk ? String(user.pk) : (fallbackUserId ? String(fallbackUserId) : null),
    username: user.username || null,
  };
}

async function pagedFeed(client, endpoint, userId, amount, params) {
  const out = [];
  let maxId = '';
  for (;;) {
    const page = { ...(params || {}) };
    if (maxId) {
      page.max_id = maxId;
    }
    const res = await client.api.request({ endpoint: endpoint + userId + '/', method: 'GET', params: page });
    ((res || {}).items || []).forEach((raw) => {
      out.push(normalizeContentMedia(raw, userId));
    });
    maxId = ((res || {}).next_max_id) || '';
    if (!maxId || (amount && out.length >= amount)) {
      break;
    }
  }
  return amount ? out.slice(0, amount) : out;
}

async function getUserMedias(client, options) {
  const opts = options || {};
  const userId = String(opts.userId);
  return pagedFeed(client, 'feed/user/', userId, opts.amount || 0, {
    count: opts.amount || 33,
    rank_token: client.rankToken,
    ranked_content: 'true',
  });
}

async function getUserTags(client, options) {
  const opts = options || {};
  return pagedFeed(client, 'usertags/', String(opts.userId), opts.amount || 0, {});
}

async function getUserMediasPaginated(client, options) {
  const opts = options || {};
  const userId = String(opts.userId);
  const params = { count: opts.amount || 33, rank_token: client.rankToken, ranked_content: 'true' };
  if (opts.endCursor) {
    params.max_id = opts.endCursor;
  }
  const res = await client.api.request({ endpoint: 'feed/user/' + userId + '/', method: 'GET', params });
  const medias = ((res || {}).items || []).map((raw) => normalizeContentMedia(raw, userId));
  return { medias, endCursor: (res || {}).next_max_id || '' };
}

async function getUserTagsPaginated(client, options) {
  const opts = options || {};
  const userId = String(opts.userId);
  const params = {};
  if (opts.endCursor) {
    params.max_id = opts.endCursor;
  }
  const res = await client.api.request({ endpoint: 'usertags/' + userId + '/', method: 'GET', params });
  const medias = ((res || {}).items || []).map((raw) => normalizeContentMedia(raw, userId));
  return { medias, endCursor: (res || {}).next_max_id || '' };
}

async function* iterUserMedias(client, options) {
  const opts = options || {};
  let cursor = opts.endCursor || '';
  for (;;) {
    const page = await getUserMediasPaginated(client, { userId: opts.userId, amount: opts.pageSize || 33, endCursor: cursor });
    for (const media of page.medias) {
      yield media;
    }
    if (!page.endCursor) {
      break;
    }
    cursor = page.endCursor;
  }
}

module.exports = { normalizeContentMedia, getUserMedias, getUserTags, getUserStories, getUserMediasPaginated, getUserTagsPaginated, iterUserMedias };