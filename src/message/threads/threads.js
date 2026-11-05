/**
 * @alaminnna/ica-unofficial — message/threads/threads
 * 
 * RESPONSIBILITY: inbox/thread/messages reads with cursor paging.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../../core/device, ../../exceptions, client.api
 * MUST NOT:       never send from here
 * 
 * DEBUG: when inbox is empty or paging loops forever, start looking here — cursor handling
 */

'use strict';

const { DirectThreadNotFound } = require('../../exceptions');
const { generateMutationToken } = require('../../core/device');

const NAV_CHAIN = '1qT:feed_timeline:1,1qT:feed_timeline:2,1qT:feed_timeline:3,7Az:direct_inbox:4,7Az:direct_inbox:5,5rG:direct_thread:7';

function compactJson(obj) {
  return JSON.stringify(obj);
}

function normalizeMessage(raw, threadId) {
  const msg = { ...raw };
  msg.id = String(raw.item_id);
  msg.thread_id = threadId !== undefined ? threadId : raw.thread_id;
  msg.user_id = raw.user_id === undefined || raw.user_id === null ? '' : String(raw.user_id);
  msg.client_context = raw.client_context || '';
  if (typeof raw.timestamp === 'number') {
    msg.timestamp = Math.floor(raw.timestamp / 1000);
  }
  return msg;
}

function normalizeThread(raw) {
  const thread = { ...raw };
  thread.id = raw.thread_id;
  thread.pk = raw.thread_v2_id;
  thread.messages = (raw.items || []).map((item) => normalizeMessage({ ...item, thread_id: raw.thread_id }, raw.thread_id));
  return thread;
}

async function inboxChunk(client, endpoint, params) {
  const res = await client.api.request({ method: 'GET', endpoint, params });
  const data = res || {};
  const inbox = data.inbox || {};
  return {
    threads: (inbox.threads || []).map(normalizeThread),
    cursor: inbox.oldest_cursor || null,
    seqId: data.seq_id === undefined ? null : data.seq_id,
    snapshotAtMs: data.snapshot_at_ms === undefined ? null : data.snapshot_at_ms,
  };
}

async function collectPages(fetchChunk, amount) {
  const out = [];
  let cursor = null;
  for (;;) {
    const chunk = await fetchChunk(cursor);
    out.push(...chunk.threads);
    cursor = chunk.cursor;
    if (!cursor || (amount && out.length >= amount)) {
      break;
    }
  }
  return amount ? out.slice(0, amount) : out;
}

async function getThreads(client, options) {
  const opts = options || {};
  const params = {
    visual_message_return_type: 'unseen',
    thread_message_limit: String(opts.threadMessageLimit || 10),
    persistentBadging: 'true',
    limit: '20',
    is_prefetching: 'false',
    fetch_reason: 'initial_snapshot',
    include_old_mrs: 'false',
    no_pending_badge: 'true',
  };
  if (opts.filter) {
    params.selected_filter = opts.filter;
  }
  if (opts.box) {
    params.folder = opts.box === 'general' ? '1' : '0';
  }
  return collectPages((cursor) => {
    const page = { ...params };
    if (cursor) {
      page.cursor = cursor;
      page.direction = 'older';
      page.fetch_reason = 'page_scroll';
    }
    return inboxChunk(client, 'direct_v2/inbox/', page);
  }, opts.amount === undefined ? 20 : opts.amount);
}

async function pendingRequests(client, options) {
  const opts = options || {};
  return collectPages((cursor) => {
    const params = {
      visual_message_return_type: 'unseen',
      persistentBadging: 'true',
      is_prefetching: 'false',
    };
    if (cursor) {
      params.cursor = cursor;
    }
    return inboxChunk(client, 'direct_v2/pending_inbox/', params);
  }, opts.amount === undefined ? 20 : opts.amount);
}

async function getThread(client, threadId, options) {
  const opts = options || {};
  const amount = opts.amount === undefined ? 20 : opts.amount;
  const params = { visual_message_return_type: 'unseen', direction: 'older', seq_id: '40065', limit: '20' };
  let firstShape = null;
  const items = [];
  let cursor = null;
  for (;;) {
    const page = { ...params };
    if (cursor) {
      page.cursor = cursor;
    }
    let res;
    try {
      res = await client.api.request({ method: 'GET', endpoint: 'direct_v2/threads/' + threadId + '/', params: page });
    } catch (err) {
      if (err && err.response && err.response.status === 404) {
        throw new DirectThreadNotFound('@alaminnna/ica-unofficial: thread ' + threadId + ' not found', { thread_id: threadId });
      }
      throw err;
    }
    const thread = (res || {}).thread || {};
    if (!firstShape) {
      firstShape = thread;
    }
    (thread.items || []).forEach((item) => items.push(item));
    cursor = thread.oldest_cursor || null;
    if (!cursor || (amount && items.length >= amount)) {
      break;
    }
  }
  return normalizeThread({ ...(firstShape || {}), items: amount ? items.slice(0, amount) : items });
}

async function getMessages(client, threadId, options) {
  const thread = await getThread(client, threadId, options);
  return thread.messages;
}

async function approveRequest(client, threadId) {
  const res = await client.api.request({
    method: 'POST',
    endpoint: 'direct_v2/threads/' + threadId + '/approve/',
    data: { filter: 'DEFAULT', _uuid: client.uuid },
  });
  return ((res || {}).status || '') === 'ok';
}

async function markThreadSeen(client, threadId, messageId) {
  const rt = client._realtime || client._realtimeClient;
  if (client.preferMqttActions !== false && rt && rt.connected && typeof rt.directMarkSeen === 'function') {
    await rt.directMarkSeen(threadId, messageId);
    return true;
  }
  const token = generateMutationToken();
  const res = await client.api.request({
    method: 'POST',
    endpoint: 'direct_v2/threads/' + threadId + '/items/' + messageId + '/seen/',
    data: { thread_id: String(threadId), action: 'mark_seen', client_context: token, _uuid: client.uuid, offline_threading_id: token },
  });
  return ((res || {}).status || '') === 'ok';
}

module.exports = {
  NAV_CHAIN,
  normalizeMessage,
  normalizeThread,
  getThreads,
  pendingRequests,
  getThread,
  getMessages,
  approveRequest,
  markThreadSeen,
};