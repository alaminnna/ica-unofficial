/**
 * @alaminnna/ica-unofficial — discover/search
 *
 * RESPONSIBILITY: advanced search only — blended topsearch, users, hashtags,
 *   places, media grid (SERP paging).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../media/info (normalizeMediaInfo), client.api
 * MUST NOT:       never follow-up fetch here (return raw + normalized lists)
 *
 * DEBUG: when search is empty, start looking here — search_surface values
 *   or timezone_offset param
 */

'use strict';

const { normalizeMediaInfo } = require('../media/info');

function timezoneOffset(client) {
  return client.bundle ? String(client.bundle.timezoneOffset) : '0';
}

async function topsearchFlat(client, query) {
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: topsearchFlat needs { query }');
  }
  const res = await client.api.request({
    endpoint: 'fbsearch/topsearch_flat/',
    method: 'GET',
    params: {
      search_surface: 'top_search_page',
      context: 'blended',
      timezone_offset: timezoneOffset(client),
      count: 30,
      query: String(query),
    },
  });
  return (res || {}).list || [];
}

async function searchUsersAdvanced(client, query, amount) {
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: searchUsersAdvanced needs { query }');
  }
  const res = await client.api.request({
    endpoint: 'users/search/',
    method: 'GET',
    params: {
      search_surface: 'user_search_page',
      timezone_offset: timezoneOffset(client),
      count: 30,
      q: String(query),
    },
  });
  const users = ((res || {}).users || []).map((u) => ({
    userId: u.pk ? String(u.pk) : null,
    username: u.username || null,
    fullName: u.full_name || null,
    profilePicUrl: u.profile_pic_url || null,
    isPrivate: Boolean(u.is_private),
    isVerified: Boolean(u.is_verified),
  }));
  return amount ? users.slice(0, amount) : users;
}

async function searchHashtags(client, query, amount) {
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: searchHashtags needs { query }');
  }
  const res = await client.api.request({
    endpoint: 'tags/search/',
    method: 'GET',
    params: {
      search_surface: 'hashtag_search_page',
      timezone_offset: timezoneOffset(client),
      count: 30,
      q: String(query),
    },
  });
  const tags = ((res || {}).results || []).map((ht) => ({
    name: ht.name || null,
    mediaCount: ht.media_count === undefined ? null : ht.media_count,
  }));
  return amount ? tags.slice(0, amount) : tags;
}

async function searchPlaces(client, query, options) {
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: searchPlaces needs { query }');
  }
  const opts = options || {};
  const { normalizeLocation } = require('./location');
  const res = await client.api.request({
    endpoint: 'fbsearch/places/',
    method: 'GET',
    params: { query: String(query), lat: opts.lat || 40.74, lng: opts.lng || -73.94 },
  });
  return ((res || {}).items || []).map((item) => normalizeLocation(item.location || item, {}));
}

async function searchMedias(client, options) {
  const opts = typeof options === 'object' && options !== null ? options : { query: options };
  if (!opts.query) {
    throw new Error('@alaminnna/ica-unofficial: searchMedias needs { query }');
  }
  const amount = opts.amount || 27;
  const out = [];
  let nextMaxId = opts.nextMaxId || '';
  let reelsMaxId = '';
  let rankToken = '';
  const seenCursors = new Set(['']);
  for (;;) {
    if (out.length >= amount) {
      break;
    }
    const params = {
      search_surface: 'top_serp',
      timezone_offset: timezoneOffset(client),
      query: String(opts.query),
      rank_token: rankToken || client.rankToken,
    };
    if (nextMaxId) {
      params.next_max_id = nextMaxId;
    }
    if (reelsMaxId) {
      params.reels_max_id = reelsMaxId;
    }
    const res = await client.api.request({ endpoint: 'fbsearch/top_serp/', method: 'GET', params });
    const grid = (res || {}).media_grid || {};
    const nodes = [];
    const collect = (value) => {
      if (Array.isArray(value)) {
        value.forEach(collect);
      } else if (value && typeof value === 'object') {
        if (value.pk && (value.media_type !== undefined || value.id)) {
          nodes.push(value);
        }
        Object.keys(value).forEach((k) => collect(value[k]));
      }
    };
    collect(grid);
    for (const node of nodes) {
      if (out.length >= amount) {
        break;
      }
      try {
        out.push(normalizeMediaInfo(node));
      } catch (ignored) {
        // skip malformed nodes
      }
    }
    if (out.length >= amount) {
      break;
    }
    nextMaxId = grid.next_max_id || res.next_max_id || '';
    if (!grid.has_more || !nextMaxId || seenCursors.has(nextMaxId)) {
      break;
    }
    seenCursors.add(nextMaxId);
    reelsMaxId = grid.reels_max_id || res.reels_max_id || '';
    rankToken = grid.rank_token || res.rank_token || rankToken;
  }
  return out.slice(0, amount);
}

async function webSearchTopsearch(client, query) {
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: webSearchTopsearch needs { query }');
  }
  return client.api.request({
    endpoint: 'web/search/topsearch/',
    method: 'GET',
    params: { search_surface: 'web_top_search', context: 'blended', include_reel: 'true', query: String(query) },
  });
}

async function webSearchTopsearchHashtags(client, query) {
  const res = await webSearchTopsearch(client, query);
  return ((res || {}).hashtags || []).map((item) => item.hashtag || item);
}

async function fbsearchItem(client, options) {
  const opts = options || {};
  if (!opts.itemId || !opts.searchSurface || !opts.query) {
    throw new Error('@alaminnna/ica-unofficial: fbsearchItem needs { itemId, searchSurface, query }');
  }
  const params = {
    search_surface: opts.searchSurface,
    query: String(opts.query),
  };
  ['timezone_offset', 'count', 'reels_page_index', 'has_more_reels', 'reels_max_id', 'next_max_id', 'rank_token', 'page_index', 'page_token', 'paging_token'].forEach((key) => {
    const camel = key.replace(/_([a-z])/g, (m, c) => c.toUpperCase());
    if (opts[camel] !== undefined && opts[camel] !== null) {
      params[key] = opts[camel];
    }
  });
  return client.api.request({ endpoint: 'fbsearch/' + opts.itemId + '/', method: 'GET', params });
}

async function keywordTypeahead(client, query, options) {
  const opts = options || {};
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: keywordTypeahead needs { query }');
  }
  return client.api.request({
    endpoint: 'fbsearch/keyword_typeahead/',
    method: 'GET',
    params: {
      search_surface: 'typeahead_search_page',
      query: String(query),
      context: 'blended',
      timezone_offset: opts.timezoneOffset === undefined ? timezoneOffset(client) : opts.timezoneOffset,
      count: opts.count || 30,
    },
  });
}

async function typeaheadStream(client, query, options) {
  const opts = options || {};
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: typeaheadStream needs { query }');
  }
  return client.api.request({
    endpoint: 'fbsearch/typeahead_stream/',
    method: 'GET',
    params: {
      search_surface: 'typeahead_search_page',
      query: String(query),
      context: 'blended',
      timezone_offset: opts.timezoneOffset === undefined ? timezoneOffset(client) : opts.timezoneOffset,
      count: opts.count || 30,
    },
  });
}

async function typeaheadUsers(client, query, options) {
  const res = await typeaheadStream(client, query, options);
  const rows = (res || {}).stream_rows || [];
  const out = [];
  rows.forEach((row) => ((row || {}).users || []).forEach((u) => out.push(u)));
  return out;
}

async function recentSearches(client) {
  const res = await client.api.request({ endpoint: 'fbsearch/recent_searches/', method: 'GET' });
  if (((res || {}).status || '') !== 'ok') {
    throw new Error('@alaminnna/ica-unofficial: recent searches fetch failed');
  }
  return (res || {}).recent || [];
}

async function searchAccountsV2(client, query, pageToken) {
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: searchAccountsV2 needs { query }');
  }
  const params = {
    search_surface: 'account_serp',
    timezone_offset: timezoneOffset(client),
    query: String(query),
  };
  if (pageToken) {
    params.page_token = pageToken;
  }
  return client.api.request({ endpoint: 'fbsearch/account_serp/', method: 'GET', params });
}

async function searchReelsV2(client, query, options) {
  const opts = options || {};
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: searchReelsV2 needs { query }');
  }
  const params = {
    search_surface: 'clips_search_page',
    timezone_offset: timezoneOffset(client),
    query: String(query),
  };
  if (opts.reelsMaxId) {
    params.reels_max_id = opts.reelsMaxId;
  }
  if (opts.rankToken) {
    params.rank_token = opts.rankToken;
  }
  return client.api.request({ endpoint: 'fbsearch/reels_serp/', method: 'GET', params });
}

async function topsearchV2(client, query, options) {
  const opts = options || {};
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: topsearchV2 needs { query }');
  }
  const params = {
    search_surface: 'top_serp',
    timezone_offset: timezoneOffset(client),
    query: String(query),
    rank_token: opts.rankToken || client.rankToken,
  };
  if (opts.nextMaxId) {
    params.next_max_id = opts.nextMaxId;
  }
  if (opts.reelsMaxId) {
    params.reels_max_id = opts.reelsMaxId;
  }
  return client.api.request({ endpoint: 'fbsearch/top_serp/', method: 'GET', params });
}

async function suggestedProfiles(client, userId) {
  if (!userId) {
    throw new Error('@alaminnna/ica-unofficial: suggestedProfiles needs { userId }');
  }
  const { normalizeShort } = require('../user/social');
  const res = await client.api.request({
    endpoint: 'fbsearch/accounts_recs/',
    method: 'GET',
    params: { target_user_id: String(userId), include_friendship_status: 'true' },
  });
  return ((res || {}).users || []).map(normalizeShort);
}

async function searchUsers(client, query, count) {
  if (!query) {
    throw new Error('@alaminnna/ica-unofficial: searchUsers needs { query }');
  }
  const { normalizeShort } = require('../user/social');
  const res = await client.api.request({
    endpoint: 'users/search/',
    method: 'GET',
    params: { query: String(query), count: count || 50 },
  });
  return ((res || {}).users || []).map(normalizeShort);
}

module.exports = {
  topsearchFlat,
  searchUsersAdvanced,
  searchHashtags,
  searchPlaces,
  searchMedias,
  webSearchTopsearch,
  webSearchTopsearchHashtags,
  fbsearchItem,
  keywordTypeahead,
  typeaheadStream,
  typeaheadUsers,
  recentSearches,
  searchAccountsV2,
  searchReelsV2,
  topsearchV2,
  suggestedProfiles,
  searchUsers,
};