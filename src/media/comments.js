/**
 * @alaminnna/ica-unofficial — media/comments
 *
 * RESPONSIBILITY: comment writes + reads: post, like/unlike, pin/unpin,
 * bulk delete, offensive check, paged list, likers (public GQL).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./engagement (mediaPkFromInput), node:crypto, client.api,
 *                 client.http.axios (shared jar), client.rateGuard
 * MUST NOT:       never burst writes — writes go through rateGuard.schedule
 *
 * DEBUG: when post returns ok but comment never appears, start looking
 * here — idempotence token + breadcrumb payload
 */

'use strict';

const crypto = require('node:crypto');
const { mediaPkFromInput } = require('./engagement');

const COMMENT_LIKERS_QUERY_HASH = '5f0b1f6281e72053cbc07909c8d154ae';
const COMMENT_LIKERS_PAGE_SIZE = 50;
const GRAPHQL_QUERY_URL = 'https://www.instagram.com/graphql/query/';

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function genUserBreadcrumb(size) {
  const key = 'iN4$aGr0m';
  const dt = Date.now();
  const elapsed = randomInt(500, 1500) + size * randomInt(500, 1500);
  const count = Math.max(1, size / randomInt(3, 5));
  const data = size + ' ' + elapsed + ' ' + count + ' ' + dt;
  const mac = crypto.createHmac('sha256', key).update(data, 'ascii').digest();
  return Buffer.from(mac).toString('base64') + '\n' + Buffer.from(data, 'ascii').toString('base64') + '\n';
}

function uuid4() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function normalizeComment(raw, mediaId) {
  const data = raw || {};
  const user = data.user || {};
  return {
    id: data.pk === undefined || data.pk === null ? null : String(data.pk),
    mediaId: mediaId !== undefined ? String(mediaId) : (data.media_id === undefined ? null : String(data.media_id)),
    userId: user.pk === undefined || user.pk === null ? null : String(user.pk),
    username: user.username || null,
    text: data.text || null,
    likeCount: data.comment_like_count === undefined ? null : data.comment_like_count,
    createdAt: data.created_at_utc === undefined ? null : data.created_at_utc,
    raw: data,
  };
}

async function getCommentsChunk(client, options) {
  const opts = options || {};
  const mediaId = mediaPkFromInput(client, opts.mediaId);
  const maxAmount = opts.maxAmount || 0;
  const comments = [];
  let minId = opts.minId || null;
  let result = null;
  for (;;) {
    const params = minId ? { min_id: minId } : null;
    result = await client.api.request({ endpoint: 'media/' + mediaId + '/comments/', method: 'GET', params });
    ((result || {}).comments || []).forEach((raw) => comments.push(normalizeComment(raw, mediaId)));
    if (!((result || {}).has_more_headload_comments) || !((result || {}).next_min_id)) {
      break;
    }
    if (!(result.next_min_id || result.comments)) {
      break;
    }
    minId = result.next_min_id;
    if (maxAmount && comments.length >= maxAmount) {
      break;
    }
  }
  const list = maxAmount ? comments.slice(0, maxAmount) : comments;
  return { comments: list, nextCursor: ((result || {}).next_min_id) || null };
}

async function getComments(client, options) {
  const opts = options || {};
  const chunk = await getCommentsChunk(client, { mediaId: opts.mediaId, maxAmount: opts.amount || 20 });
  return chunk.comments;
}

async function postComment(client, options) {
  const opts = options || {};
  const text = String(opts.text || '');
  if (!text) {
    throw new Error('@alaminnna/ica-unofficial: postComment needs { text }');
  }
  const mediaId = mediaPkFromInput(client, opts.mediaId);
  const token = uuid4();
  const data = {
    delivery_class: 'organic',
    feed_position: String(randomInt(0, 6)),
    container_module: 'feed_timeline',
    media_id: mediaId,
    _uid: String(client.userId),
    tap_source: 'button',
    is_2m_enabled: 'false',
    is_carousel_bumped_post: 'false',
    is_from_swipe: 'false',
    floating_context_items: '[]',
    media_pct_watched: '0',
    user_breadcrumb: genUserBreadcrumb(text.length),
    idempotence_token: token,
    comment_creation_key: token,
    include_e2ee_mentioned_user_list: 'true',
    include_media_code: 'true',
    comment_text: text,
    _uuid: client.uuid,
  };
  if (opts.repliedToCommentId) {
    data.replied_to_comment_id = Number(opts.repliedToCommentId);
  }
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'media/' + mediaId + '/comment/',
    method: 'POST',
    data,
  }));
  return normalizeComment((res || {}).comment || {}, mediaId);
}

async function checkOffensiveComment(client, mediaId, text) {
  const id = mediaPkFromInput(client, mediaId);
  const res = await client.api.request({
    endpoint: 'media/comment/check_offensive_comment/',
    method: 'POST',
    data: { media_id: id, comment_text: String(text || ''), _uuid: client.uuid },
  });
  return (res || {}).is_offensive === true;
}

async function checkOffensiveCommentRaw(client, mediaId, text) {
  const id = mediaPkFromInput(client, mediaId);
  return client.api.request({
    endpoint: 'media/comment/check_offensive_comment/',
    method: 'POST',
    data: { comment_text: String(text || ''), media_id: id, _uuid: client.uuid },
  });
}

async function likeComment(client, commentId, revert) {
  const id = Number(commentId);
  const name = revert ? 'unlike' : 'like';
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'media/' + id + '/comment_' + name + '/',
    method: 'POST',
    data: {
      is_carousel_bumped_post: 'false',
      container_module: 'feed_contextual_self_profile',
      feed_position: String(randomInt(0, 6)),
      _uuid: client.uuid,
    },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function unlikeComment(client, commentId) {
  return likeComment(client, commentId, true);
}

async function pinComment(client, mediaId, commentId, revert) {
  const mid = mediaPkFromInput(client, mediaId);
  const name = revert ? 'unpin' : 'pin';
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'media/' + mid + '/' + name + '_comment/' + commentId + '/',
    method: 'POST',
    data: { _uid: String(client.userId), _uuid: client.uuid },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function unpinComment(client, mediaId, commentId) {
  return pinComment(client, mediaId, commentId, true);
}

async function bulkDeleteComments(client, mediaId, commentIds) {
  const mid = mediaPkFromInput(client, mediaId);
  const ids = (commentIds || []).map(String).join(',');
  if (!ids) {
    throw new Error('@alaminnna/ica-unofficial: bulkDeleteComments needs non-empty commentIds');
  }
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'media/' + mid + '/comment/bulk_delete/',
    method: 'POST',
    data: { comment_ids_to_delete: ids, container_module: 'self_comments_v2_newsfeed_you', _uuid: client.uuid },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function getCommentLikersChunk(client, commentId, endCursor) {
  const params = { comment_id: String(commentId), first: COMMENT_LIKERS_PAGE_SIZE };
  if (endCursor) {
    params.after = endCursor;
  }
  const res = await client.http.axios.get(GRAPHQL_QUERY_URL, {
    params: { query_hash: COMMENT_LIKERS_QUERY_HASH, variables: JSON.stringify(params) },
    timeout: 30000,
  });
  const data = (res && res.data) || {};
  const edge = ((data.comment || {}).edge_liked_by) || {};
  const likers = (edge.edges || []).filter((e) => e && e.node).map((e) => e.node);
  let cursor = '';
  if (edge.page_info) {
    cursor = edge.page_info.has_next_page ? (edge.page_info.end_cursor || '') : '';
  }
  return { likers, nextCursor: cursor };
}

async function getCommentLikers(client, commentId, amount) {
  const likers = [];
  let cursor = '';
  for (;;) {
    const chunk = await getCommentLikersChunk(client, commentId, cursor);
    likers.push(...chunk.likers);
    cursor = chunk.nextCursor;
    if (!cursor || chunk.likers.length === 0) {
      break;
    }
    if (amount && likers.length >= amount) {
      break;
    }
  }
  return amount ? likers.slice(0, amount) : likers;
}

module.exports = {
  COMMENT_LIKERS_QUERY_HASH,
  normalizeComment,
  getCommentsChunk,
  getComments,
  postComment,
  checkOffensiveComment,
  checkOffensiveCommentRaw,
  likeComment,
  unlikeComment,
  pinComment,
  unpinComment,
  bulkDeleteComments,
  getCommentLikersChunk,
  getCommentLikers,
};