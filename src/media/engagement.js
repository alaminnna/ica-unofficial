/**
 * @alaminnna/ica-unofficial — media/engagement
 *
 * RESPONSIBILITY: read-only engagement lists (liked medias, likers, comment replies).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api.request only.
 * MUST NOT:       never like/unlike/comment from here; GQL likers variant skipped (needs fb_dtsg).
 *
 * DEBUG: when .liked pages forever, check here — next_max_id loop; when .likers fails
 * on URLs, the media-id normalization below is the suspect.
 */

'use strict';

function mediaPkFromInput(client, input) {
  const text = String(input || '').trim();
  if (/^\d+$/.test(text)) {
    return text;
  }
  if (text.indexOf('_') !== -1) {
    return text.split('_')[0];
  }
  if (/^https?:\/\//.test(text)) {
    try {
      const { mediaPkFromUrl } = require('./codec');
      const pk = mediaPkFromUrl(text);
      if (pk) {
        return String(pk);
      }
    } catch (err) {
      // fall through to raw input
    }
  }
  return text;
}

async function getLikedMedias(client, amount) {
  const out = [];
  let maxId = '';
  const want = amount || 21;
  for (;;) {
    const params = { include_igtv_preview: 'false' };
    if (maxId) {
      params.max_id = maxId;
    }
    const res = await client.api.request({ endpoint: 'feed/liked/', method: 'GET', params });
    const items = (res || {}).items || [];
    items.forEach((m) => {
      const media = (m && m.media) || m || {};
      out.push({
        mediaId: media.id ? String(media.id) : (media.pk ? String(media.pk) : null),
        pk: media.pk ? String(media.pk) : null,
        mediaType: media.media_type === undefined ? null : media.media_type,
        caption: ((media.caption || {}).text) || null,
        takenAt: media.taken_at === undefined ? null : media.taken_at,
      });
    });
    maxId = ((res || {}).next_max_id) || '';
    if (!maxId || out.length >= want) {
      break;
    }
  }
  return out.slice(0, want);
}

async function getMediaLikers(client, mediaId) {
  const pk = mediaPkFromInput(client, mediaId);
  const fullId = pk.indexOf('_') !== -1 ? pk : pk + '_' + String(client.userId || '');
  const lookup = pk.indexOf('_') !== -1 ? pk : fullId;
  const res = await client.api.request({ endpoint: 'media/' + lookup + '/likers/', method: 'GET' });
  return ((res || {}).users || []).map((u) => ({
    userId: u.pk === undefined || u.pk === null ? null : String(u.pk),
    username: u.username || null,
    fullName: u.full_name || null,
  }));
}

async function getCommentReplies(client, mediaId, commentId, amount) {
  const mid = mediaPkFromInput(client, mediaId);
  const lookup = mid.indexOf('_') !== -1 ? mid : mid + '_' + String(client.userId || '');
  const out = [];
  let params = null;
  for (;;) {
    const res = await client.api.request({
      endpoint: 'media/' + lookup + '/comments/' + String(commentId) + '/inline_child_comments/',
      method: 'GET',
      params: params || undefined,
    });
    const data = res || {};
    (data.child_comments || []).forEach((c) => {
      out.push({ commentId: c.pk ? String(c.pk) : null, userId: c.user_id ? String(c.user_id) : null, text: c.text || null });
    });
    if ((amount && out.length >= amount) || !(data.has_more_head_child_comments && data.next_min_child_cursor)) {
      break;
    }
    params = { min_id: data.next_min_child_cursor };
  }
  return amount ? out.slice(0, amount) : out;
}

module.exports = { mediaPkFromInput, getLikedMedias, getMediaLikers, getCommentReplies };