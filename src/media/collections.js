/**
 * @alaminnna/ica-unofficial — media/collections
 *
 * RESPONSIBILITY: saved collections: list, medias by id/name, save/unsave.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./engagement (mediaPkFromInput), client.api, client.rateGuard
 * MUST NOT:       never burst writes — save/unsave go through rateGuard.schedule
 *
 * DEBUG: when saved posts come back empty, start looking here — endpoint
 * selection (numeric id vs "liked" vs saved-posts)
 */

'use strict';

const { mediaPkFromInput } = require('./engagement');

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

function normalizeCollection(raw) {
  const data = raw || {};
  return {
    id: data.collection_id === undefined || data.collection_id === null ? null : String(data.collection_id),
    name: data.collection_name || data.name || null,
    type: data.collection_type || null,
    raw: data,
  };
}

function normalizeCollectionMedia(raw) {
  const data = (raw && raw.media) || raw || {};
  const candidates = (((data.image_versions2 || {}).candidates) || []);
  return {
    id: data.pk === undefined || data.pk === null ? null : String(data.pk),
    code: data.code || null,
    mediaType: data.media_type === undefined ? null : data.media_type,
    caption: ((data.caption || {}).text) || null,
    thumbnailUrl: (candidates[0] && candidates[0].url) || null,
    raw: raw || {},
  };
}

function collectionEndpoint(collectionId) {
  const id = String(collectionId);
  if (/^\d+$/.test(id)) {
    return 'feed/collection/' + id + '/';
  }
  if (id.toLowerCase() === 'liked') {
    return 'feed/liked/';
  }
  return 'feed/saved/posts/';
}

async function getCollections(client) {
  const out = [];
  let maxId = '';
  for (;;) {
    const params = {
      collection_types: '["ALL_MEDIA_AUTO_COLLECTION","PRODUCT_AUTO_COLLECTION","MEDIA"]',
      max_id: maxId,
    };
    let res;
    try {
      res = await client.api.request({ endpoint: 'collections/list/', method: 'GET', params });
    } catch (err) {
      return out;
    }
    ((res || {}).items || []).forEach((raw) => out.push(normalizeCollection(raw)));
    if (!((res || {}).more_available)) {
      return out;
    }
    maxId = ((res || {}).next_max_id) || ((res || {}).max_id) || '';
    if (!maxId) {
      return out;
    }
  }
}

async function getCollectionIdByName(client, name) {
  const list = await getCollections(client);
  const found = list.find((c) => c.name === name);
  if (!found || !found.id) {
    throw new Error('@alaminnna/ica-unofficial: collection not found: ' + name);
  }
  return found.id;
}

async function getCollectionMediasChunk(client, options) {
  const opts = options || {};
  const params = { include_igtv_preview: 'false' };
  if (opts.maxId) {
    params.max_id = opts.maxId;
  }
  const res = await client.api.request({
    endpoint: collectionEndpoint(opts.collectionId),
    method: 'GET',
    params,
  });
  const items = ((res || {}).items || []).map(normalizeCollectionMedia);
  return { medias: items, nextCursor: ((res || {}).next_max_id) || ((res || {}).max_id) || '' };
}

async function getCollectionMedias(client, options) {
  const opts = options || {};
  const amount = opts.amount === undefined ? 21 : opts.amount;
  const lastMediaId = opts.lastMediaId ? String(opts.lastMediaId) : null;
  const out = [];
  let maxId = '';
  for (;;) {
    const chunk = await getCollectionMediasChunk(client, { collectionId: opts.collectionId, maxId });
    let stop = false;
    for (const media of chunk.medias) {
      if (lastMediaId && media.id === lastMediaId) {
        stop = true;
        break;
      }
      out.push(media);
    }
    if (stop || (amount && out.length >= amount)) {
      break;
    }
    if (chunk.medias.length === 0 || !chunk.nextCursor) {
      break;
    }
    maxId = chunk.nextCursor;
  }
  return amount ? out.slice(0, amount) : out;
}

async function getCollectionMediasByName(client, options) {
  const opts = options || {};
  const id = await getCollectionIdByName(client, opts.name);
  return getCollectionMedias(client, { ...opts, collectionId: id });
}

async function saveMedia(client, options) {
  const opts = options || {};
  const mediaId = mediaPkFromInput(client, opts.mediaId).split('_')[0];
  const guard = guardOf(client);
  const data = { module_name: 'feed_timeline', radio_type: 'wifi-none', _uuid: client.uuid };
  if (opts.collectionId) {
    data.added_collection_ids = '[' + Number(opts.collectionId) + ']';
  }
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'media/' + mediaId + '/save/',
    method: 'POST',
    data,
  }));
  return ((res || {}).status || '') === 'ok';
}

async function unsaveMedia(client, options) {
  const opts = options || {};
  const mediaId = mediaPkFromInput(client, opts.mediaId).split('_')[0];
  const guard = guardOf(client);
  const data = { module_name: 'feed_timeline', radio_type: 'wifi-none', _uuid: client.uuid };
  if (opts.collectionId) {
    data.added_collection_ids = '[' + Number(opts.collectionId) + ']';
  }
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'media/' + mediaId + '/unsave/',
    method: 'POST',
    data,
  }));
  return ((res || {}).status || '') === 'ok';
}

module.exports = {
  normalizeCollection,
  normalizeCollectionMedia,
  getCollections,
  getCollectionIdByName,
  getCollectionMediasChunk,
  getCollectionMedias,
  getCollectionMediasByName,
  saveMedia,
  unsaveMedia,
};