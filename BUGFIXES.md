# Security & Stability Audit — Issues Found and Fixed (v2.9.1)

Full deep review of the codebase focused on the areas the audit targets:
memory leaks, the realtime MQTT layer, resource handling and error isolation.
Every fix below is covered by the new regression suite (`node test/run.js`,
21 tests, zero Instagram traffic).

---

## CRITICAL — realtime MQTT

### C1. Concurrent reads corrupted the MQTT stream (`mqttot.js` + `listen.js`)
**Found:** The keepalive watchdog in `listen()` calls `rt.ping()` every 15s
while the main loop calls `rt.readOnce()`. Both end up in
`transport.recvPacket()` at the same time, and both attached a `data`
listener to the same TCP socket. Node delivers every chunk to **every**
listener — so both readers received the *same bytes*, built their own
overlapping packet framing, and produced garbage: decode crashes, phantom
packets, "seq gap" chaos and reconnect storms on busy accounts. This is the
single worst realtime bug in the repo.

**Fixed:** `createTransport()` now serializes reads through an internal
promise queue — one reader at a time, each `recvPacket()` returns exactly one
complete packet. Ping and read loop interleave safely by design.

### C2. Socket errors crashed the whole bot process (`mqttot.js`)
**Found:** `connect()` attached `socket.once('error', …)` only for the
handshake and removed it on success. After that the socket had **no** `error`
listener, so any ECONNRESET / TLS alert arriving between packets raised
Node's `unhandled 'error' event` — which terminates the process. A long-running
bot died on the first network hiccup.

**Fixed:** persistent `error` handler for the socket's lifetime; the error is
stored and the socket torn down; the next read/send rejects with
`transport is closed (last error: …)` so the existing backoff/reconnect logic
takes over.

### C3. A dropped connection froze the listener forever (`mqttot.js`)
**Found:** after the peer closed the socket, the transport kept its dead
`socket` reference. The next `recvPacket()` attached fresh `data`/`error`/
`close` listeners to an already-closed socket — `'close'` had already fired,
so **nothing ever fired again**: the read promise never settled, the read
queue jammed, and the bot sat "connected" but deaf. (Reproduced in a test.)

**Fixed:** persistent `close` handler marks the transport failed, drops the
socket reference and resets the partial-packet buffer; all future reads
reject cleanly → reconnect backoff runs.

### C4. Unbounded packet buffering — remote OOM risk (`mqttot.js`)
**Found:** `readPacketFromSocket()` trusted the wire's `remaining length`
byte field blindly. MQTT allows up to 256MB per packet; a forged or corrupt
stream made the transport buffer up to that size in memory.

**Fixed:** packets are capped at 8MB (`mqttot.MAX_PACKET_BYTES`); larger
frames reject immediately.

### C5. No TCP keepalive, and the connect timeout leaked into idle sockets (`mqttot.js`)
**Found:** no `setKeepAlive()` — NAT/firewall half-open connections went
unnoticed until the watchdog pung. Meanwhile `tls.connect({ timeout })`
leaves an idle-timeout armed that emits unhandled `timeout` events during
quiet periods.

**Fixed:** `setKeepAlive(true, 15000)` after handshake; the connect-phase
timeout is disabled (`setTimeout(0)`) once connected — quiet-but-alive MQTT
connections survive.

---

## HIGH — memory leaks

### H1. `v3.systemEmitted` map grew forever (`listening/v3.js`)
**Found:** every thread that ever emitted a system/group event left an entry
that was never removed — a genuine unbounded leak in long-running bots.
**Fixed:** 10s TTL prune on every write; entries are only needed for a 5s
dedup window. Exposed on the tracker for verification.

### H2. `v3.snapshots` map unbounded (`listening/v3.js`)
**Found:** one snapshot per thread ever seen, kept forever.
**Fixed:** capped at 500 threads with oldest-entry eviction.

### H3. Logger spinner/pulse timer leak (`core/logger.js`)
**Found:** creating a second `spinner()`/`pulse()` overwrote the global
reference while the first one's `setInterval` kept firing forever — leaked
timer + wasted CPU per overwrite; timers were also never `unref()`ed, keeping
short CLI scripts alive.
**Fixed:** starting a new spinner/pulse stops the previous one; stop/success/
fail clear the global reference; all timers are `unref()`ed.

### H4. Listening store never pruned (`listen.js`)
**Found:** `store.prune()` existed but nothing called it — `messages` and
`outbox` tables grew without bound while listening.
**Fixed:** while MQTT listening is active, the store is pruned every 6h
(14-day retention); the timer is `unref()`ed and cleared on `stop()`.

---

## MEDIUM — robustness / error isolation

### M1. Bot handler exceptions caused reconnect storms (`listen.js`, `realtime.js`, `fbns.js`, `polling.js`)
**Found:** user callbacks (`onEvent`, `rt.on(...)`) ran inside the packet
dispatch path. One throwing handler broke the read loop → catch → MQTT
reconnect → hammering Instagram with a broken bot. In polling, a throwing
consumer killed the polling loop entirely and the listener went silent.
**Fixed:** every realtime/FBNS listener and the listen-loop callback are
wrapped (log + continue, `ICA_DEBUG=1` for details); polling reports handler
errors via a new `onHandlerError` hook and keeps polling.

### M2. Dead-socket misuse threw opaque `TypeError` (`mqttot.js`)
**Found:** `send()`/`recvPacket()` after `disconnect()` dereferenced a null
socket → `Cannot read properties of null` instead of a meaningful error.
**Fixed:** clean `transport is closed` rejections everywhere.

### M3. Failed handshakes left stale state (`realtime.js`, `fbns.js`)
**Found:** `connect()` left `connected === true` after a failure (stale from a
previous session), so the watchdog would ping a dead transport; the transport
was also left un-disconnected after a failed CONNACK.
**Fixed:** `connected` reset up-front; transport torn down on any handshake
failure; the original error propagates.

### M4. Dead code / fragile inline check (`listen.js`)
`isSessionExpiredMessage()` was defined but unused while an identical inline
check existed in the loop — the helper is now the single source of truth.

---

## Auto-update feature (requested) — verified and hardened (`core/update.js`)

The feature existed since 2.9.0 (check npm on every `login()`, auto-install
`@alaminnna/ica-unofficial@latest`, never block login) and is now verified
end-to-end against the **live npm registry** plus 8 mocked tests:

1. **Version compare bugs fixed** — `2.9` vs `2.9.0` compared unequal (missing
   segments are now zero), and pre-releases ranked wrongly
   (`2.9.1-beta.1` > `2.9.1` by string compare; pre-releases now sort below
   their release).
2. **Windows fix** — `execFile('npm', …)` always fails on Windows (no bare
   `npm` executable); the installer now uses `npm.cmd` on `win32`, so the
   auto-install actually works for the majority of fca bot hosts.
3. **Transparency** — registry errors now surface in the `maybeAutoUpdate()`
   result object, and `login()` attaches it to `client.lastUpdateCheck`
   (`{ checked, current, latest, updateAvailable, installed, error? }`).
4. **Verified live:** `checkForUpdate()` against `registry.npmjs.org`
   returns the real latest version and correct `updateAvailable` verdict.
5. Behavior confirmed by tests: installs when outdated, skips when current,
   honors `skipUpdateCheck` / `autoUpdate:false` / `ICA_SKIP_UPDATE_CHECK` /
   `ICA_AUTO_UPDATE`, never throws on install/registry failure, 6h interval
   cache prevents registry hammering.

---

## Test suite

`test/run.js` — 21 hermetic tests (local TCP server + injected mocks, no
Instagram traffic): version compare, concurrent-read corruption, socket error
storage, mid-packet close, post-disconnect rejections, 256MB frame refusal,
handler isolation, auto-update matrix, polling resilience, v3 map caps,
logger timer behavior and codec sanity. **21/21 passing.**

Run it with:

```bash
npm test        # node test/run.js
```
