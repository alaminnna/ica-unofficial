/**
 * @alaminnna/ica-unofficial — story/tray
 *
 * RESPONSIBILITY: story tray read only — followed users' current stories,
 *   defensively normalized (missing fields tolerated).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./reads (normalizeStory), client.api
 * MUST NOT:       never publish here
 *
 * DEBUG: when tray is empty but the app shows stories, start looking here —
 *   tray array shape (tray vs reels_media) or items nesting
 */

'use strict';

const { normalizeStory } = require('./reads');

async function getStoryTray(client, options) {
  const opts = options || {};
  const res = await client.api.request({ endpoint: 'feed/reels_tray/', method: 'GET', params: {} });
  const trays = (res || {}).tray || (res || {}).reels_media || [];
  const out = [];
  trays.forEach((tray) => {
    const user = tray.user || {};
    const items = (tray.items || []).map((item) => normalizeStory(item, user.pk));
    if (opts.amount) {
      items.splice(opts.amount);
    }
    out.push({
      userId: user.pk ? String(user.pk) : null,
      username: user.username || null,
      stories: items,
    });
  });
  return out;
}

module.exports = {
  getStoryTray,
};