/**
 * @alaminnna/ica-unofficial — message/listener/realtime
 * 
 * RESPONSIBILITY: MQTT orchestrator: RealtimeClient (connect, subscribe, direct actions, dispatch).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./mqttot, client session/device fields
 * MUST NOT:       never import the HTTP layer (core/http)
 * 
 * DEBUG: when drops/reconnect loops or seq gaps appear, start looking here — orchestration and resume state
 */

'use strict';

const crypto = require('node:crypto');
const mqttot = require('./mqttot');
const { RealtimeNotConnected } = require('../../exceptions');

function newClientContext() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return String(Date.now()) + '-' + String(Math.floor(Math.random() * 1e9));
}

const REALTIME_HOST = 'edge-mqtt.facebook.com';
const REALTIME_APP_ID = 567067343352427;
const SUBSCRIBE_TOPICS = [88, 135, 149, 150, 133, 146];
const EVERCLEAR = {
  inapp_notification_subscribe_comment: '17899377895239777',
  inapp_notification_subscribe_comment_mention_and_reply: '17899377895239777',
  video_call_participant_state_delivery: '17977239895057311',
  presence_subscribe: '17846944882223835',
};

function compactJson(obj) {
  return JSON.stringify(obj);
}

class RealtimeClient {
  constructor(api, transport) {
    this.api = api;
    this.transport = transport || mqttot.createTransport({ host: REALTIME_HOST });
    this.connected = false;
    this.connectedSince = null;
    this.lastSeqId = null;
    this.lastSnapshotAtMs = null;
    this.handlers = {};
    this.packetId = 0;
  }

  on(event, handler) {
    if (!this.handlers[event]) {
      this.handlers[event] = [];
    }
    this.handlers[event].push(handler);
  }

  emit(event, payload) {
    (this.handlers[event] || []).forEach((handler) => {
      handler(payload);
    });
  }

  appVersion() {
    return this.api.appVersion || '';
  }

  buildConnection() {
    if (!this.api.sessionid) {
      throw new Error('@alaminnna/ica-unofficial: login required for realtime connect');
    }
    if (!this.api.phoneId) {
      throw new Error('@alaminnna/ica-unofficial: phoneId required for realtime connect');
    }
    return {
      clientIdentifier: String(this.api.phoneId).slice(0, 20),
      clientInfo: {
        userId: Number(this.api.userId),
        userAgent: this.api.userAgent,
        clientCapabilities: 183,
        endpointCapabilities: 0,
        publishFormat: 1,
        noAutomaticForeground: false,
        makeUserAvailableInForeground: true,
        deviceId: this.api.phoneId,
        isInitiallyForeground: true,
        networkType: 1,
        networkSubtype: 0,
        clientMqttSessionId: Date.now() & 0xffffffff,
        subscribeTopics: SUBSCRIBE_TOPICS,
        clientType: 'cookie_auth',
        appId: REALTIME_APP_ID,
        deviceSecret: '',
        clientStack: 3,
      },
      password: 'sessionid=' + this.api.sessionid,
      appSpecificInfo: {
        app_version: this.appVersion(),
        'X-IG-Capabilities': '3brTv10=',
        everclear_subscriptions: compactJson(EVERCLEAR),
        'User-Agent': this.api.userAgent,
        'Accept-Language': String(this.api.locale || 'en_US').replace('_', '-'),
        platform: 'android',
        ig_mqtt_route: 'django',
        pubsub_msg_type_blacklist: 'direct, typing_type',
        auth_cache_enabled: '0',
      },
    };
  }

  async connect() {
    await this.transport.connect();
    await this.transport.send(mqttot.connectPacket(this.buildConnection(), 20));
    const packet = mqttot.decodePacket(await this.transport.recvPacket());
    if (packet.packetType !== 'connack' || packet.returnCode !== 0) {
      throw new Error('@alaminnna/ica-unofficial: realtime MQTT connect failed: ' + packet.returnCode);
    }
    this.connected = true;
    this.connectedSince = Date.now();
  }

  disconnect() {
    try {
      if (this.connected) {
        this.transport.send(mqttot.disconnectPacket()).catch(() => {});
      }
    } finally {
      this.transport.disconnect();
      this.connected = false;
      this.connectedSince = null;
    }
  }

  ensureConnected() {
    if (!this.connected) {
      throw new RealtimeNotConnected();
    }
  }

  async publishBytes(topic, payload) {
    this.packetId += 1;
    await this.transport.send(mqttot.publishPacket(topic, payload, 1, this.packetId));
  }

  async publishJson(topic, obj) {
    this.ensureConnected();
    await this.publishBytes(topic, mqttot.compress(Buffer.from(compactJson(obj), 'utf8')));
  }

  async graphQlSubscribe(subscriptions) {
    const list = Array.isArray(subscriptions) ? subscriptions : [subscriptions];
    await this.publishJson(mqttot.TOPICS.REALTIME_SUB, { sub: list });
  }

  async skywalkerSubscribe(subscriptions) {
    const list = Array.isArray(subscriptions) ? subscriptions : [subscriptions];
    await this.publishJson(mqttot.TOPICS.PUBSUB, { sub: list });
  }

  async irisSubscribe(seqId, snapshotAtMs, snapshotAppVersion) {
    await this.publishJson(mqttot.TOPICS.IRIS_SUB, {
      seq_id: seqId,
      snapshot_at_ms: snapshotAtMs,
      snapshot_app_version: snapshotAppVersion || this.appVersion(),
    });
    this.lastSeqId = seqId;
    this.lastSnapshotAtMs = snapshotAtMs;
  }

  async directSubscribe(amount) {
    const n = amount === undefined ? 1 : amount;
    let inbox = null;
    if (this.api && typeof this.api.directThreads === 'function') {
      inbox = await this.api.directThreads(n);
    } else if (this.api && this.api.clientRef && typeof this.api.clientRef.getThreads === 'function') {
      await this.api.clientRef.getThreads({ amount: n });
      inbox = (this.api.clientRef.api && this.api.clientRef.api.lastJson) || null;
    } else {
      throw new Error('@alaminnna/ica-unofficial: directSubscribe needs HTTP client — use listen() bootstrap instead');
    }
    const seqId = inbox.seq_id !== undefined ? inbox.seq_id : inbox.seqId;
    const snapshotAtMs = inbox.snapshot_at_ms !== undefined ? inbox.snapshot_at_ms : inbox.snapshotAtMs;
    if (seqId === null || seqId === undefined || snapshotAtMs === null || snapshotAtMs === undefined) {
      throw new Error('@alaminnna/ica-unofficial: inbox did not return realtime sync state');
    }
    const state = { seq_id: seqId, snapshot_at_ms: snapshotAtMs };
    await this.irisSubscribe(state.seq_id, state.snapshot_at_ms);
    return state;
  }

  async directSendText(threadId, text, clientContext) {
    this.ensureConnected();
    return this.directCommand('send_item', threadId, { item_type: 'text', text }, clientContext || newClientContext());
  }

  async directSendReaction(threadId, itemId, emoji, options) {
    this.ensureConnected();
    const opts = options || {};
    return this.directCommand('send_item', threadId, {
      item_type: 'reaction',
      item_id: String(itemId),
      node_type: 'item',
      reaction_type: opts.reactionType || 'like',
      reaction_status: opts.reactionStatus || 'created',
      target_item_type: opts.targetItemType || 'text',
      emoji: emoji || '',
    }, opts.clientContext || newClientContext());
  }

  async directMarkSeen(threadId, itemId) {
    this.ensureConnected();
    return this.directCommand('mark_seen', threadId, { item_id: String(itemId) }, null);
  }

  async directIndicateActivity(threadId, isActive, clientContext) {
    this.ensureConnected();
    return this.directCommand('indicate_activity', threadId, { activity_status: isActive ? '1' : '0' }, clientContext || newClientContext());
  }

  async indicateActivity(threadId, isActive) {
    return this.directIndicateActivity(threadId, isActive);
  }

  async directCommand(action, threadId, data, clientContext) {
    this.ensureConnected();
    const payload = { action, thread_id: String(threadId), ...data };
    if (clientContext) {
      payload.client_context = clientContext;
    }
    await this.publishBytes(mqttot.TOPICS.SEND_MESSAGE, mqttot.compress(Buffer.from(compactJson(payload), 'utf8')));
    const state = { thread_id: String(threadId), action };
    if (clientContext) {
      state.client_context = clientContext;
    }
    return state;
  }  foregroundDescriptors() {
    const T = mqttot.THRIFT;
    return [
      { name: 'inForegroundApp', field: 1, type: T.BOOLEAN },
      { name: 'inForegroundDevice', field: 2, type: T.BOOLEAN },
      { name: 'keepAliveTimeout', field: 3, type: T.INT32 },
      { name: 'subscribeTopics', field: 4, type: T.LIST_BINARY },
      { name: 'subscribeGenericTopics', field: 5, type: T.LIST_BINARY },
      { name: 'unsubscribeTopics', field: 6, type: T.LIST_BINARY },
      { name: 'unsubscribeGenericTopics', field: 7, type: T.LIST_BINARY },
      { name: 'requestId', field: 8, type: T.INT64 },
    ];
  }

  async sendForegroundState(state) {
    const clean = {};
    Object.keys(state).forEach((key) => {
      if (state[key] !== null && state[key] !== undefined) {
        clean[key] = state[key];
      }
    });
    const payload = Buffer.concat([Buffer.from([0x00]), mqttot.writeThrift(clean, this.foregroundDescriptors())]);
    await this.publishBytes(mqttot.TOPICS.FOREGROUND_STATE, mqttot.compress(payload));
    return clean;
  }

  async readOnce() {
    const packet = mqttot.decodePacket(await this.transport.recvPacket());
    if (packet.packetType !== 'publish' || packet.topic === null || packet.topic === undefined) {
      return packet;
    }
    const payload = this.dispatchPacket(packet.topic, packet.payload);
    if (packet.qos === 1 && packet.packetId !== null) {
      await this.transport.send(mqttot.pubackPacket(packet.packetId));
    }
    return payload;
  }

  async ping(maxPackets) {
    if (!this.connected) {
      throw new Error('@alaminnna/ica-unofficial: realtime client is not connected');
    }
    await this.transport.send(mqttot.pingreqPacket());
    const max = maxPackets === undefined ? 5 : maxPackets;
    for (let i = 0; i < max; i += 1) {
      const packet = mqttot.decodePacket(await this.transport.recvPacket());
      if (packet.packetType === 'pingresp') {
        return true;
      }
      if (packet.packetType !== 'publish' || packet.topic === null || packet.topic === undefined) {
        return false;
      }
      this.dispatchPacket(packet.topic, packet.payload);
      if (packet.qos === 1 && packet.packetId !== null) {
        await this.transport.send(mqttot.pubackPacket(packet.packetId));
      }
    }
    return false;
  }

  dispatchPacket(topic, payload) {
    const body = mqttot.tryDecompress(payload);
    let parsed = null;
    if (topic === mqttot.TOPICS.SEND_MESSAGE_RESPONSE
      || topic === mqttot.TOPICS.IRIS_SUB_RESPONSE
      || topic === mqttot.TOPICS.REALTIME_SUB
      || topic === mqttot.TOPICS.MESSAGE_SYNC) {
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch (err) {
        parsed = body;
      }
    } else {
      try {
        parsed = JSON.parse(mqttot.tryDecompress(payload).toString('utf8'));
      } catch (err) {
        parsed = body;
      }
    }
    this.emit('receive', { topic, payload: parsed });
    if (topic === mqttot.TOPICS.SEND_MESSAGE_RESPONSE) {
      this.emit('send_response', parsed);
    }
    if (topic === mqttot.TOPICS.IRIS_SUB_RESPONSE) {
      this.emit('iris_sub_response', parsed);
    }
    if (topic === mqttot.TOPICS.MESSAGE_SYNC) {
      this.dispatchMessageSync(parsed);
    }
    if (topic === mqttot.TOPICS.REALTIME_SUB) {
      this.dispatchRealtimeSub(parsed);
    }
    return parsed;
  }

  dispatchMessageSync(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      if (payload.seq_id !== undefined && payload.seq_id !== null) {
        this.lastSeqId = payload.seq_id;
      } else if (payload.seqId !== undefined && payload.seqId !== null) {
        this.lastSeqId = payload.seqId;
      }
    }
    if (!Array.isArray(payload)) {
      this.emit('message', payload);
      return;
    }
    payload.forEach((item) => {
      if (!item || typeof item !== 'object' || !Array.isArray(item.data)) {
        this.emit('iris', item);
        return;
      }
      const meta = {};
      Object.keys(item).forEach((key) => {
        if (key !== 'data') {
          meta[key] = item[key];
        }
      });
      item.data.forEach((patch) => {
        if (!patch || typeof patch !== 'object' || !patch.path || patch.value === null || patch.value === undefined) {
          this.emit('iris', { ...meta, ...patch });
          return;
        }
        let value = patch.value;
        if (typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch (err) {
            value = { value };
          }
        }
        const wrapper = {
          ...meta,
          message: {
            path: patch.path,
            op: patch.op,
            thread_id: threadIdFromPath(patch.path),
            ...(typeof value === 'object' ? value : { value }),
          },
        };
        if (String(patch.path).startsWith('/direct_v2/threads/')) {
          this.emit('message', wrapper);
        } else {
          this.emit('thread_update', wrapper);
        }
        this.dispatchDirectEvent({ path: patch.path, op: patch.op, value });
      });
    });
  }

  dispatchRealtimeSub(payload) {
    this.emit('realtime_sub', payload);
    if (!payload || typeof payload !== 'object') {
      return;
    }
    const message = payload.message;
    if (typeof message === 'string') {
      try {
        this.dispatchDirectPayload(JSON.parse(message));
      } catch (err) {
        return;
      }
      return;
    }
    if (!message || typeof message !== 'object' || message.topic !== 'direct') {
      return;
    }
    let direct = message.json !== undefined ? message.json : message.payload;
    if (typeof direct === 'string') {
      try {
        direct = JSON.parse(direct);
      } catch (err) {
        direct = { value: direct };
      }
    }
    this.dispatchDirectPayload(direct);
  }

  dispatchDirectPayload(payload) {
    if (!payload || typeof payload !== 'object') {
      this.dispatchDirectEvent({ value: payload });
      return;
    }
    if (!Array.isArray(payload.data)) {
      this.dispatchDirectEvent(payload);
      return;
    }
    const meta = {};
    Object.keys(payload).forEach((key) => {
      if (key !== 'data') {
        meta[key] = payload[key];
      }
    });
    payload.data.forEach((item) => {
      if (item && typeof item === 'object') {
        this.dispatchDirectEvent({ ...meta, ...item });
      } else {
        this.dispatchDirectEvent({ ...meta, value: item });
      }
    });
  }

  dispatchDirectEvent(event) {
    const evt = { ...event };
    if (typeof evt.value === 'string') {
      try {
        evt.value = JSON.parse(evt.value);
      } catch (err) {
        // keep raw string
      }
    }
    if (evt.path && !evt.thread_id) {
      evt.thread_id = threadIdFromPath(evt.path);
    }
    this.emit('direct', evt);
    const kind = directEventKind(evt);
    if (kind) {
      this.emit(kind, evt);
    }
  }
}

function threadIdFromPath(path) {
  const threadPrefix = '/direct_v2/threads/';
  if (String(path).startsWith(threadPrefix)) {
    return String(path).slice(threadPrefix.length).split('/', 1)[0];
  }
  const inboxPrefix = '/direct_v2/inbox/threads/';
  if (String(path).startsWith(inboxPrefix)) {
    return String(path).slice(inboxPrefix.length).split('/', 1)[0];
  }
  return null;
}

function directEventKind(event) {
  const path = String(event.path || '').toLowerCase();
  const action = String(event.action || '').toLowerCase();
  const value = event.value;
  const valueText = value && typeof value === 'object'
    ? JSON.stringify(value).toLowerCase()
    : String(value).toLowerCase();
  if (valueText.indexOf('activity_status') !== -1 || path.indexOf('activity_indicator') !== -1 || path.indexOf('typing') !== -1) {
    return 'typing';
  }
  if (path.indexOf('presence') !== -1 || valueText.indexOf('is_active') !== -1 || valueText.indexOf('last_active') !== -1) {
    return 'presence';
  }
  if (action === 'mark_seen' || path.indexOf('/seen') !== -1 || path.indexOf('seen_') !== -1 || path.indexOf('read') !== -1 || valueText.indexOf('seen') !== -1) {
    return 'seen';
  }
  return null;
}

module.exports = { RealtimeClient, RealtimeNotConnected, newClientContext, REALTIME_HOST, REALTIME_APP_ID, SUBSCRIBE_TOPICS, threadIdFromPath };