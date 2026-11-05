/**
 * @alaminnna/ica-unofficial — message/listener/mqttot
 * 
 * RESPONSIBILITY: raw MQTT+Thrift wire client: packets, topics, compress, thrift encode/decode.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:net, node:tls, node:zlib only
 * MUST NOT:       never import anything from src/
 * 
 * DEBUG: when listener never connects, TLS errors, or decode crashes, start looking here — wire format
 */

'use strict';

const net = require('node:net');
const tls = require('node:tls');
const zlib = require('node:zlib');

const TOPICS = {
  PUBSUB: '88',
  FOREGROUND_STATE: '102',
  SEND_MESSAGE: '132',
  SEND_MESSAGE_RESPONSE: '133',
  IRIS_SUB: '134',
  IRIS_SUB_RESPONSE: '135',
  MESSAGE_SYNC: '146',
  REALTIME_SUB: '149',
  REGION_HINT: '150',
};

const FBNS_TOPICS = {
  MESSAGE: '76',
  REG_REQUEST: '79',
  REG_RESPONSE: '80',
  EXP_LOGGING: '231',
  PP: '34',
};

const THRIFT = {
  STOP: 0x00,
  TRUE: 0x01,
  FALSE: 0x02,
  BYTE: 0x03,
  INT16: 0x04,
  INT32: 0x05,
  INT64: 0x06,
  INT_16: 0x04,
  INT_32: 0x05,
  INT_64: 0x06,
  BINARY: 0x08,
  LIST: 0x09,
  MAP: 0x0b,
  STRUCT: 0x0c,
  BOOLEAN: 0xa1,
  LIST_INT32: (0x05 << 8) | 0x09,
  LIST_BINARY: (0x08 << 8) | 0x09,
  MAP_BINARY_BINARY: (0x88 << 8) | 0x0b,
};

function compress(buf) {
  return zlib.deflateSync(buf, { level: 9 });
}

function tryDecompress(buf) {
  if (!buf || buf.length === 0 || buf[0] !== 0x78) {
    return buf;
  }
  try {
    return zlib.inflateSync(buf);
  } catch (err) {
    return buf;
  }
}

function writeUtf8(str) {
  const body = Buffer.from(str, 'utf8');
  const out = Buffer.alloc(2 + body.length);
  out.writeUInt16BE(body.length, 0);
  body.copy(out, 2);
  return out;
}

function encodeRemainingLength(n) {
  const out = [];
  do {
    let digit = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) {
      digit |= 0x80;
    }
    out.push(digit);
  } while (n > 0);
  return Buffer.from(out);
}

function decodeRemainingLength(buf, offset) {
  let multiplier = 1;
  let value = 0;
  let pos = offset;
  let digit;
  do {
    digit = buf[pos];
    pos += 1;
    value += (digit & 0x7f) * multiplier;
    multiplier *= 128;
  } while ((digit & 0x80) !== 0);
  return { value, offset: pos };
}

function readUtf8(buf, offset) {
  const len = buf.readUInt16BE(offset);
  return { value: buf.toString('utf8', offset + 2, offset + 2 + len), offset: offset + 2 + len };
}

function zigzag(value, bits) {
  const big = typeof value === 'bigint' ? value : BigInt(String(value));
  const shift = BigInt(bits) - BigInt(1);
  return (big << BigInt(1)) ^ (big >> shift);
}

class ThriftWriter {
  constructor() {
    this.buffer = [];
    this.fieldStack = [];
    this.field = 0;
  }

  writeStop() {
    this.buffer.push(Buffer.from([THRIFT.STOP]));
    if (this.fieldStack.length > 0) {
      this.field = this.fieldStack.pop();
    }
  }

  writeField(field, fieldType) {
    const delta = field - this.field;
    const type = fieldType & 0x0f;
    if (delta > 0 && delta <= 15) {
      this.buffer.push(Buffer.from([(delta << 4) | type]));
    } else {
      this.buffer.push(Buffer.from([type]));
      this.writeVarint(zigzag(field, 16));
    }
    this.field = field;
  }

  writeVarint(value) {
    let big = typeof value === 'bigint' ? value : BigInt(String(value));
    for (;;) {
      if ((big & ~BigInt(0x7f)) === BigInt(0)) {
        this.buffer.push(Buffer.from([Number(big)]));
        return;
      }
      this.buffer.push(Buffer.from([Number(big & BigInt(0x7f)) | 0x80]));
      big >>= BigInt(7);
    }
  }

  writeStringDirect(value) {
    const raw = Buffer.from(String(value), 'utf8');
    this.writeVarint(raw.length);
    this.buffer.push(raw);
  }

  writeString(field, value) {
    this.writeField(field, THRIFT.BINARY);
    this.writeStringDirect(value);
  }

  writeBool(field, value) {
    this.writeField(field, value ? THRIFT.TRUE : THRIFT.FALSE);
  }

  writeInt(field, value, bits) {
    const fieldType = bits === 8 ? THRIFT.BYTE : bits === 16 ? THRIFT.INT_16 : bits === 32 ? THRIFT.INT_32 : THRIFT.INT_64;
    this.writeField(field, fieldType);
    if (bits === 8) {
      this.buffer.push(Buffer.from([Number(value) & 0xff]));
    } else if (bits === 64) {
      this.writeVarint(zigzag(value, 64));
    } else {
      this.writeVarint(zigzag(value, bits));
    }
  }

  pushStruct(field) {
    this.writeField(field, THRIFT.STRUCT);
    this.fieldStack.push(this.field);
    this.field = 0;
  }

  bytes() {
    return Buffer.concat(this.buffer);
  }
}

function writeThriftList(writer, itemType, values) {
  const size = values.length;
  if (size < 0x0f) {
    writer.buffer.push(Buffer.from([(size << 4) | itemType]));
  } else {
    writer.buffer.push(Buffer.from([0xf0 | itemType]));
    writer.writeVarint(size);
  }
  values.forEach((item) => {
    if (itemType === THRIFT.INT_32) {
      writer.writeVarint(zigzag(Number(item), 32));
    } else if (itemType === THRIFT.BINARY) {
      writer.writeStringDirect(String(item));
    } else {
      throw new Error('@alaminnna/ica-unofficial: unsupported thrift list type ' + itemType);
    }
  });
}

function writeThriftMap(writer, field, values) {
  writer.writeField(field, THRIFT.MAP);
  const keys = Object.keys(values || {});
  writer.writeVarint(keys.length);
  if (keys.length === 0) {
    return;
  }
  writer.buffer.push(Buffer.from([(THRIFT.BINARY << 4) | THRIFT.BINARY]));
  keys.forEach((key) => {
    writer.writeStringDirect(key);
    writer.writeStringDirect(String(values[key]));
  });
}

function writeThriftStruct(writer, obj, descriptors) {
  const byName = {};
  descriptors.forEach((desc) => {
    byName[desc.name] = desc;
  });
  Object.keys(obj).forEach((name) => {
    const value = obj[name];
    if (value === null || value === undefined) {
      return;
    }
    const desc = byName[name];
    const thriftType = desc.type & 0xff;
    if (thriftType === THRIFT.BOOLEAN) {
      writer.writeBool(desc.field, Boolean(value));
    } else if (thriftType === THRIFT.BYTE) {
      writer.writeInt(desc.field, Number(value), 8);
    } else if (thriftType === THRIFT.INT_16) {
      writer.writeInt(desc.field, Number(value), 16);
    } else if (thriftType === THRIFT.INT_32) {
      writer.writeInt(desc.field, Number(value), 32);
    } else if (thriftType === THRIFT.INT_64) {
      writer.writeInt(desc.field, value, 64);
    } else if (thriftType === THRIFT.BINARY) {
      writer.writeString(desc.field, String(value));
    } else if (thriftType === THRIFT.STRUCT) {
      writer.pushStruct(desc.field);
      writeThriftStruct(writer, value, desc.children || []);
      writer.writeStop();
    } else if (thriftType === THRIFT.LIST) {
      writer.writeField(desc.field, THRIFT.LIST);
      writeThriftList(writer, desc.type >> 8, value || []);
    } else if (thriftType === THRIFT.MAP) {
      writeThriftMap(writer, desc.field, value);
    } else {
      throw new Error('@alaminnna/ica-unofficial: unsupported thrift type ' + desc.type);
    }
  });
}

function writeThrift(obj, descriptors) {
  const writer = new ThriftWriter();
  writeThriftStruct(writer, obj, descriptors);
  writer.writeStop();
  return writer.bytes();
}

function connectionDescriptors() {
  const int64 = THRIFT.INT64;
  const bin = THRIFT.BINARY;
  return [
    { name: 'clientIdentifier', field: 1, type: bin },
    { name: 'willTopic', field: 2, type: bin },
    { name: 'willMessage', field: 3, type: bin },
    {
      name: 'clientInfo', field: 4, type: THRIFT.STRUCT,
      children: [
        { name: 'userId', field: 1, type: int64 },
        { name: 'userAgent', field: 2, type: bin },
        { name: 'clientCapabilities', field: 3, type: int64 },
        { name: 'endpointCapabilities', field: 4, type: int64 },
        { name: 'publishFormat', field: 5, type: THRIFT.INT32 },
        { name: 'noAutomaticForeground', field: 6, type: THRIFT.BOOLEAN },
        { name: 'makeUserAvailableInForeground', field: 7, type: THRIFT.BOOLEAN },
        { name: 'deviceId', field: 8, type: bin },
        { name: 'isInitiallyForeground', field: 9, type: THRIFT.BOOLEAN },
        { name: 'networkType', field: 10, type: THRIFT.INT32 },
        { name: 'networkSubtype', field: 11, type: THRIFT.INT32 },
        { name: 'clientMqttSessionId', field: 12, type: int64 },
        { name: 'clientIpAddress', field: 13, type: bin },
        { name: 'subscribeTopics', field: 14, type: THRIFT.LIST_INT32 },
        { name: 'clientType', field: 15, type: bin },
        { name: 'appId', field: 16, type: int64 },
        { name: 'overrideNectarLogging', field: 17, type: THRIFT.BOOLEAN },
        { name: 'connectTokenHash', field: 18, type: bin },
        { name: 'regionPreference', field: 19, type: bin },
        { name: 'deviceSecret', field: 20, type: bin },
        { name: 'clientStack', field: 21, type: THRIFT.BYTE },
        { name: 'fbnsConnectionKey', field: 22, type: int64 },
        { name: 'fbnsConnectionSecret', field: 23, type: bin },
        { name: 'fbnsDeviceId', field: 24, type: bin },
        { name: 'fbnsDeviceSecret', field: 25, type: bin },
        { name: 'anotherUnknown', field: 26, type: int64 },
      ],
    },
    { name: 'password', field: 5, type: bin },
    { name: 'getDiffsRequests', field: 6, type: THRIFT.LIST_BINARY },
    { name: 'zeroRatingTokenHash', field: 9, type: bin },
    { name: 'appSpecificInfo', field: 10, type: THRIFT.MAP_BINARY_BINARY },
  ];
}function connectPacket(connection, keepAlive) {
  const payload = compress(writeThrift({
    clientIdentifier: connection.clientIdentifier,
    clientInfo: connection.clientInfo,
    password: connection.password,
    appSpecificInfo: connection.appSpecificInfo,
  }, connectionDescriptors()));
  const variableHeader = Buffer.concat([
    writeUtf8('MQTToT'),
    Buffer.from([3, 0xc2]),
    Buffer.from([(keepAlive >> 8) & 0xff, keepAlive & 0xff]),
  ]);
  const remaining = Buffer.concat([variableHeader, payload]);
  return Buffer.concat([Buffer.from([0x10]), encodeRemainingLength(remaining.length), remaining]);
}

function publishPacket(topic, payload, qos, packetId) {
  const q = qos || 0;
  if (q !== 0 && q !== 1) {
    throw new Error('@alaminnna/ica-unofficial: only QoS 0 and 1 supported');
  }
  let variableHeader = writeUtf8(String(topic));
  if (q === 1) {
    const id = Buffer.alloc(2);
    id.writeUInt16BE(packetId || 1, 0);
    variableHeader = Buffer.concat([variableHeader, id]);
  }
  const body = Buffer.concat([variableHeader, Buffer.from(payload)]);
  return Buffer.concat([Buffer.from([0x30 | (q << 1)]), encodeRemainingLength(body.length), body]);
}

function subscribePacket(topic, packetId) {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(packetId || 1, 0);
  const body = Buffer.concat([id, writeUtf8(String(topic)), Buffer.from([1])]);
  return Buffer.concat([Buffer.from([0x82]), encodeRemainingLength(body.length), body]);
}

function pingreqPacket() {
  return Buffer.from([0xc0, 0x00]);
}

function disconnectPacket() {
  return Buffer.from([0xe0, 0x00]);
}

function pubackPacket(packetId) {
  const id = Buffer.alloc(2);
  id.writeUInt16BE(packetId, 0);
  return Buffer.concat([Buffer.from([0x40, 0x02]), id]);
}

function decodePacket(packet) {
  const typeId = packet[0] >> 4;
  const flags = packet[0] & 0x0f;
  const decoded = decodeRemainingLength(packet, 1);
  const body = packet.slice(decoded.offset, decoded.offset + decoded.value);
  if (typeId === 2) {
    return { packetType: 'connack', returnCode: body[1], payload: body.slice(2) };
  }
  if (typeId === 3) {
    const topic = readUtf8(body, 0);
    const qos = (flags >> 1) & 0x03;
    let packetId = null;
    let pos = topic.offset;
    if (qos !== 0) {
      packetId = body.readUInt16BE(pos);
      pos += 2;
    }
    return { packetType: 'publish', topic: topic.value, qos, packetId, payload: body.slice(pos) };
  }
  if (typeId === 12) {
    return { packetType: 'pingreq', payload: body };
  }
  if (typeId === 13) {
    return { packetType: 'pingresp', payload: body };
  }
  if (typeId === 14) {
    return { packetType: 'disconnect', payload: body };
  }
  return { packetType: String(typeId), payload: body };
}

function readExact(socket, length) {
  return new Promise((resolve, reject) => {
    let acc = Buffer.alloc(0);
    function onData(chunk) {
      acc = Buffer.concat([acc, chunk]);
      if (acc.length >= length) {
        socket.removeListener('data', onData);
        socket.removeListener('error', onError);
        socket.removeListener('close', onClose);
        resolve({ data: acc.slice(0, length), rest: acc.slice(length) });
      }
    }
    function onError(err) {
      socket.removeListener('data', onData);
      reject(err);
    }
    function onClose() {
      socket.removeListener('data', onData);
      reject(new Error('@alaminnna/ica-unofficial: socket closed mid-packet'));
    }
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function readPacketFromSocket(socket, buffered) {
  let acc = buffered || Buffer.alloc(0);
  async function take(n) {
    while (acc.length < n) {
      const chunk = await readExact(socket, n - acc.length);
      acc = Buffer.concat([acc, chunk.data, chunk.rest]);
    }
    const out = acc.slice(0, n);
    acc = acc.slice(n);
    return out;
  }
  const parts = [await take(1)];
  let multiplier = 1;
  let remaining = 0;
  for (;;) {
    const byte = await take(1);
    parts.push(byte);
    const digit = byte[0];
    remaining += (digit & 0x7f) * multiplier;
    multiplier *= 128;
    if ((digit & 0x80) === 0) {
      break;
    }
  }
  parts.push(await take(remaining));
  return { packet: Buffer.concat(parts), rest: acc };
}

function createTransport(options) {
  const host = options.host;
  const port = options.port || 443;
  const useTls = options.tls !== false;
  const timeoutMs = options.timeoutMs || 30000;
  let socket = null;
  let rest = Buffer.alloc(0);
  return {
    connect() {
      return new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        if (useTls) {
          socket = tls.connect({ host, port, minVersion: 'TLSv1.2', timeout: timeoutMs }, () => {
            socket.removeListener('error', onError);
            resolve();
          });
        } else {
          socket = net.connect({ host, port, timeout: timeoutMs }, () => {
            socket.removeListener('error', onError);
            resolve();
          });
        }
        socket.once('error', onError);
      });
    },
    send(buf) {
      return new Promise((resolve, reject) => {
        socket.write(buf, (err) => (err ? reject(err) : resolve()));
      });
    },
    async recvPacket() {
      const result = await readPacketFromSocket(socket, rest);
      rest = result.rest;
      return result.packet;
    },
    disconnect() {
      if (socket) {
        socket.destroy();
        socket = null;
      }
      rest = Buffer.alloc(0);
    },
  };
}

module.exports = {
  TOPICS,
  FBNS_TOPICS,
  THRIFT,
  compress,
  tryDecompress,
  writeThrift,
  connectionDescriptors,
  connectPacket,
  publishPacket,
  subscribePacket,
  pingreqPacket,
  disconnectPacket,
  pubackPacket,
  decodePacket,
  encodeRemainingLength,
  createTransport,
};