/**
 * @alaminnna/ica-unofficial — message/listener/fbns
 * 
 * RESPONSIBILITY: FBNS push handler: device-auth connection, token register, push events.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./mqttot, ../../core/utils, client.privateRequest
 * MUST NOT:       never log auth data
 * 
 * DEBUG: when no push events arrive or register times out, start looking here — device-auth and REG_REQUEST flow
 */

'use strict';

const mqttot = require('./mqttot');
const { uuid4 } = require('../../core/utils');

const FBNS_HOST = 'mqtt-mini.facebook.com';
const FBNS_APP_ID = 567310203415052;
const FBNS_PACKAGE = 'com.instagram.android';
const FBNS_SUBSCRIBE_TOPICS = [76, 80, 231];

function optionalInt(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = Number(value);
  return Number.isNaN(n) ? null : Math.trunc(n);
}

function stripLengthPrefixedJson(payload) {
  const body = mqttot.tryDecompress(Buffer.from(payload));
  if (body.length < 3) {
    return body;
  }
  const size = body.readUInt16BE(0);
  if (size === body.length - 2 && (body[2] === 0x7b || body[2] === 0x5b)) {
    return body.slice(2);
  }
  return body;
}

class FbnsDeviceAuth {
  constructor() {
    this.client_id = '';
    this.user_id = 0;
    this.password = '';
    this.device_id = '';
    this.device_secret = '';
    this.server_region = '';
    this.region_hint = '';
    this.raw = {};
  }

  static fromClient(api) {
    const auth = new FbnsDeviceAuth();
    const settings = (api && api.settings) || {};
    const stored = settings.fbns_auth || {};
    const phoneId = (api && api.phoneId) || '';
    auth.client_id = stored.client_id || phoneId.slice(0, 20);
    auth.user_id = Number(stored.user_id || 0);
    auth.password = stored.password || '';
    auth.device_id = stored.device_id || '';
    auth.device_secret = stored.device_secret || '';
    auth.server_region = stored.server_region || '';
    auth.region_hint = stored.region_hint || '';
    auth.raw = stored.raw || {};
    return auth;
  }

  read(payload) {
    let data = {};
    if (Buffer.isBuffer(payload)) {
      if (payload.length > 0) {
        data = JSON.parse(stripLengthPrefixedJson(payload).toString('utf8'));
      }
    } else if (typeof payload === 'string') {
      data = payload ? JSON.parse(payload) : {};
    } else if (payload && typeof payload === 'object') {
      data = { ...payload };
    }
    Object.keys(data).forEach((key) => {
      this.raw[key] = data[key];
    });
    if (data.ck !== undefined) {
      this.user_id = optionalInt(data.ck) || this.user_id;
    }
    if (data.cs !== undefined) {
      this.password = String(data.cs || '');
    }
    if (data.di !== undefined) {
      this.device_id = String(data.di || '');
      this.client_id = this.device_id.slice(0, 20);
    }
    if (data.ds !== undefined) {
      this.device_secret = String(data.ds || '');
    }
    if (data.sr !== undefined) {
      this.server_region = String(data.sr || '');
    }
    if (data.rc !== undefined) {
      this.region_hint = String(data.rc || '');
    }
    return data;
  }

  save(api) {
    if (api) {
      if (!api.settings) {
        api.settings = {};
      }
      api.settings.fbns_auth = this.toSettings();
    }
    api.fbnsAuth = this.toSettings();
  }

  toSettings() {
    return {
      client_id: this.client_id,
      user_id: this.user_id,
      password: this.password,
      device_id: this.device_id,
      device_secret: this.device_secret,
      server_region: this.server_region,
      region_hint: this.region_hint,
      raw: this.raw,
    };
  }
}class FbnsClient {
  constructor(api, transport, auth) {
    this.api = api;
    this.transport = transport || mqttot.createTransport({ host: FBNS_HOST });
    this.auth = auth || FbnsDeviceAuth.fromClient(api);
    this.connected = false;
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

  buildConnection() {
    const phoneId = (this.api && this.api.phoneId) || '';
    const clientId = this.auth.client_id || phoneId.slice(0, 20);
    if (!clientId) {
      throw new Error('@alaminnna/ica-unofficial: phoneId required for FBNS connect');
    }
    const info = {
      userId: Number(this.auth.user_id),
      userAgent: this.api.userAgent || '',
      clientCapabilities: 183,
      endpointCapabilities: 128,
      publishFormat: 1,
      noAutomaticForeground: true,
      makeUserAvailableInForeground: false,
      deviceId: this.auth.device_id,
      isInitiallyForeground: false,
      networkType: 1,
      networkSubtype: 0,
      clientMqttSessionId: Date.now() & 0xffffffff,
      subscribeTopics: FBNS_SUBSCRIBE_TOPICS,
      clientType: 'device_auth',
      appId: FBNS_APP_ID,
      deviceSecret: this.auth.device_secret,
      clientStack: 3,
      anotherUnknown: -1,
    };
    if (this.auth.password) {
      info.fbnsConnectionSecret = this.auth.password;
    }
    if (this.auth.device_id) {
      info.fbnsDeviceId = this.auth.device_id;
    }
    if (this.auth.device_secret) {
      info.fbnsDeviceSecret = this.auth.device_secret;
    }
    return { clientIdentifier: clientId, clientInfo: info, password: this.auth.password };
  }

  async connect(register) {
    await this.transport.connect();
    await this.transport.send(mqttot.connectPacket(this.buildConnection(), 60));
    const packet = mqttot.decodePacket(await this.transport.recvPacket());
    if (packet.packetType !== 'connack' || packet.returnCode !== 0) {
      throw new Error('@alaminnna/ica-unofficial: FBNS MQTT connect failed: ' + packet.returnCode);
    }
    this.auth.read(packet.payload);
    this.auth.save(this.api);
    this.emit('auth', this.auth.toSettings());
    this.connected = true;
    if (register !== false) {
      await this.subscribe(mqttot.FBNS_TOPICS.MESSAGE);
      const token = await this.registerToken();
      const response = await this.registerPushToken(token);
      this.emit('registered', { token, response });
    }
  }

  disconnect() {
    try {
      if (this.connected) {
        this.send(mqttot.disconnectPacket()).catch(() => {});
      }
    } finally {
      this.transport.disconnect();
      this.connected = false;
    }
  }

  async send(buf) {
    try {
      await this.transport.send(buf);
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async recvPacket() {
    try {
      return await this.transport.recvPacket();
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async subscribe(topic) {
    this.packetId += 1;
    await this.send(mqttot.subscribePacket(topic, this.packetId));
  }

  async publishBytes(topic, payload) {
    this.packetId += 1;
    await this.send(mqttot.publishPacket(topic, mqttot.compress(Buffer.from(payload)), 1, this.packetId));
  }

  async registerToken(maxPackets) {
    const max = maxPackets === undefined ? 10 : maxPackets;
    await this.publishBytes(mqttot.FBNS_TOPICS.REG_REQUEST, Buffer.from(JSON.stringify({
      pkg_name: FBNS_PACKAGE,
      appid: FBNS_APP_ID,
    }), 'utf8'));
    for (let i = 0; i < max; i += 1) {
      const packet = mqttot.decodePacket(await this.recvPacket());
      if (packet.packetType !== 'publish') {
        continue;
      }
      if (packet.topic === mqttot.FBNS_TOPICS.REG_RESPONSE) {
        const response = parsePayload(packet.payload);
        this.ack(packet);
        this.emit('reg_response', response);
        if (response && response.error) {
          throw new Error('@alaminnna/ica-unofficial: FBNS registration failed: ' + response.error);
        }
        if (!response || !response.token) {
          throw new Error('@alaminnna/ica-unofficial: FBNS registration response did not include token');
        }
        return String(response.token);
      }
      this.dispatchPacket(packet.topic, packet.payload);
      this.ack(packet);
    }
    throw new Error('@alaminnna/ica-unofficial: FBNS registration response was not received');
  }

  async registerPushToken(token) {
    return this.api.privateRequest('push/register/', {
      device_type: 'android_mqtt',
      is_main_push_channel: true,
      device_sub_type: 2,
      device_token: token,
      _csrftoken: this.api.token,
      guid: this.api.uuid,
      uuid: this.api.uuid,
      users: String(this.api.userId),
      family_device_id: uuid4(),
    });
  }

  async readOnce() {
    const packet = mqttot.decodePacket(await this.recvPacket());
    if (packet.packetType !== 'publish' || packet.topic === null || packet.topic === undefined) {
      return packet;
    }
    const payload = this.dispatchPacket(packet.topic, packet.payload);
    this.ack(packet);
    return payload;
  }

  async ping(maxPackets) {
    if (!this.connected) {
      throw new Error('@alaminnna/ica-unofficial: FBNS client is not connected');
    }
    await this.send(mqttot.pingreqPacket());
    const max = maxPackets === undefined ? 5 : maxPackets;
    for (let i = 0; i < max; i += 1) {
      const packet = mqttot.decodePacket(await this.recvPacket());
      if (packet.packetType === 'pingresp') {
        return true;
      }
      if (packet.packetType !== 'publish' || packet.topic === null || packet.topic === undefined) {
        return false;
      }
      this.dispatchPacket(packet.topic, packet.payload);
      this.ack(packet);
    }
    return false;
  }

  dispatchPacket(topic, payload) {
    const parsed = parsePayload(payload);
    if (topic === mqttot.FBNS_TOPICS.MESSAGE) {
      return this.dispatchFbnsMessage(parsed);
    }
    if (topic === mqttot.FBNS_TOPICS.REG_RESPONSE) {
      this.emit('reg_response', parsed);
    } else if (topic === mqttot.FBNS_TOPICS.EXP_LOGGING) {
      this.emit('logging', parsed);
    } else if (topic === mqttot.FBNS_TOPICS.PP) {
      this.emit('pp', parsed);
    } else {
      this.emit('message', parsed);
    }
    this.emit('receive', { topic, payload: parsed });
    return parsed;
  }

  dispatchFbnsMessage(payload) {
    if (!payload || typeof payload !== 'object') {
      this.emit('message', payload);
      return payload;
    }
    let push = payload.fbpushnotif;
    if (push === undefined || push === null) {
      this.emit('message', payload);
      return payload;
    }
    if (typeof push === 'string') {
      try {
        push = JSON.parse(push);
      } catch (err) {
        push = { value: push };
      }
    }
    this.emit('push', push);
    if (push && typeof push === 'object' && push.collapse_key) {
      this.emit(String(push.collapse_key), push);
    }
    return push;
  }

  ack(packet) {
    if (packet.qos === 1 && packet.packetId !== null && packet.packetId !== undefined) {
      this.send(mqttot.pubackPacket(packet.packetId)).catch(() => {});
    }
  }
}

function parsePayload(payload) {
  const body = stripLengthPrefixedJson(payload);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch (err) {
    return body;
  }
}

function maskSecrets(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }
  if (value.length <= 6) {
    return '***';
  }
  return '***' + value.slice(-3);
}

function maskFbnsAuth(auth) {
  const source = (auth && typeof auth.toSettings === 'function') ? auth.toSettings() : (auth || {});
  return {
    client_id: source.client_id || '',
    user_id: source.user_id || 0,
    password: maskSecrets(source.password),
    device_id: maskSecrets(source.device_id),
    device_secret: maskSecrets(source.device_secret),
    server_region: source.server_region || '',
    region_hint: source.region_hint || '',
  };
}

module.exports = { FbnsDeviceAuth, FbnsClient, maskFbnsAuth, FBNS_HOST, FBNS_APP_ID, FBNS_PACKAGE, FBNS_SUBSCRIBE_TOPICS };