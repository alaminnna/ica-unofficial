'use strict';

/**
 * @alaminnna/ica-unofficial — message/search
 *
 * RESPONSIBILITY: thread discovery only (ranked search + lookup by participants).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api.request only.
 * MUST NOT:       never send messages from here; never touch listener state.
 *
 * DEBUG: when .tsearch returns empty but threads exist, check here — query encoding
 * or mode param; when .tby finds nothing, the recipient_users JSON shape is the suspect.
 */

function normalizeShort(raw) {
  const data = raw || {};
  return {
    userId: data.pk === undefined || data.pk === null ? null : String(data.pk),
    username: data.username || null,
    fullName: data.full_name || null,
    profilePicUrl: data.profile_pic_url || null,
  };
}

async function searchThreads(client, query, mode) {
  const res = await client.api.request({
    endpoint: 'direct_v2/ranked_recipients/',
    method: 'GET',
    params: {
      max_ai_bot_results: '0',
      max_ig_bus_results: '10',
      mode: mode || 'universal',
      show_threads: 'true',
      query: String(query || ''),
      max_ig_results: '10',
      max_ibc_results: '20',
      max_fb_results: '0',
    },
  });
  return ((res || {}).ranked_recipients || [])
    .filter((item) => item && item.user && (item.user.username || '') !== '')
    .map((item) => normalizeShort(item.user));
}

async function searchMessages(client, query) {
  const res = await client.api.request({
    endpoint: 'direct_v2/search_secondary/',
    method: 'GET',
    params: {
      hide_locked_threads: '{"message_content":"false"}',
      offsets: '{"message_content":"0","reshared_content":""}',
      query: String(query || ''),
      result_types: '["message_content","reshared_content"]',
    },
  });
  if (((res || {}).status || '') !== 'ok') {
    throw new Error('@alaminnna/ica-unofficial: message search failed');
  }
  const items = (((res || {}).message_search_results || {}).message_search_result_items) || [];
  return items.map((item) => ({
    message: ((item || {}).matched_message_info || {}).item_info || null,
    thread: item.thread || null,
    raw: item,
  }));
}

async function getUsersPresence(client, userIds) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).map((id) => Number(id)).filter((n) => !Number.isNaN(n));
  const res = await client.api.request({
    endpoint: 'direct_v2/fetch_and_subscribe_presence/',
    method: 'POST',
    data: {
      _uuid: client.uuid,
      subscriptions_off: 'false',
      request_data: JSON.stringify(ids),
    },
  });
  if (((res || {}).status || '') !== 'ok') {
    throw new Error('@alaminnna/ica-unofficial: presence fetch failed');
  }
  return res;
}

async function getActivePresence(client) {
  const res = await client.api.request({
    endpoint: 'direct_v2/get_presence_active_now/',
    method: 'GET',
    params: { recent_thread_limit: 0, suggested_followers_limit: 100 },
  });
  if (((res || {}).status || '') !== 'ok') {
    throw new Error('@alaminnna/ica-unofficial: active presence fetch failed');
  }
  return (res || {}).user_presence || {};
}

async function searchGenAiBots(client, amount) {
  const res = await client.api.request({
    endpoint: 'direct_v2/search_gen_ai_bots/',
    method: 'GET',
    params: { num_ai_bots: String(amount || 20) },
  });
  return ((res || {}).user_search_results || [])
    .filter((item) => item && item.username)
    .map(normalizeShort);
}

async function getChannels(client, options) {
  const opts = options || {};
  const res = await client.api.request({
    endpoint: 'direct_v2/get_all_channels/',
    method: 'GET',
    params: {
      user_id: String(opts.userId || client.userId),
      thread_subtypes: JSON.stringify(opts.threadSubtypes || [29]),
    },
  });
  return (res || {}).all_channels_list || [];
}

async function getThreadByParticipants(client, userIds) {
  const ids = (Array.isArray(userIds) ? userIds : [userIds]).map((id) => Number(id)).filter((n) => !Number.isNaN(n));
  const res = await client.api.request({
    endpoint: 'direct_v2/threads/get_by_participants/',
    method: 'GET',
    params: { recipient_users: JSON.stringify(ids), seq_id: '2580572', limit: '20' },
  });
  const data = res || {};
  return {
    users: (data.users || []).map(normalizeShort),
    threadId: data.thread_id === undefined || data.thread_id === null ? null : String(data.thread_id),
    raw: data,
  };
}

module.exports = { searchThreads, searchMessages, getUsersPresence, getActivePresence, searchGenAiBots, getChannels, getThreadByParticipants };