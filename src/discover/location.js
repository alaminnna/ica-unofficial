/**
 * @alaminnna/ica-unofficial — discover/location
 *
 * RESPONSIBILITY: location reads only — search by coords, info by pk, medias.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../media/info (normalizeMediaInfo), client.api
 * MUST NOT:       never story-sticker resolution here (story module owns that)
 *
 * DEBUG: when location search is empty, start looking here — lat/lng params
 *   or venues array shape
 */

'use strict';

const { normalizeMediaInfo } = require('../media/info');

function normalizeLocation(raw, fallback) {
  const data = raw || {};
  const fb = fallback || {};
  return {
    pk: data.pk ? String(data.pk) : (data.external_id ? String(data.external_id) : null),
    name: data.name || null,
    address: data.address || null,
    lat: data.lat !== undefined && data.lat !== null ? Number(data.lat) : (fb.lat !== undefined ? fb.lat : null),
    lng: data.lng !== undefined && data.lng !== null ? Number(data.lng) : (fb.lng !== undefined ? fb.lng : null),
    externalId: data.external_id !== undefined && data.external_id !== null ? String(data.external_id) : null,
    externalIdSource: data.external_id_source || null,
  };
}

async function searchLocations(client, options) {
  const opts = typeof options === 'object' && options !== null ? options : {};
  const lat = Number(opts.lat);
  const lng = Number(opts.lng);
  if (!lat || !lng) {
    throw new Error('@alaminnna/ica-unofficial: searchLocations needs { lat, lng }');
  }
  const res = await client.api.request({
    endpoint: 'location_search/',
    method: 'GET',
    params: { latitude: lat, longitude: lng },
  });
  return ((res || {}).venues || []).map((venue) => normalizeLocation(venue, { lat, lng }));
}

async function getLocationInfo(client, locationPk) {
  if (!locationPk) {
    throw new Error('@alaminnna/ica-unofficial: getLocationInfo needs { locationPk }');
  }
  const res = await client.api.request({
    endpoint: 'locations/' + locationPk + '/location_info/',
    method: 'GET',
  });
  if (!(res || {}).name) {
    throw new Error('@alaminnna/ica-unofficial: location not found: ' + locationPk);
  }
  return normalizeLocation(res || {});
}

const LOCATION_TABS = ['ranked', 'recent'];

function checkLocationTab(tab) {
  const value = tab || 'ranked';
  if (LOCATION_TABS.indexOf(value) === -1) {
    throw new Error('@alaminnna/ica-unofficial: invalid tab ' + value + ' (ranked|recent)');
  }
  return value;
}

function encodeLocationCursor(nextMaxId, page, mediaIds) {
  return Buffer.from(JSON.stringify([nextMaxId, page, mediaIds]), 'utf8').toString('base64');
}

function decodeLocationCursor(cursor) {
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 3) {
      return parsed;
    }
  } catch (ignored) {
    // fall through
  }
  throw new Error('@alaminnna/ica-unofficial: invalid location cursor');
}

async function getLocationMediasChunk(client, options) {
  const opts = options || {};
  if (!opts.locationPk) {
    throw new Error('@alaminnna/ica-unofficial: getLocationMediasChunk needs { locationPk }');
  }
  const data = {
    _uuid: client.uuid,
    session_id: client.bundle.uuids.client_session_id,
    tab: checkLocationTab(opts.tab),
  };
  if (opts.maxId) {
    const [mId, page, mediaIds] = decodeLocationCursor(opts.maxId);
    data.max_id = mId;
    data.page = page;
    data.next_media_ids = mediaIds;
  }
  const res = await client.api.request({
    endpoint: 'locations/' + opts.locationPk + '/sections/',
    method: 'POST',
    data,
  });
  const medias = [];
  ((res || {}).sections || []).forEach((section) => {
    const nodes = (((section || {}).layout_content || {}).medias) || [];
    nodes.forEach((node) => {
      if (node && node.media && (node.media.pk || node.media.id)) {
        try {
          medias.push(normalizeMediaInfo(node.media));
        } catch (ignored) {
          // skip malformed nodes
        }
      }
    });
  });
  let nextCursor = null;
  if (res.next_page && res.next_max_id) {
    nextCursor = encodeLocationCursor(res.next_max_id, res.next_page, res.next_media_ids);
  }
  return { medias, nextCursor };
}

async function getLocationMedias(client, options) {
  const opts = options || {};
  const amount = opts.amount === undefined ? 63 : opts.amount;
  const out = [];
  let maxId = opts.maxId || null;
  for (;;) {
    const chunk = await getLocationMediasChunk(client, { locationPk: opts.locationPk, tab: opts.tab, maxId });
    out.push(...chunk.medias);
    if ((amount && out.length >= amount) || !chunk.nextCursor) {
      break;
    }
    maxId = chunk.nextCursor;
  }
  return amount ? out.slice(0, amount) : out;
}

async function getLocationMediasTop(client, locationPk, amount) {
  const { getLocationMedias: list } = module.exports;
  return list(client, { locationPk, tab: 'ranked', amount: amount === undefined ? 21 : amount });
}

async function getLocationMediasRecent(client, locationPk, amount) {
  const { getLocationMedias: list } = module.exports;
  return list(client, { locationPk, tab: 'recent', amount: amount === undefined ? 63 : amount });
}

async function searchLocationsByName(client, name) {
  if (!name) {
    throw new Error('@alaminnna/ica-unofficial: searchLocationsByName needs { name }');
  }
  const res = await client.api.request({
    endpoint: 'fbsearch/places/',
    method: 'GET',
    params: {
      search_surface: 'places_search_page',
      timezone_offset: client.bundle ? String(client.bundle.timezoneOffset) : '0',
      lat: 40.74,
      lng: -73.94,
      count: 30,
      query: String(name),
    },
  });
  return ((res || {}).items || []).map((item) => normalizeLocation(item.location || item, {}));
}

async function searchLocationByPk(client, locationPk) {
  const info = await getLocationInfo(client, locationPk);
  const candidates = await searchLocationsByName(client, info.name);
  const match = candidates.find((c) => String(c.pk) === String(locationPk));
  return match || info;
}

async function completeLocation(client, location) {
  const loc = { ...(location || {}) };
  if (loc.pk && !loc.lat) {
    const info = await getLocationInfo(client, loc.pk);
    loc.lat = info.lat;
    loc.lng = info.lng;
  }
  if (loc.pk && !loc.externalId) {
    const resolved = await searchLocationByPk(client, loc.pk);
    loc.externalId = resolved.externalId;
    loc.externalIdSource = resolved.externalIdSource;
  } else if (!loc.externalId && loc.lat) {
    const venues = await searchLocations(client, { lat: loc.lat, lng: loc.lng });
    if (venues[0]) {
      loc.externalId = venues[0].externalId;
      loc.externalIdSource = venues[0].externalIdSource;
    }
  }
  if (!loc.pk && loc.externalId) {
    const info = await getLocationInfo(client, loc.externalId);
    if (info.name === loc.name || (info.lat === loc.lat && info.lng === loc.lng)) {
      loc.pk = loc.externalId;
    }
  }
  return loc;
}

function buildLocation(location) {
  const loc = location || {};
  if (!loc || (!loc.pk && !loc.name)) {
    return '{}';
  }
  return JSON.stringify({
    name: loc.name || null,
    address: loc.address || null,
    lat: loc.lat === undefined ? null : loc.lat,
    lng: loc.lng === undefined ? null : loc.lng,
    external_source: loc.externalIdSource || null,
    facebook_places_id: loc.externalId || null,
  });
}

function locationStoryStickerId(location) {
  const loc = location || {};
  if (!loc || (!loc.externalId && !loc.pk)) {
    return '';
  }
  return String(loc.externalId || loc.pk || '');
}

async function getLocationGuides(client, locationPk) {
  const res = await client.api.request({ endpoint: 'guides/location/' + locationPk + '/', method: 'GET' });
  return ((res || {}).guides || []).map((g) => ({
    id: g.guide_id || g.id || null,
    title: g.title || null,
    raw: g,
  }));
}

module.exports = {
  normalizeLocation,
  searchLocations,
  searchLocationsByName,
  searchLocationByPk,
  completeLocation,
  buildLocation,
  locationStoryStickerId,
  getLocationInfo,
  getLocationMediasChunk,
  getLocationMedias,
  getLocationMediasTop,
  getLocationMediasRecent,
  getLocationGuides,
};