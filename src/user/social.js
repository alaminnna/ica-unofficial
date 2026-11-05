/**
 * @alaminnna/ica-unofficial — user/social
 * 
 * RESPONSIBILITY: social graph reads: followers/following/mutual with dedupe paging.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api, client.rankToken
 * MUST NOT:       never write (follow/block) from here
 * 
 * DEBUG: when follower lists loop or duplicate, start looking here — max_id cursor and pk dedupe
 */

'use strict';

function normalizeShort(raw) {
  const data = raw || {};
  return {
    userId: data.pk === undefined || data.pk === null ? null : String(data.pk),
    username: data.username || null,
    fullName: data.full_name || null,
    profilePicUrl: data.profile_pic_url || null,
    isPrivate: data.is_private === undefined ? null : data.is_private,
    isVerified: data.is_verified === undefined ? null : data.is_verified,
  };
}

const FOLLOWERS_ORDERS = ['date_followed_latest', 'date_followed_earliest'];

function checkOrder(order) {
  if (order === undefined || order === null) {
    return undefined;
  }
  if (FOLLOWERS_ORDERS.indexOf(order) === -1) {
    throw new Error('@alaminnna/ica-unofficial: invalid order ' + order + ' (date_followed_latest|date_followed_earliest)');
  }
  return order;
}

async function pageFollowers(client, kind, userId, options) {
  const opts = options || {};
  const params = {
    count: opts.count || 200,
    rank_token: client.rankToken,
    search_surface: 'follow_list_page',
    query: opts.query || '',
    enable_groups: 'true',
  };
  if (kind === 'following' && opts.query) {
    params.includes_hashtags = 'false';
  }
  if (opts.order) {
    params.order = opts.order;
  }
  if (opts.maxId) {
    params.max_id = opts.maxId;
  }
  const res = await client.api.request({ endpoint: 'friendships/' + userId + '/' + kind + '/', method: 'GET', params });
  const users = [];
  const seen = new Set();
  ((res || {}).users || []).forEach((raw) => {
    const user = normalizeShort(raw);
    if (!user.userId || seen.has(user.userId)) {
      return;
    }
    seen.add(user.userId);
    users.push(user);
  });
  return { users, nextCursor: ((res || {}).next_max_id) || '' };
}

async function listPaginated(client, kind, userId, amount, options) {
  const opts = options || {};
  const users = [];
  const seen = new Set();
  let maxId = '';
  for (;;) {
    const remaining = amount ? amount - users.length : 200;
    const page = await pageFollowers(client, kind, userId, {
      count: Math.min(Math.max(remaining, 1), 200),
      maxId,
      order: opts.order,
    });
    page.users.forEach((user) => {
      if (seen.has(user.userId)) {
        return;
      }
      seen.add(user.userId);
      users.push(user);
    });
    maxId = page.nextCursor;
    if (!maxId || (amount && users.length >= amount)) {
      break;
    }
  }
  return { users: amount ? users.slice(0, amount) : users, nextCursor: maxId };
}

async function getFollowers(client, options) {
  const opts = options || {};
  return listPaginated(client, 'followers', String(opts.userId), opts.amount || 0, { order: checkOrder(opts.order) });
}

async function getFollowing(client, options) {
  const opts = options || {};
  return listPaginated(client, 'following', String(opts.userId), opts.amount || 0);
}

async function getFollowersChunk(client, options) {
  const opts = options || {};
  const out = await listPaginated(client, 'followers', String(opts.userId), opts.maxAmount || 0, { order: checkOrder(opts.order) });
  return { users: out.users, nextCursor: out.nextCursor };
}

async function getFollowingChunk(client, options) {
  const opts = options || {};
  const out = await listPaginated(client, 'following', String(opts.userId), opts.maxAmount || 0);
  return { users: out.users, nextCursor: out.nextCursor };
}

async function* iterUserFollowers(client, options) {
  const opts = options || {};
  const amount = opts.amount || 0;
  const pageSize = opts.pageSize || 200;
  const order = checkOrder(opts.order);
  const seen = new Set();
  let yielded = 0;
  let maxId = '';
  for (;;) {
    const remaining = amount ? amount - yielded : pageSize;
    const page = await pageFollowers(client, 'followers', String(opts.userId), {
      count: Math.min(Math.max(remaining, 1), pageSize),
      maxId,
      order,
    });
    for (const user of page.users) {
      if (seen.has(user.userId)) {
        continue;
      }
      seen.add(user.userId);
      yielded += 1;
      yield user;
      if (amount && yielded >= amount) {
        return;
      }
    }
    if (!page.nextCursor) {
      return;
    }
    maxId = page.nextCursor;
  }
}

async function* iterUserFollowing(client, options) {
  const opts = options || {};
  const amount = opts.amount || 0;
  const pageSize = opts.pageSize || 200;
  const seen = new Set();
  let yielded = 0;
  let maxId = '';
  for (;;) {
    const remaining = amount ? amount - yielded : pageSize;
    const page = await pageFollowers(client, 'following', String(opts.userId), {
      count: Math.min(Math.max(remaining, 1), pageSize),
      maxId,
    });
    for (const user of page.users) {
      if (seen.has(user.userId)) {
        continue;
      }
      seen.add(user.userId);
      yielded += 1;
      yield user;
      if (amount && yielded >= amount) {
        return;
      }
    }
    if (!page.nextCursor) {
      return;
    }
    maxId = page.nextCursor;
  }
}

async function searchFollowers(client, userId, query) {
  const page = await pageFollowers(client, 'followers', String(userId), { count: 200, query: String(query || '') });
  return page.users;
}

async function searchFollowing(client, userId, query) {
  const page = await pageFollowers(client, 'following', String(userId), { count: 200, query: String(query || '') });
  return page.users;
}

async function getMutualFollowers(client, options) {
  const opts = options || {};
  const amount = opts.amount || 0;
  const [followers, following] = await Promise.all([
    getFollowers(client, { userId: opts.userId, amount }),
    getFollowing(client, { userId: opts.userId, amount }),
  ]);
  const followingIds = new Set(following.users.map((u) => u.userId));
  const mutual = followers.users.filter((u) => followingIds.has(u.userId));
  return { users: amount ? mutual.slice(0, amount) : mutual };
}

module.exports = {
  FOLLOWERS_ORDERS,
  normalizeShort,
  getFollowers,
  getFollowing,
  getMutualFollowers,
  getFollowersChunk,
  getFollowingChunk,
  iterUserFollowers,
  iterUserFollowing,
  searchFollowers,
  searchFollowing,
};