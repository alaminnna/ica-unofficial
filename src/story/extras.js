/**
 * @alaminnna/ica-unofficial — story/extras
 *
 * RESPONSIBILITY: story extras: info, likers, like/unlike, poll vote,
 * sticker tray, archive days/stories.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./reads (getUserStories), ./highlights (SUPPORTED_CAPABILITIES),
 *                 ../media/manage (markMediaSeen), client.api, client.rateGuard
 * MUST NOT:       never burst writes — mutations go through rateGuard.schedule
 *
 * DEBUG: when like returns ok but heart never shows, start looking here —
 * mark_seen before send_story_like
 */

'use strict';

const { getStory } = require('./reads');
const { uploadPhotoStory } = require('./upload');
const { SUPPORTED_CAPABILITIES } = require('./highlights');
const { markMediaSeen } = require('../media/manage');

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

function splitStoryId(storyId) {
  const full = String(storyId);
  const parts = full.split('_');
  return { pk: parts[0], userId: parts[1] || null, full };
}

async function getStoryInfo(client, storyId) {
  const { pk, userId, full } = splitStoryId(storyId);
  if (!userId) {
    throw new Error('@alaminnna/ica-unofficial: getStoryInfo needs full "pk_userid" story id');
  }
  try {
    return await getStory(client, full);
  } catch (err) {
    throw new Error('@alaminnna/ica-unofficial: story not found: ' + full);
  }
}

async function getStoryLikersChunk(client, storyId, options) {
  const opts = options || {};
  const { pk } = splitStoryId(storyId);
  const maxAmount = opts.maxAmount || 0;
  const likers = [];
  const seen = new Set();
  let maxId = opts.maxId || '';
  for (;;) {
    const params = { supported_capabilities_new: JSON.stringify(SUPPORTED_CAPABILITIES) };
    if (maxId) {
      params.max_id = maxId;
    }
    const res = await client.api.request({
      endpoint: 'media/' + pk + '/list_reel_media_viewer/',
      method: 'GET',
      params,
    });
    ((res || {}).viewers || []).forEach((item) => {
      if (!item.has_liked || !item.user) {
        return;
      }
      const id = item.user.pk === undefined ? null : String(item.user.pk);
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      likers.push({ userId: id, username: item.user.username || null, fullName: item.user.full_name || null, raw: item.user });
    });
    maxId = ((res || {}).next_max_id) || '';
    if (!maxId || (maxAmount && likers.length >= maxAmount)) {
      break;
    }
  }
  return { likers: maxAmount ? likers.slice(0, maxAmount) : likers, nextCursor: maxId };
}

async function getStoryLikers(client, storyId, amount) {
  const chunk = await getStoryLikersChunk(client, storyId, { maxAmount: amount || 0 });
  return chunk.likers;
}

async function likeStory(client, storyId, options) {
  const opts = options || {};
  const { full } = splitStoryId(storyId);
  const guard = guardOf(client);
  if (opts.markSeen !== false && !opts.revert) {
    await markMediaSeen(client, [full], []);
  }
  const name = opts.revert ? 'unsend' : 'send';
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'story_interactions/' + name + '_story_like',
    method: 'POST',
    data: {
      media_id: full,
      _uid: String(client.userId),
      source_of_like: 'button',
      tray_session_id: (client.bundle && client.bundle.uuids && client.bundle.uuids.tray_session_id) || '',
      viewer_session_id: (client.bundle && client.bundle.uuids && client.bundle.uuids.client_session_id) || '',
      container_module: 'reel_feed_timeline',
      _uuid: client.uuid,
    },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function unlikeStory(client, storyId) {
  return likeStory(client, storyId, { revert: true });
}

async function voteStoryPoll(client, storyId, pollId, vote) {
  const index = Number(vote);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('@alaminnna/ica-unofficial: vote must be a non-negative option index');
  }
  const { full } = splitStoryId(storyId);
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'media/' + full + '/' + pollId + '/story_poll_vote/',
    method: 'POST',
    data: {
      _uid: String(client.userId),
      _csrftoken: client.csrftoken || client.bundle.csrftoken,
      vote: String(index),
      _uuid: client.uuid,
    },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function getStickerTray(client) {
  const res = await client.api.request({
    endpoint: 'creatives/sticker_tray/',
    method: 'POST',
    data: { _uid: String(client.userId), type: 'static_stickers', _uuid: client.uuid },
  });
  if (((res || {}).status || '') !== 'ok') {
    throw new Error('@alaminnna/ica-unofficial: sticker tray fetch failed');
  }
  return res;
}

async function getArchiveStoryDaysPaginated(client, options) {
  const opts = options || {};
  const params = {
    timezone_offset: client.bundle ? String(client.bundle.timezoneOffset) : '0',
    include_memories: opts.includeMemories === false ? '0' : '1',
  };
  if (opts.endCursor) {
    params.max_id = opts.endCursor;
  }
  if (opts.reelId) {
    params.reel_id = opts.reelId;
  }
  const res = await client.api.request({ endpoint: 'archive/reel/day_shells_paginated/', method: 'GET', params });
  const items = (res || {}).items || [];
  const days = opts.amount ? items.slice(0, opts.amount) : items;
  return { days, nextCursor: ((res || {}).max_id) || '' };
}

async function getArchiveStoryDays(client, options) {
  const opts = options || {};
  const amount = opts.amount || 0;
  const out = [];
  let cursor = '';
  for (;;) {
    const page = await getArchiveStoryDaysPaginated(client, { ...opts, amount, endCursor: cursor });
    out.push(...page.days);
    if (!page.nextCursor) {
      break;
    }
    if (amount && out.length >= amount) {
      break;
    }
    cursor = page.nextCursor;
  }
  return amount ? out.slice(0, amount) : out;
}

async function shareMediaToStory(client, options) {
  const opts = options || {};
  if (!opts.mediaId) {
    throw new Error('@alaminnna/ica-unofficial: shareMediaToStory needs { mediaId }');
  }
  if (!opts.background) {
    throw new Error('@alaminnna/ica-unofficial: shareMediaToStory needs { background } 9:16 image path');
  }
  const full = String(opts.mediaId);
  const parts = full.split('_');
  return uploadPhotoStory(client, {
    path: opts.background,
    caption: opts.caption || '',
    medias: [{
      mediaPk: parts[0],
      userId: parts[1] || '',
      x: opts.x === undefined ? 0.5 : opts.x,
      y: opts.y === undefined ? 0.4997396 : opts.y,
      width: opts.width === undefined ? 0.8 : opts.width,
      height: opts.height === undefined ? 0.60572916 : opts.height,
      rotation: opts.rotation || 0,
    }],
    extraData: opts.extraData || {},
  });
}

async function getArchiveStories(client, amount) {
  const days = await getArchiveStoryDays(client, { amount: 0 });
  const out = [];
  for (let i = 0; i < days.length; i += 50) {
    const ids = days.slice(i, i + 50).map((d) => d.id || d.pk).filter(Boolean);
    if (ids.length === 0) {
      continue;
    }
    const res = await client.api.request({
      endpoint: 'feed/reels_media_stream/',
      method: 'POST',
      data: {
        reel_ids: ids,
        reason: 'on_tap',
        source: 'archive',
        batch_size: ids.length,
        _uuid: client.uuid,
      },
    });
    const reels = (res || {}).reels || (res || {}).reels_media || [];
    const list = Array.isArray(reels) ? reels : Object.keys(reels).map((k) => reels[k]);
    list.forEach((reel) => {
      ((reel || {}).items || []).forEach((item) => {
        out.push(item);
        if (amount && out.length >= amount) {
          return;
        }
      });
    });
    if (amount && out.length >= amount) {
      return out.slice(0, amount);
    }
  }
  return amount ? out.slice(0, amount) : out;
}

module.exports = {
  getStoryInfo,
  getStoryLikersChunk,
  getStoryLikers,
  likeStory,
  unlikeStory,
  voteStoryPoll,
  getStickerTray,
  getArchiveStoryDaysPaginated,
  getArchiveStoryDays,
  getArchiveStories,
  shareMediaToStory,
};