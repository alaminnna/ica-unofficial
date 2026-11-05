/**
 * @alaminnna/ica-unofficial — message/listen
 * 
 * RESPONSIBILITY: listen() facade: mode selection (mqtt|polling|auto) and reconnect orchestration.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./listener/*, ./threads/threads, ./normalize, ./events, client.api
 * MUST NOT:       never implement wire protocol here — that lives in listener/
 * 
 * DEBUG: when listener never starts or mode sticks at starting, start looking here — mode selection and bootstrap
 */

'use strict';

const { RealtimeClient, threadIdFromPath } = require('./listener/realtime');
const { normalizeMessage } = require('./threads/threads');
const { extractSharedItem, extractAttachments } = require('./normalize');
const { toListenEvent, isContentMessage } = require('./events');
const { createV3Tracker } = require('../listening/v3');
const { openStore } = require('../listening/store');

const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_FACTOR = 2;
const BACKOFF_MAX_MS = 60000;

// Reaction-shaped payload? (direct events carry no kind — detect by fields.)
function isReactionPayload(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (value.item_type === 'reaction') {
    return true;
  }
  let text = '';
  try {
    text = JSON.stringify(value).toLowerCase();
  } catch (ignored) {
    return false;
  }
  return text.indexOf('reaction') !== -1 &&
    (text.indexOf('emoji') !== -1 || text.indexOf('reaction_type') !== -1);
}

function reactionEmoji(value) {
  if (!value || typeof value !== 'object') {
    return '';
  }
  if (typeof value.emoji === 'string' && value.emoji) {
    return value.emoji;
  }
  const nested = value.item || value.reaction || {};
  if (nested && typeof nested.emoji === 'string' && nested.emoji) {
    return nested.emoji;
  }
  return '';
}

// Typing/presence/seen-shaped payload? NOTE: intentionally does NOT mirror
// realtime.js directEventKind's bare 'read' substring — 'threads' contains
// 'read', so that check misfires on every thread path. Structural thread
// events (create/title/members) must still reach the 'event' kind here;
// realtime.js itself is left untouched.
function isPresenceLikePayload(value, path) {
  const pathText = String(path || '').toLowerCase();
  let valueText = '';
  try {
    valueText = JSON.stringify(value).toLowerCase();
  } catch (ignored) {
    valueText = '';
  }
  if (valueText.indexOf('activity_status') !== -1 || pathText.indexOf('activity_indicator') !== -1 || pathText.indexOf('typing') !== -1) {
    return true;
  }
  if (pathText.indexOf('presence') !== -1 || valueText.indexOf('is_active') !== -1 || valueText.indexOf('last_active') !== -1) {
    return true;
  }
  if (pathText.indexOf('/seen') !== -1 || pathText.indexOf('seen_') !== -1 || valueText.indexOf('seen') !== -1) {
    return true;
  }
  if (String((value && value.action) || '').toLowerCase() === 'mark_seen') {
    return true;
  }
  return false;
}

function directValue(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  return payload.value !== undefined ? payload.value : payload;
}

// Reaction items arriving on the message path (iris item patches) would
// otherwise surface as hollow 'message' events — route them to 'reaction'.
function toReactionMessageEvent(payload) {
  const inner = (payload && payload.message) || {};
  const value = inner.value !== undefined ? inner.value : inner;
  const item = (value && value.item) || value || {};
  if (!item || typeof item !== 'object') {
    return null;
  }
  const hasBody = Boolean(item.text || item.media || item.media_share || item.clip ||
    item.voice_media || item.visual_media || item.animated_media || item.like);
  if (item.item_type !== 'reaction' && (!isReactionPayload(item) || hasBody)) {
    return null;
  }
  const threadId = inner.thread_id || item.thread_id || null;
  const targetId = item.item_id || item.id || null;
  const reactor = item.user_id || null;
  if (!threadId || !targetId || !reactor) {
    return null;
  }
  const emoji = reactionEmoji(item) || reactionEmoji(value) || item.text || '';
  return {
    thread_id: String(threadId),
    message: {
      thread_id: String(threadId),
      id: String(targetId),
      user_id: String(reactor),
      text: emoji,
      timestamp: item.timestamp,
      reaction: { emoji, targetID: String(targetId) },
    },
  };
}

// action_log items are attributed group events, never messages.
function toActionLogEvent(payload) {
  const inner = (payload && payload.message) || {};
  const value = inner.value !== undefined ? inner.value : inner;
  const item = (value && value.item) || value || {};
  if (!item || item.item_type !== 'action_log') {
    return null;
  }
  const threadId = inner.thread_id || item.thread_id || null;
  if (!threadId) {
    return null;
  }
  return {
    thread_id: String(threadId),
    message: {
      thread_id: String(threadId),
      id: item.item_id || item.id || null,
      user_id: item.user_id || null,
      timestamp: item.timestamp,
      text: '',
      action_log: item.action_log || null,
    },
  };
}
function classifyDirectEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const value = directValue(payload);
  const item = (value && typeof value === 'object' && value.item) || null;
  const path = String(payload.path || '');
  const isItemPatch = path.indexOf('/direct_v2/threads/') === 0 || path.indexOf('/direct_v2/inbox/threads/') === 0;
  const threadId = payload.thread_id || threadIdFromPath(path) || (item && item.thread_id) || null;
  const itemValue = item || value;
  if ((isReactionPayload(value) || isReactionPayload(item)) && threadId) {
    const targetId = (itemValue && (itemValue.item_id || itemValue.id)) || null;
    const reactor = (itemValue && itemValue.user_id) || null;
    const emoji = reactionEmoji(value) || reactionEmoji(item);
    if (targetId && reactor) {
      return {
        kind: 'reaction',
        key: 'reaction:' + targetId + ':' + reactor + ':' + emoji,
        data: {
          thread_id: String(threadId),
          message: {
            thread_id: String(threadId),
            id: String(targetId),
            user_id: String(reactor),
            text: emoji,
            timestamp: Date.now(),
            reaction: { emoji, targetID: String(targetId) },
          },
        },
      };
    }
    return null;
  }
  if (isItemPatch && item) {
    return null;
  }
  if (isPresenceLikePayload(value, path)) {
    return null;
  }
  if (!threadId) {
    return null;
  }
  return {
    kind: 'event',
    key: 'event:' + threadId + ':' + String(payload.op || path || 'x'),
    data: {
      thread_id: String(threadId),
      message: {
        thread_id: String(threadId),
        ...(value && typeof value === 'object' ? value : { value }),
      },
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt) {
  const delay = BACKOFF_INITIAL_MS * Math.pow(BACKOFF_FACTOR, attempt);
  const capped = Math.min(delay, BACKOFF_MAX_MS);
  const jitter = capped * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

async function fetchSyncState(client) {
  const res = await client.api.request({
    method: 'GET',
    endpoint: 'direct_v2/inbox/',
    params: {
      visual_message_return_type: 'unseen',
      thread_message_limit: '1',
      persistentBadging: 'true',
      limit: '1',
      is_prefetching: 'false',
      fetch_reason: 'initial_snapshot',
    },
  });
  const data = res || {};
  if (data.seq_id === undefined || data.snapshot_at_ms === undefined) {
    throw new Error('@alaminnna/ica-unofficial: inbox did not return realtime sync state');
  }
  const pending = {};
  ((data.inbox || {}).threads || []).forEach((thread) => {
    if (thread.thread_id) {
      pending[String(thread.thread_id)] = Boolean(thread.pending);
    }
  });
  return { seqId: data.seq_id, snapshotAtMs: data.snapshot_at_ms, pending };
}

function messageFromSync(message) {
  const value = message.message || {};
  const threadId = message.thread_id || value.thread_id || threadIdFromPath(value.path || message.path || '');
  const item = value.item || value;
  const normalized = normalizeMessage({
    item_id: item.item_id || item.id,
    thread_id: threadId,
    user_id: item.user_id,
    timestamp: item.timestamp,
    item_type: item.item_type,
    text: item.text,
    ...item,
  }, threadId);
  const shared = extractSharedItem(item);
  const withShared = shared ? { ...normalized, sharedItem: shared } : normalized;
  const withAttachments = { ...withShared, attachments: extractAttachments(item) };
  return { ...message, message: { ...value, ...withAttachments }, ...withAttachments, thread_id: threadId };
}

async function listen(client, onEvent, options) {
  const opts = options || {};
  const debug = (...args) => {
    if (opts.debug !== true) {
      return;
    }
    if (client && client.clientLog && typeof client.clientLog.debug === 'function') {
      client.clientLog.debug('[listen]', ...args);
    } else {
      console.log('[@alaminnna/ica-unofficial:listen]', ...args);
    }
  };
  const seen = new Map();
  let stopped = false;
  let attempt = 0;
  let rt = null;
  const pendingThreads = {};
  let storeOpened = false;
  let store = opts.listeningStore !== undefined ? opts.listeningStore : undefined;
  if (store === undefined) {
    if (opts.store === false) {
      store = null;
    } else {
      try {
        store = openStore({});
        storeOpened = true;
      } catch (ignored) {
        store = null;
      }
    }
  }
  const v3 = createV3Tracker({
    client,
    store,
    emit: (kind, data) => emit(kind, data),
    attributionWindowMs: opts.attributionWindowMs,
    derivedBotEvents: opts.derivedBotEvents,
  });

  function remember(key) {
    if (!key) {
      return true;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.set(key, 1);
    if (seen.size > 500) {
      const oldest = seen.keys().next().value;
      seen.delete(oldest);
    }
    return true;
  }

  function debugRawItem(payload) {
    const inner = (payload && payload.message) || {};
    const value = inner.value !== undefined ? inner.value : inner;
    const item = (value && value.item) || value || {};
    debug('raw item: type=' + (item.item_type || '(none)') + ' user_id=' + (item.user_id === undefined || item.user_id === null || item.user_id === '' ? 'missing' : 'present') + ' item_id=' + (item.item_id || item.id || '(none)') + ' body=' + (item.text || item.media || item.media_share ? 'yes' : 'no'));
  }

  function emit(kind, data) {
    if (kind === 'message' && data) {
      const inner = data.message || {};
      if (!isContentMessage(inner)) {
        debug('drop non-message item: type=' + ((inner && inner.item_type) || '(none)') + ' user_id=' + ((inner && inner.user_id !== undefined && inner.user_id !== null && inner.user_id !== '') ? 'present' : 'missing'));
        return;
      }
      const id = inner.id || inner.item_id || data.id || data.item_id;
      if (id && !remember('message:' + String(id))) {
        return;
      }
    }
    if (kind === 'event' && data) {
      const inner = data.message || {};
      const fingerprint = inner.op || inner.path || data.op || data.path ||
        JSON.stringify(inner).slice(0, 120);
      if (!remember('event:' + String(data.thread_id || inner.thread_id || '?') + ':' + fingerprint)) {
        return;
      }
    }
    if (data && typeof data === 'object' && (kind.indexOf('group:') === 0 || kind.indexOf('bot:') === 0 ||
      kind === 'nickname:update' || kind === 'message:system')) {
      const inner = data.message || {};
      const fingerprint = inner.id || inner.op || JSON.stringify(inner).slice(0, 120);
      if (!remember(kind + ':' + String(data.thread_id || inner.thread_id || '?') + ':' + fingerprint)) {
        return;
      }
    }
    if (data && typeof data === 'object' && (kind === 'message' || kind === 'thread_update' || kind === 'event' || kind === 'reaction' || kind === 'typing' || kind === 'presence' || kind === 'seen' ||
      kind.indexOf('group:') === 0 || kind.indexOf('bot:') === 0 || kind === 'nickname:update' || kind === 'message:system')) {
      const inner = data.message || {};
      const threadId = data.thread_id || inner.thread_id;
      if (threadId && pendingThreads[String(threadId)]) {
        data.isPendingRequest = true;
      }
    }
    const evt = toListenEvent(kind, data);
    const extras = [];
    if (kind === 'message') {
      v3.afterMessage(data).forEach((extra) => {
        if (extra.kind === '__attach') {
          extra.patch(evt);
        } else {
          extras.push(extra);
        }
      });
    } else if (kind === 'reaction') {
      v3.afterReaction(data).forEach((extra) => extras.push(extra));
    } else if (kind === 'event') {
      const inner = data.message || {};
      if (inner.action_log) {
        v3.noteActionLog({ ...inner, user_id: inner.user_id }, data.thread_id || inner.thread_id);
      }
    }
    onEvent(evt);
    extras.forEach((extra) => emit(extra.kind, extra.data));
  }

  function emitSessionExpired() {
    onEvent({ type: 'session_expired', threadID: null, messageID: null, senderID: null, body: '', timestamp: Date.now(), isGroup: false, attachments: [], mentions: {}, raw: null });
  }

  async function connectOnce() {
    const api = {
      sessionid: client.sessionid,
      phoneId: client.phoneId,
      userAgent: client.userAgent,
      userId: client.userId,
      appVersion: client.appVersion,
      locale: client.locale,
    };
    const singleton = (!opts.realtimeClient && typeof client.realtimeConnect === 'function')
      ? client.realtimeConnect()
      : null;
    rt = opts.realtimeClient || singleton || new RealtimeClient(api);
    if (!rt._listenBound) {
      rt.on('message', (payload) => {
        debugRawItem(payload);
        const actionLog = toActionLogEvent(payload);
        if (actionLog) {
          const inner = (payload && payload.message) || {};
          const value = inner.value !== undefined ? inner.value : inner;
          const item = (value && value.item) || value || {};
          v3.noteActionLog(item, actionLog.thread_id);
          v3.emitMappedActionLog(item, actionLog.thread_id);
          return;
        }
        const reactionMsg = toReactionMessageEvent(payload);
        if (reactionMsg) {
          if (!remember('reaction:' + reactionMsg.message.id + ':' + reactionMsg.message.user_id + ':' + reactionMsg.message.text)) {
            return;
          }
          emit('reaction', reactionMsg);
          return;
        }
        emit('message', messageFromSync(payload));
      });
      rt.on('typing', (payload) => emit('typing', payload));
      rt.on('presence', (payload) => emit('presence', payload));
      rt.on('seen', (payload) => emit('seen', payload));
      rt.on('thread_update', (payload) => {
        if (v3.isCoveredThreadUpdate(payload)) {
          return;
        }
        emit('event', payload);
      });
      rt.on('direct', (payload) => {
        const directValue = payload && typeof payload === 'object'
          ? (payload.value !== undefined ? payload.value : payload)
          : null;
        if (directValue && typeof directValue === 'object') {
          const item = directValue.item || directValue;
          v3.noteActionLog(item, payload.thread_id || item.thread_id);
          v3.trackThread(item);
          v3.emitMappedActionLog(item, payload.thread_id || item.thread_id);
        }
        const classified = classifyDirectEvent(payload);
        if (!classified) {
          return;
        }
        if (classified.key && !remember(classified.key)) {
          return;
        }
        emit(classified.kind, classified.data);
      });
      rt.on('typing', (payload) => emit('typ', payload));
      rt.on('seen', (payload) => emit('read_receipt', payload));
      rt._listenBound = true;
    }
    await rt.connect();
    client._realtime = rt;
    if (rt.lastSeqId !== null && rt.lastSeqId !== undefined
      && rt.lastSnapshotAtMs !== null && rt.lastSnapshotAtMs !== undefined
      && opts.resume !== false) {
      await rt.irisSubscribe(rt.lastSeqId, rt.lastSnapshotAtMs);
      debug('[REALTIME] resumed seq=' + rt.lastSeqId);
    } else if (opts.bootstrap !== false) {
      const sync = await fetchSyncState(client);
      Object.keys(sync.pending || {}).forEach((id) => {
        pendingThreads[id] = sync.pending[id];
      });
      await rt.irisSubscribe(sync.seqId, sync.snapshotAtMs);
      debug('[REALTIME] subscribed seq=' + sync.seqId);
    }
    debug('[REALTIME] connected');
  }

  const listenMode = opts.listenMode || 'auto';
  let activeMode = 'starting';
  let modeReason = 'connecting';
  const dropTimes = [];
  let pollStop = null;

  function noteDrop() {
    const now = Date.now();
    const windowMs = opts.dropWindowMs || 120000;
    dropTimes.push(now);
    while (dropTimes.length > 0 && now - dropTimes[0] > windowMs) {
      dropTimes.shift();
    }
    return dropTimes.length;
  }

  function isSessionExpiredMessage(msg) {
    return msg.indexOf('login') !== -1 || msg.indexOf('Login') !== -1 || msg.indexOf('session') !== -1;
  }

  let watchdog = null;
  function stopWatchdog() {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }
  function startWatchdog() {
    stopWatchdog();
    if (opts.keepalive === false) {
      return;
    }
    const intervalMs = opts.keepaliveMs || 15000;
    watchdog = setInterval(() => {
      (async () => {
        if (stopped || !rt || rt.connected !== true || typeof rt.ping !== 'function') {
          return;
        }
        if (activeMode !== 'mqtt') {
          return;
        }
        try {
          const ok = await rt.ping(3);
          if (!ok) {
            throw new Error('@alaminnna/ica-unofficial: keepalive ping failed');
          }
        } catch (err) {
          debug('[REALTIME] keepalive failed: ' + String((err && err.message) || err));
          try {
            rt.disconnect();
          } catch (ignored) {
            // disconnect forces readOnce to throw -> backoff reconnect path
          }
        }
      })().catch(() => {});
    }, intervalMs);
    if (watchdog.unref) {
      watchdog.unref();
    }
  }

  async function pollLoop() {
    const { startPolling } = require('./listener/polling');
    let pollDead = false;
    pollStop = startPolling(client, (event) => {
      if (event.messageID && !remember(event.messageID)) {
        return;
      }
      if (event.threadID && pendingThreads[String(event.threadID)]) {
        event.isPendingRequest = true;
      }
      onEvent(event);
    }, {
      pollIntervalMs: opts.pollIntervalMs,
      jitterMs: opts.jitterMs,
      onThreads: (threads) => {
        (threads || []).forEach((thread) => v3.trackThread(thread));
      },
      onError: (err) => {
        pollDead = true;
        debug('polling stopped: ' + ((err && err.message) || err));
      },
    });
    while (!stopped && !pollDead) {
      await sleep(1000);
    }
  }

  async function loop() {
    if (listenMode === 'polling') {
      activeMode = 'polling';
      modeReason = 'manual polling mode';
      await pollLoop();
      return;
    }
    while (!stopped) {
      try {
        await connectOnce();
        attempt = 0;
        activeMode = 'mqtt';
        modeReason = 'connected';
        startWatchdog();
        while (!stopped) {
          const out = await rt.readOnce();
          if (out && out.packetType === 'disconnect') {
            throw new Error('@alaminnna/ica-unofficial: server disconnect');
          }
        }
      } catch (err) {
        stopWatchdog();
        if (stopped) {
          break;
        }
        const msg = String((err && err.message) || err);
        if (msg.indexOf('login') !== -1 || msg.indexOf('Login') !== -1 || msg.indexOf('session') !== -1) {
          debug('session expired, stopping');
          try {
            if (rt) {
              rt.disconnect();
            }
          } catch (ignored) {
            // ignore disconnect errors during teardown
          }
          client._realtime = null;
          emitSessionExpired();
          stopped = true;
          break;
        }
        if (listenMode === 'auto' && noteDrop() >= (opts.maxDrops || 3)) {
          debug('degrading to polling after repeated drops');
          activeMode = 'polling';
          modeReason = 'mqtt drops within window';
          await pollLoop();
          return;
        }
        const delay = backoffDelay(attempt);
        attempt += 1;
        debug('reconnect in ' + delay + 'ms after: ' + msg);
        await sleep(delay);
      }
    }
  }

  const running = loop();
  running.catch(() => {});
  let stopCount = 0;
  function stop() {
    stopCount += 1;
    stopped = true;
    stopWatchdog();
    client._realtime = null;
    if (storeOpened && store && typeof store.close === 'function') {
      try {
        store.close();
      } catch (ignored) {
        // ignore store teardown errors
      }
      storeOpened = false;
    }
    try {
      if (rt) {
        rt.disconnect();
      }
    } catch (ignored) {
      // ignore disconnect errors during teardown
    }
    try {
      if (pollStop) {
        pollStop();
      }
    } catch (ignored) {
      // ignore polling teardown errors
    }
    return stopCount;
  }
  stop.getMode = () => activeMode;
  stop.getModeReason = () => modeReason;
  if (opts.fbnsClient) {
    if (!opts.fbnsClient._listenBound && typeof opts.fbnsClient.on === 'function') {
      opts.fbnsClient.on('push', (payload) => {
        debug('[FBNS] push ' + String((payload && payload.collapse_key) || 'unknown'));
      });
      opts.fbnsClient._listenBound = true;
    }
    await opts.fbnsClient.connect(false).catch(() => {});
  }
  return stop;
}

module.exports = { listen, listenMqtt: listen, backoffDelay, toListenEvent, fetchSyncState, classifyDirectEvent, isReactionPayload, toActionLogEvent, toReactionMessageEvent };