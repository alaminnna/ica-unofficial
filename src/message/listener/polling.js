/**
 * @alaminnna/ica-unofficial — message/listener/polling
 * 
 * RESPONSIBILITY: polling fallback: inbox snapshot diff when MQTT is unavailable.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../threads/threads, client.api
 * MUST NOT:       never touch realtime state
 * 
 * DEBUG: when messages arrive late but MQTT says connected, start looking here — fallback interval/cursor
 */

'use strict';

const { normalizeMessage } = require('../threads/threads');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startPolling(client, onEvent, options) {
  const opts = options || {};
  const interval = opts.pollIntervalMs || 3000;
  const jitter = opts.jitterMs === undefined ? 500 : opts.jitterMs;
  const amount = opts.amount || 20;
  let stopped = false;
  const newestByThread = {};
  let firstPoll = true;

  async function pollOnce() {
    const res = await client.api.request({
      method: 'GET',
      endpoint: 'direct_v2/inbox/',
      params: {
        visual_message_return_type: 'unseen',
        thread_message_limit: '1',
        persistentBadging: 'true',
        limit: String(amount),
        is_prefetching: 'false',
        fetch_reason: 'initial_snapshot',
      },
    });
    const threads = (((res || {}).inbox) || {}).threads || [];
    if (typeof opts.onThreads === 'function') {
      try {
        opts.onThreads(threads);
      } catch (ignored) {
        // snapshot feeding must never break polling
      }
    }
    threads.forEach((thread) => {
      const threadId = String(thread.thread_id);
      const newest = (thread.items || [])[0];
      if (!newest || !newest.item_id) {
        return;
      }
      const id = String(newest.item_id);
      if (firstPoll) {
        newestByThread[threadId] = id;
        return;
      }
      if (newestByThread[threadId] === id) {
        return;
      }
      newestByThread[threadId] = id;
      const normalized = normalizeMessage({ ...newest, thread_id: threadId }, threadId);
      onEvent({
        type: 'message',
        threadID: threadId,
        messageID: normalized.id,
        senderID: normalized.user_id,
        body: normalized.text || '',
        timestamp: normalized.timestamp,
        isGroup: Boolean(thread.is_group),
        isPendingRequest: Boolean(thread.pending),
        attachments: [],
        mentions: {},
        raw: newest,
      });
    });
    firstPoll = false;
  }

  async function loop() {
    while (!stopped) {
      try {
        await pollOnce();
      } catch (err) {
        if (opts.onError) {
          opts.onError(err);
        }
        stopped = true;
        break;
      }
      const wait = Math.max(0, interval + Math.floor(Math.random() * (2 * jitter + 1)) - jitter);
      await sleep(wait);
    }
  }

  loop().catch(() => {});
  return function stop() {
    stopped = true;
  };
}

module.exports = { startPolling };