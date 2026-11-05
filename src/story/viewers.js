/**
 * @alaminnna/ica-unofficial — story/viewers
 *
 * RESPONSIBILITY: story audience reads only — viewers list with paging.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api
 * MUST NOT:       never publish here
 *
 * DEBUG: when viewers come back empty, start looking here — story pk form
 *   (bare pk ok, stripped automatically) or max_id paging
 */

'use strict';

async function getStoryViewers(client, options) {
  const opts = typeof options === 'object' && options !== null ? options : { storyPk: options };
  const storyPk = String(opts.storyPk || '').split('_')[0];
  if (!storyPk) {
    throw new Error('@alaminnna/ica-unofficial: getStoryViewers needs { storyPk }');
  }
  const viewers = [];
  const seen = new Set();
  let maxId = opts.maxId || '';
  for (;;) {
    const params = {};
    if (maxId) {
      params.max_id = maxId;
    }
    const res = await client.api.request({
      endpoint: 'media/' + storyPk + '/list_reel_media_viewer/',
      method: 'GET',
      params,
    });
    ((res || {}).viewers || []).forEach((item) => {
      const user = item.user || {};
      const pk = user.pk ? String(user.pk) : null;
      if (!pk || seen.has(pk)) {
        return;
      }
      seen.add(pk);
      viewers.push({ userId: pk, username: user.username || null, liked: Boolean(item.has_liked) });
      if (opts.amount && viewers.length >= opts.amount) {
        return;
      }
    });
    if (opts.amount && viewers.length >= opts.amount) {
      break;
    }
    maxId = (res && res.next_max_id) || '';
    if (!maxId) {
      break;
    }
  }
  return opts.amount ? viewers.slice(0, opts.amount) : viewers;
}

module.exports = {
  getStoryViewers,
};