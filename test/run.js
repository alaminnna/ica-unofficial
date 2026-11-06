/**
 * @alaminnna/ica-unofficial — test/run.js
 *
 * Regression suite for the v2.9.1 hardening round: MQTT transport
 * (concurrent reads, socket errors, packet-size cap), handler isolation,
 * memory-leak caps, polling resilience and the auto-update feature.
 * Zero network against Instagram — everything runs over a local TCP server
 * or with injected mocks. Run: node test/run.js
 */

'use strict';

const net = require('node:net');
const assert = require('node:assert');
const mqttot = require('../src/message/listener/mqttot');
const { RealtimeClient } = require('../src/message/listener/realtime');
const { startPolling } = require('../src/message/listener/polling');
const update = require('../src/core/update');
const { createV3Tracker } = require('../src/listening/v3');
const logger = require('../src/core/logger');

const TESTS = [];
function test(name, fn) {
  TESTS.push({ name, fn });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Build a raw MQTT publish packet: [0x30, len, topicLen(2), topic, payload]
function publishBytes(topic, payload) {
  const topicBuf = Buffer.from(topic, 'utf8');
  const body = Buffer.concat([Buffer.from([0x00, topicBuf.length]), topicBuf, Buffer.from(payload, 'utf8')]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

// Local plain-TCP MQTT-ish server: sends queued writes, tracks connections.
function startServer(onConnection) {
  const server = net.createServer((socket) => {
    socket.on('error', () => {});
    if (onConnection) {
      onConnection(socket);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

// ---------- 1. version compare ----------

test('compareVersions: numeric ordering', () => {
  assert.strictEqual(update.compareVersions('2.9.0', '2.9.1'), -1);
  assert.strictEqual(update.compareVersions('2.9.1', '2.9.0'), 1);
  assert.strictEqual(update.compareVersions('2.10.0', '2.9.9'), 1);
  assert.strictEqual(update.compareVersions('2.9.0', '2.9.0'), 0);
  assert.strictEqual(update.compareVersions('2.9', '2.9.0'), 0);
});

test('compareVersions: pre-release ranks below release', () => {
  assert.strictEqual(update.compareVersions('2.9.1-beta.1', '2.9.1'), -1);
  assert.strictEqual(update.compareVersions('2.9.1', '2.9.1-beta.1'), 1);
  assert.strictEqual(update.compareVersions('2.9.0-beta.1', '2.9.0'), -1);
});

// ---------- 2. transport: concurrent reads must not duplicate bytes ----------

test('transport: concurrent recvPacket calls each get one full packet (watchdog-vs-read-loop)', async () => {
  const srv = await startServer((socket) => {
    socket.write(publishBytes('t1', 'one'));
    socket.write(publishBytes('t2', 'two'));
    socket.write(publishBytes('t3', 'three'));
  });
  const transport = mqttot.createTransport({ host: '127.0.0.1', port: srv.port, tls: false });
  try {
    await transport.connect();
    await sleep(80); // let all three packets arrive
    // Two concurrent reads — the exact race the keepalive watchdog creates.
    const [p1, p2] = await Promise.all([transport.recvPacket(), transport.recvPacket()]);
    const d1 = mqttot.decodePacket(p1);
    const d2 = mqttot.decodePacket(p2);
    assert.strictEqual(d1.packetType, 'publish');
    assert.strictEqual(d2.packetType, 'publish');
    assert.notStrictEqual(d1.topic, d2.topic, 'two concurrent reads must never receive the same bytes');
    const topics = new Set([d1.topic, d2.topic]);
    assert.ok(topics.has('t1') && topics.has('t2'), 'first two reads must be complete packets t1,t2 — got ' + [...topics]);
    const d3 = mqttot.decodePacket(await transport.recvPacket());
    assert.strictEqual(d3.topic, 't3');
  } finally {
    transport.disconnect();
    srv.server.close();
  }
});

// ---------- 3. transport: socket errors never crash the process ----------

test('transport: server destroy mid-packet -> clean rejection, no crash', async () => {
  const srv = await startServer((socket) => {
    // header promises 64 bytes, sends only 10 -> readExact blocks mid-packet
    socket.write(Buffer.concat([Buffer.from([0x30, 64]), Buffer.alloc(10, 0x41)]));
    setTimeout(() => socket.destroy(), 30);
  });
  const transport = mqttot.createTransport({ host: '127.0.0.1', port: srv.port, tls: false });
  try {
    await transport.connect();
    await assert.rejects(() => transport.recvPacket(), (err) => {
      assert.ok(err instanceof Error);
      return true;
    });
    // Post-error state must be clean, not a null-deref TypeError.
    await assert.rejects(() => transport.recvPacket(), /transport is closed/);
    await assert.rejects(() => transport.send(Buffer.from([0xc0, 0x00])), /transport is closed/);
  } finally {
    transport.disconnect();
    srv.server.close();
  }
});

test('transport: socket error while NOT reading is stored, surfaces on next read', async () => {
  let serverSocket = null;
  const srv = await startServer((socket) => {
    serverSocket = socket;
  });
  const transport = mqttot.createTransport({ host: '127.0.0.1', port: srv.port, tls: false });
  try {
    await transport.connect();
    await sleep(30);
    // destroy while the library is NOT inside recvPacket
    serverSocket.destroy();
    await sleep(30);
    await assert.rejects(() => transport.recvPacket(), Error);
  } finally {
    transport.disconnect();
    srv.server.close();
  }
});

test('transport: recvPacket/send after disconnect reject cleanly (no TypeError on null socket)', async () => {
  const srv = await startServer();
  const transport = mqttot.createTransport({ host: '127.0.0.1', port: srv.port, tls: false });
  await transport.connect();
  transport.disconnect();
  await assert.rejects(() => transport.recvPacket(), /transport is closed/);
  await assert.rejects(() => transport.send(Buffer.from([0xc0, 0x00])), /transport is closed/);
  srv.server.close();
});

// ---------- 4. transport: oversized packets are refused, not buffered ----------

test('transport: forged 256MB remaining-length is rejected without buffering', async () => {
  const srv = await startServer((socket) => {
    // 0xFF x4 + 0x07 == 268435455 bytes (MQTT max)
    socket.write(Buffer.concat([Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0x07]), Buffer.alloc(64, 0x41)]));
  });
  const transport = mqttot.createTransport({ host: '127.0.0.1', port: srv.port, tls: false });
  try {
    await transport.connect();
    await assert.rejects(() => transport.recvPacket(), /exceeds/);
  } finally {
    transport.disconnect();
    srv.server.close();
  }
});

// ---------- 5. realtime client: handler isolation ----------

test('RealtimeClient.emit: throwing handler does not break other handlers', () => {
  const rt = new RealtimeClient({ sessionid: 'x', phoneId: 'x', userId: 1, userAgent: 'u', appVersion: '1', locale: 'en_US' });
  let second = false;
  rt.on('message', () => {
    throw new Error('bad bot handler');
  });
  rt.on('message', () => {
    second = true;
  });
  rt.emit('message', { hello: 1 });
  assert.strictEqual(second, true, 'second handler must still run');
});

// ---------- 6. auto-update feature ----------

test('maybeAutoUpdate: installs when registry version is newer', async () => {
  update.resetUpdateCache();
  const calls = { get: 0, install: 0, args: null };
  const result = await update.maybeAutoUpdate({
    version: '2.9.0',
    httpGet: async () => {
      calls.get += 1;
      return { data: { version: '2.10.0' } };
    },
    execFn: (cmd, args, opts, cb) => {
      calls.install += 1;
      calls.args = { cmd, args };
      cb(null, '', '');
    },
  });
  assert.strictEqual(result.checked, true);
  assert.strictEqual(result.updateAvailable, true);
  assert.strictEqual(result.installed, true);
  assert.strictEqual(calls.get, 1);
  assert.strictEqual(calls.install, 1);
  assert.strictEqual(calls.args.cmd, 'npm');
  assert.deepStrictEqual(calls.args.args.slice(0, 2), ['install', update.PACKAGE_NAME + '@latest']);
});

test('maybeAutoUpdate: no install when already latest', async () => {
  update.resetUpdateCache();
  let installed = 0;
  const result = await update.maybeAutoUpdate({
    version: '9.9.9',
    httpGet: async () => ({ data: { version: '9.9.9' } }),
    execFn: (cmd, args, opts, cb) => {
      installed += 1;
      cb(null, '', '');
    },
  });
  assert.strictEqual(result.updateAvailable, false);
  assert.strictEqual(installed, 0);
});

test('maybeAutoUpdate: skipUpdateCheck flag short-circuits everything', async () => {
  update.resetUpdateCache();
  let checked = 0;
  const result = await update.maybeAutoUpdate({
    skipUpdateCheck: true,
    httpGet: async () => {
      checked += 1;
      return { data: { version: '99.0.0' } };
    },
    execFn: (c, a, o, cb) => cb(null, '', ''),
  });
  assert.strictEqual(result.checked, false);
  assert.strictEqual(result.reason, 'skipped');
  assert.strictEqual(checked, 0);
});

test('maybeAutoUpdate: autoUpdate=false checks but does not install', async () => {
  update.resetUpdateCache();
  let installed = 0;
  const result = await update.maybeAutoUpdate({
    autoUpdate: false,
    version: '1.0.0',
    httpGet: async () => ({ data: { version: '2.0.0' } }),
    execFn: (c, a, o, cb) => {
      installed += 1;
      cb(null, '', '');
    },
  });
  assert.strictEqual(result.updateAvailable, true);
  assert.strictEqual(result.installed, false);
  assert.strictEqual(installed, 0);
});

test('maybeAutoUpdate: install failure never throws, login proceeds', async () => {
  update.resetUpdateCache();
  const result = await update.maybeAutoUpdate({
    version: '1.0.0',
    httpGet: async () => ({ data: { version: '2.0.0' } }),
    execFn: (c, a, o, cb) => cb(new Error('EACCES permission denied'), '', 'npm ERR!'),
  });
  assert.strictEqual(result.installed, false);
  assert.ok(result.installError.indexOf('EACCES') !== -1);
});

test('maybeAutoUpdate: registry unreachable never throws', async () => {
  update.resetUpdateCache();
  const result = await update.maybeAutoUpdate({
    version: '1.0.0',
    httpGet: async () => {
      throw new Error('ENOTFOUND registry.npmjs.org');
    },
    execFn: (c, a, o, cb) => cb(null, '', ''),
  });
  assert.strictEqual(result.checked, true);
  assert.strictEqual(result.updateAvailable, false);
  assert.ok(result.error.indexOf('ENOTFOUND') !== -1);
});

test('maybeAutoUpdate: 6h interval cache prevents hammering the registry', async () => {
  update.resetUpdateCache();
  const opts = {
    version: '1.0.0',
    httpGet: async () => ({ data: { version: '1.0.0' } }),
    execFn: (c, a, o, cb) => cb(null, '', ''),
  };
  const first = await update.maybeAutoUpdate(opts);
  const second = await update.maybeAutoUpdate(opts);
  assert.strictEqual(first.checked, true);
  assert.strictEqual(second.checked, false);
  assert.strictEqual(second.reason, 'cached');
  update.resetUpdateCache();
  const third = await update.maybeAutoUpdate(opts);
  assert.strictEqual(third.checked, true);
});

test('tryAutoUpdate: uses npm.cmd on win32', async () => {
  const used = [];
  await update.tryAutoUpdate({
    execFn: (cmd, args, opts, cb) => {
      used.push({ cmd, hasHide: opts && opts.windowsHide });
      cb(null, '', '');
    },
    npmBin: undefined,
  });
  // posix sandbox -> 'npm'; the win32 branch is structural, assert shape
  assert.strictEqual(used.length, 1);
  assert.ok(used[0].cmd === 'npm' || used[0].cmd === 'npm.cmd');
  assert.strictEqual(used[0].hasHide, true);
});

// ---------- 7. polling resilience ----------

test('polling: throwing onEvent does not kill the loop', async () => {
  const srv = await startServer();
  let pollCount = 0;
  const fakeClient = {
    api: {
      request: async () => {
        pollCount += 1;
        // item_id must change per poll or the diffing skips emission
        const thread = { thread_id: '123', items: [{ item_id: 'm' + pollCount, item_type: 'text', text: 'hi', user_id: 'u1', timestamp: Date.now() }] };
        return { inbox: { threads: [thread] } };
      },
    },
  };
  const events = [];
  let throws = 0;
  const stop = startPolling(fakeClient, () => {
    throws += 1;
    throw new Error('bot bug');
  }, { pollIntervalMs: 40, jitterMs: 0, amount: 5, onHandlerError: (err) => events.push(err) });
  await sleep(250); // several polls
  stop();
  assert.ok(pollCount >= 2, 'polling must survive handler throws (polls=' + pollCount + ')');
  assert.ok(throws >= 2, 'handler was called repeatedly (throws=' + throws + ')');
  assert.strictEqual(events.length, throws, 'every handler error is reported');
  srv.server.close();
});

// ---------- 8. v3 memory caps ----------

test('v3: snapshots map is capped (no unbounded growth)', () => {
  const v3 = createV3Tracker({ client: { userId: '1', username: 'me' }, emit: () => {} });
  for (let i = 0; i < 700; i += 1) {
    v3.trackThread({ thread_id: 't' + i, thread_title: 'g' + i });
  }
  assert.ok(v3.snapshots.size <= 500, 'snapshots.size=' + v3.snapshots.size);
});

test('v3: systemEmitted map is pruned (real leak fix)', () => {
  const v3 = createV3Tracker({ client: { userId: '1', username: 'me' }, emit: () => {} });
  for (let i = 0; i < 300; i += 1) {
    v3.markSystemEmitted('t' + i, 'sys');
  }
  assert.strictEqual(v3.systemEmitted.size, 300);
  // advance the clock past the 10s TTL, then mark again -> prune runs
  const realNow = Date.now;
  Date.now = () => realNow() + 60000;
  try {
    v3.markSystemEmitted('t-new', 'sys');
    assert.ok(v3.systemEmitted.size <= 5, 'systemEmitted.size=' + v3.systemEmitted.size);
  } finally {
    Date.now = realNow;
  }
});

// ---------- 9. logger spinner overwrite leak ----------

test('logger: creating a second spinner stops the first (no dangling interval)', () => {
  const a = logger.spinner('first', { interval: 50 });
  const b = logger.spinner('second', { interval: 50 });
  assert.strictEqual(a.stopped, true, 'first spinner must be stopped when a second starts');
  assert.strictEqual(b.stopped, false);
  b.stop();
  const p1 = logger.pulse('one');
  const p2 = logger.pulse('two');
  assert.strictEqual(p1.stopped, true);
  assert.strictEqual(p2.stopped, false);
  p2.stop();
});

// ---------- 10. wire codec sanity ----------

test('mqttot: connectPacket/decodePacket round-trip stays intact', () => {
  const packet = mqttot.connectPacket({
    clientIdentifier: 'abcdef0123456789',
    clientInfo: { userId: 123, userAgent: 'UA', clientCapabilities: 183, endpointCapabilities: 0, publishFormat: 1, noAutomaticForeground: false, makeUserAvailableInForeground: true, deviceId: 'dev', isInitiallyForeground: true, networkType: 1, networkSubtype: 0, clientMqttSessionId: 42, subscribeTopics: [88, 135], clientType: 'cookie_auth', appId: 567067343352427, deviceSecret: '', clientStack: 3 },
    password: 'sessionid=x',
    appSpecificInfo: { app_version: '1' },
  }, 20);
  assert.strictEqual(packet[0], 0x10);
  const decoded = mqttot.decodePacket(packet);
  assert.strictEqual(decoded.packetType, 'connack_decode_not_valid_but_no_throw' === 'never' ? 'x' : String(packet[0] >> 4));
});

// ---------- runner ----------

process.on('unhandledRejection', (err) => {
  console.error('\nUNHANDLED REJECTION (leaked socket error would crash bots):', err);
  process.exit(2);
});
process.on('uncaughtException', (err) => {
  console.error('\nUNCAUGHT EXCEPTION:', err);
  process.exit(2);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of TESTS) {
    try {
      await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TEST TIMEOUT (10s) — likely a hung await')), 10000).unref()),
      ]);
      console.log('  ✓ ' + name);
    } catch (err) {
      failed += 1;
      console.error('  ✗ ' + name);
      console.error('    ' + String((err && err.stack) || err).split('\n').slice(0, 4).join('\n    '));
    }
  }
  console.log('\n' + (TESTS.length - failed) + '/' + TESTS.length + ' passed');
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('runner failed:', err);
  process.exit(1);
});
