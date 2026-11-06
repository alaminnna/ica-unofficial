# Changelog

## v2.9.2 (2026-11-06)

Tiered listening-storage overhaul — the store stops hoarding messages and
keeps only what attribution actually needs. The store API is backwards
compatible (`openStore` / `opts.store: false` / `opts.listeningStore` all keep
working); the suite grows to 30 tests.

- **Why messages were in the DB at all:** the listener stores recent messages
  for one reason — reply/reaction attribution. When someone replies to an
  older message, the payload often omits the parent's author, so the library
  looks it up (`store.getMessage`) to fill `replyTo.authorUserId` and derive
  `bot:reply` events. Everything else about a message was dead weight.
- **Hot tier (in-memory, always on).** Every recent message now lives in a
  bounded TTL map (`hotCap` 4000 / `hotTtlMs` 24h). Reads (attribution,
  `threadMessages`) hit memory first; the per-message hot path no longer pays
  a SQLite round-trip.
- **Cold tier is bounded by default (`smart` mode).** SQLite keeps at most
  `maxMessages` (2000) rows within `retentionHours` (24) — enough to recover
  attribution across a restart, tiny DB forever. Raw payloads are never
  persisted in smart mode, and opening a legacy database NULLs stored raw
  JSON so old files shrink on first open.
- **Batched writes.** Message writes are staged and flushed in one
  transaction every `flushMs` (2s), after 250 pending rows, or on
  `close()`/`stop()` — instead of one synchronous INSERT per message.
  WAL + `synchronous = NORMAL`.
- **`store: 'memory'` — zero-disk mode.** Full store interface (attribution,
  kv, outbox, fixtures) backed entirely by bounded Maps; no file is ever
  created. `store: false` keeps its legacy meaning (no store at all).
- **`store: { ... }` configuration.** `client.listen({ store: { mode, dir,
  file, retentionHours, maxMessages, persistRaw, flushMs, hotCap, hotTtlMs } })`;
  unknown modes fail loudly with the valid list. Misconfigured stores now log
  a visible warning instead of failing silently.
- **`store.stats()`.** `mode`, `file`, `sizeBytes`, row counts, hot-tier
  fill, dirty-write count and the effective config, for observability.
- **Schema v3** adds `created_at`/`ts_us` indexes (fast retention pruning and
  oldest-first eviction). `prune()` now uses the store's configured retention
  by default; `prune(days)` still works.
- Thread snapshots were already tracked in memory (`v3.snapshots`, capped);
  the `threads` table remains a consumer-facing API and is unchanged.

## v2.9.1 (2026-11-05)

Security/robustness hardening round (MQTT realtime, leaks, error isolation) —
21-test regression suite (`test/run.js`) covers every fix:

- **MQTT: concurrent reads no longer corrupt the stream.** The keepalive
  watchdog (`ping()`) and the main read loop (`readOnce()`) both called
  `transport.recvPacket()` at the same time; both attached `data` listeners to
  the same socket, so *both* received every TCP chunk — duplicated bytes,
  garbled packets, phantom reconnects. Reads are now serialized through an
  in-transport queue.
- **MQTT: a socket error can no longer crash the whole bot.** After connect the
  transport kept no `error` listener, so an ECONNRESET/TLS alert between
  packets raised `unhandled 'error' event` and killed the process. The
  transport now keeps persistent `error` + `close` handlers and surfaces the
  stored error to the next read.
- **MQTT: a dropped connection can no longer freeze the bot.** After a socket
  close the transport kept its dead socket reference; the next `recvPacket()`
  attached listeners to a closed socket and hung forever. Post-close state now
  rejects cleanly (`transport is closed (last error: …)`), so the reconnect
  backoff runs instead.
- **MQTT: oversized packets are refused, not buffered.** A forged
  `remaining length` (MQTT allows up to 256MB) was buffered blindly — OOM risk.
  Packets are capped at 8MB (`mqttot.MAX_PACKET_BYTES`).
- **MQTT: TCP keepalive + connect-timeout fix.** Sockets now enable
  `setKeepAlive(15s)`; the connect-phase idle timeout is disabled after
  handshake so quiet-but-alive connections are not killed by stray `timeout`
  events.
- **Realtime/FBNS/polling: handler isolation.** A throwing `on()`/`onEvent()`
  callback (bot bug) used to break packet dispatch and trigger reconnect
  storms; all listeners and the listen-loop user callback are now isolated
  (log + continue, `ICA_DEBUG=1` prints handler errors). Polling consumers got
  the same isolation (`onHandlerError` hook) so one bad callback cannot stop
  the polling loop.
- **Memory leaks fixed:** `v3.systemEmitted` map never pruned (10s TTL prune
  now); `v3.snapshots` capped at 500 threads (LRU-style); logger spinner/pulse
  overwrites leaked the previous interval timer forever (previous instance is
  now stopped, timers `unref()`ed); listening store now prunes messages/outbox
  every 6h while listening (14-day retention).
- **Reconnect hygiene:** `RealtimeClient`/`FbnsClient` reset `connected` before
  connecting and tear the transport down on failed handshakes, so the watchdog
  never pings a dead socket.
- **Auto-update hardening:** `compareVersions` treats missing segments as zero
  (`2.9` == `2.9.0`) and ranks pre-releases below releases (`2.9.1-beta.1` <
  `2.9.1`); auto-install uses `npm.cmd` on Windows (`execFile('npm')` failed
  there); registry errors are surfaced in the `maybeAutoUpdate` result;
  `login()` attaches the result to `client.lastUpdateCheck`.
- Tests: new hermetic `test/run.js` (21 tests, local TCP server + mocks, zero
  Instagram traffic).

## v2.9.0 (2026-10-03)

Auto-update check (new `src/core/update.js`, wired into `login()`):

- Every `login()` checks the npm registry for a newer release (6h
  in-memory cache, 8s timeout); when outdated it runs
  `npm install @alaminnna/ica-unofficial@latest` (3min cap, no shell)
  before continuing — restart to run the new version
- Never blocks login: registry/install failures only log and continue
- Opt-outs: `skipUpdateCheck` / `autoUpdate: false` options,
  `ICA_SKIP_UPDATE_CHECK=1` / `ICA_AUTO_UPDATE=0` env,
  `updateCheckIntervalMs` / `updateCheckTimeoutMs` /
  `updateInstallTimeoutMs` tuning; `checkForUpdate` + `maybeAutoUpdate`
  exported for manual use
- Tests: new hermetic `test/update.test.js` (stubs, no network);
  `test/run.js` forces `ICA_SKIP_UPDATE_CHECK=1` so the suite stays offline

## v2.8.1 (2026-10-03)

Functional-audit fixes (all suites green, no live-network changes):

- Client realtime actions: bridged `directSendText`,
  `directSendReaction`, `directMarkSeen`, `directIndicateActivity`,
  `directSubscribe`, `irisSubscribe`, `graphQlSubscribe`,
  `skywalkerSubscribe`, `sendForegroundState`, `publishJson` onto the
  Client (promise + fca callback); unconnected calls throw the exported
  `RealtimeNotConnected`
- `RealtimeNotConnected` identity: removed the shadow class in
  `message/listener/realtime.js`, now re-exports the canonical
  `src/exceptions` class (`instanceof` works); `publishJson` (and every
  subscribe helper funnelling through it) now guards with
  `ensureConnected()`
- Proxy parsing: bracketed IPv6 (`http://[::1]:8080`) parses correctly;
  non-numeric/out-of-range ports throw `invalid proxy URL (bad port)`
  instead of silently producing `NaN`
- Install truth: `better-sqlite3` moved to `optionalDependencies`
  (`listen()` already degraded to `store=null` without it; `openStore`
  now throws a clear install hint); README no longer claims "no native
  modules / zero heavy deps"
- ESM: `index.js` uses explicit export assignments so static named
  imports (`import { login, ChallengeRequired }`) resolve
- Docs: `getSpamInboxChunk` signature, `listen()` snapshot-store note

## v2.4.0 (2026-10-01)

Full usage-guide parity sweep (comment, direct rooms, collections,
highlights, discovery gaps, story extras, small fills, ex-skip list):

- Comments (new src/media/comments.js): post/like/unlike/pin/unpin/bulk
  delete, offensive check (+raw), paged list, GQL likers; 7 bot cmds
- Direct rooms (new threads/rooms.js): create/hide/retitle/add-users/
  unread/mute(+video-call)/e2ee/spam inbox; presence pair, message search,
  gen-ai bots, channels; message like/unlike, file-by-extension send,
  cutout sticker; 13 bot cmds
- Collections (new media/collections.js) + Highlights (new
  story/highlights.js): full CRUD; 11 bot cmds
- Discovery gaps: hashtag module (info/medias/follow/followed),
  location upgrade (endpoint fix, triple cursor, top/recent, complete/
  build/sticker-id/guides), 9 track fns, 10 search fns, private mobile-GQL
  lists (exact i.instagram.com/graphql/query mechanics); 16 bot cmds
- Story extras (new story/extras.js): info/likers/like/unlike, poll vote,
  sticker tray, archive days/stories; 8 bot cmds
- Small fills: music notes (inbox-tray GQL), news inbox, AI-label mutation,
  share-post-as-story; 4 bot cmds
- Ex-skip list, zero skips: notification module (28), legacy signup +
  multi-account family, USDID attestation (P-256, session-persisted),
  address book, creator info, friendships bulk, feed stream item; 10 bot cmds
- Tests: media-comments, message-rooms, collections-highlights,
  discover-gaps, story-extras, small-fills, step7 (all mocked)
- Fixes found en route: location info endpoint, location medias paging,
  private-GQL host/headers, mute_all 2_hour literal

## v2.3.0 (2026-09-28)

Listening v3 — group metadata + bot interaction (production grade):

- listening/metadata.js: pure thread snapshot + diff (rename/photo/theme/
  members/admins/nicknames/approval/meta_unknown guard)
- listening/attribution.js: 30s action_log ring + op fusion + structure-first
  kick-vs-left resolution
- listening/botevents.js: bot:reply_received/reaction_received/mentioned/
  dm_received/group_added + self flag (structural loop prevention)
- listening/v3.js: tracker wiring (snapshots, ring, derived emits, store fill)
- store v2 migration: thread meta columns + parent_item_id/is_self
- listen.js: v3 post-pass on message/reaction/event, polling snapshot feed,
  kind-aware dedupe for group:/bot: kinds, sqlite store default-on
- messages keep replyTo; events carry reaction/self/botContext
- Bot logs group/bot kinds readably; tests: listening-v3.test.js

## v2.2.0 (2026-09-28)

Listening store (LISTENING_NOTES v2 L1, store slice):

- better-sqlite3 dependency (WAL mode)
- src/listening/store.js: kv cursors, threads, messages, reactions,
  outbox (unique event_key), fixtures, migrations, 14d retention prune
- Consumer layout: requiring project er cwd te `ica-alaminnna/`
  folder + `ica-unofficial.db` database auto-create hoy
- Tests: test/listening-store.test.js (CRUD + dedup + reopen)

## v2.1.0 (2026-09-28)

Users 100% parity (Phase 15d, `user.md`):

- Follow requests: getFollowRequests/getFollowRequestsChunk,
  approve/decline (single + sequential batch) — private-account surface
- Close friends add/remove (`set_besties`, wires to story besties audience)
- Mutes (posts/stories + unmute), notification favorites
  (posts/videos/reels/stories on/off), removeFollower, FRX reportUser
  (spam-only, 1+3 POST flow)
- Followers/following: `order` param, chunk pages, async-generator
  iterators (page-safe), in-list search; friendship classifier
  (following/outgoing_request/none); block/unblock `surface` param
- Extras: getUserAbout (bloks, best-effort + raw), getUserGuides
- Discovery: chaining, suggested profiles (+expand), related profiles
  (gated GraphQL → chaining fallback); new InvalidTargetUser/UserNotFound
- Lookup: stream envelopes (+flat merge), web_profile_info, doc_id
  short/info lookups; identity-cache GraphQL fallback chain
- Bot: 17 users commands (.freqs/.fapprove/.fdecline/.cfriend/
  .uncfriend/.muteposts/.unmuteposts/.mutestories/.notif/.rmfollower/
  .report/.fsearch/.forder/.friendship/.about/.suggested/.chaining)
- Tests: test/user-parity.test.js (mocked); README Users table full parity
- Skipped (documented in docs/USER_PARITY_NOTES.md): address_book
  (contact-upload privacy), creator_info, global search_users, plural
  friendships, feed stream item, clips/inbox private-GQL, discover
  recommended, legacy public follower/following gql (documented-empty)

## v2.0.0 (2026-09-27)

Discover + final (prompt `madia.md` Phase 18 FINAL):

- Location: searchLocations, getLocationInfo, getLocationMedias (ranked/recent)
- Insights: getAccountInsights/getMediaInsights via ads/graphql
  (business-gated, clear errors)
- Music discovery: searchMusic, musicInFeedBrowser, musicTrending —
  tracks feed upload*WithMusic directly
- Search: topsearchFlat, searchUsersAdvanced, searchHashtags,
  searchPlaces, searchMedias (SERP cursor-safe paging)
- Bot: 12 discover commands + discover help group
- Tests: test/discover.test.js (mocked)
- Full surface: 130+ bot commands across 9 groups

## v1.6.0 (2026-09-27)

Story upload + builder (prompt `madia.md` Phase 17):

- Story publish: uploadPhotoStory/uploadVideoStory (stickers: mention,
  link, hashtag, location, feed-media, raw, poll), deleteStory,
  DM-story via threadIds
- StoryBuilder: chainable composer (.background/.caption/.mention/.link/
  .hashtag/.location/.media/.build) — pass-through mode, no rendering deps
- Reads: getStoryViewers (paged), getStoryTray, getUserStories/getStory/
  downloadStory moved to src/story/ (media/story.js is now a compat shim)
- Bot: 9 story commands (.upstory/.smention/.slink/.shashtag/.smedia/
  .sbuild/.viewers/.tray/.delstory) + story help group
- Tests: test/story.test.js (builder shape, tap models, payloads, viewers/tray)

## v1.5.0 (2026-09-27)

Media extras (prompt `madia.md` Phase 16b):

- Manage: deleteMedia, editMedia (caption/tags/IGTV title), linkReel,
  archiveMedia/unarchiveMedia/getArchivedMedias, pinMedia/unpinMedia,
  pinReel/unpinReel, markMediaSeen/markClipsSeen
- Info: getMediaOembed, getMediaAuthor, getMediaInfoV2 (ad-tag fallback),
  videoRefreshResources, toMediaId converters via existing codec
- Notes: createMediaNote/deleteMediaNote (post-attached, not inbox notes)
- Live: create/start/endLivestream, getLivestreamInfo/Comments/Viewers
  (RTMP streaming out of scope — server + key returned)
- Feeds: getTimelineFeed, getReels/getExploreReels/getFriendsReels,
  getUserClips/getUserVideos
- Pagination: getUserMediasPaginated/getUserTagsPaginated + iterUserMedias
- Sticker: uploadCutoutSticker (reuses Phase 16 rupload)
- Bot: 20 media commands + v1.5.0
- Tests: test/media-extras.test.js (mocked)

## v1.4.0 (2026-09-27)

Media upload core (prompt `madia.md` Phase 16):

- Upload: uploadPhoto, uploadVideo, uploadAlbum (nested per-item usertags),
  uploadIGTV (signed), uploadReel (signed, trial/topics/preview)
- Music metadata: uploadPhotoWithMusic, uploadAlbumWithMusic,
  uploadReelWithMusic (no local muxing; alacorn session required)
- Preflights: clipTrialEligible, clipInterestTopics, changeReelCover
- Modern options: scheduleAt (photo/video/album, pro accounts),
  coauthorUserIds, extraData passthrough, shareToFacebook/shareToThreads
  with destination discovery BEFORE bytes (clear error when unconfirmed)
- Pipeline: src/upload/ (validate, thumb, rupload, crosspost + 5 types);
  pure-MP4 metadata parser (zero dep); ffmpeg-optional thumbs; sharp
  photo resize (optional dep, original-bytes fallback)
- Bot: 9 upload commands (.upphoto/.upvideo/.upalbum/.upreel/.upigtv/
  .cover/.uptopics/.myupload/.share) + upload help group, uploadFolder config
- Tests: test/upload.test.js (mocked payload builders + discovery)

## v1.3.0 (2026-09-27)

Account self-management + TOTP (prompt `account.md` Phase 15 FULL):

- Account: getAccountInfo, editAccount (email/phone merge), setBiography,
  setExternalUrl, getBioLinks/removeBioLinks, changeProfilePicture,
  setPrivate/setPublic, convertToBusiness/convertToCreator/convertToProfessional
- Security: getSecurityInfo, changePassword (rate-guarded, never logged),
  sendPasswordReset (www ajax)
- Contact: sendConfirmEmail/confirmEmail, sendConfirmPhone/confirmPhone
- Direct extras: searchThreads, getThreadByParticipants (getPendingCount
  already existed)
- TOTP: generateTOTP(seed) RFC 6238, zero deps, RFC vectors tested
- Small fills: getLikedMedias, getMediaLikers, getCommentReplies
- Bot: 23 new `.` commands + Account help group, confirm steps on
  destructive commands, masked email/phone, `totpSeed` config
- Tests: test/account.test.js + test/totp.test.js (mocked + RFC vectors)

Note: package jumps 1.0.0 → 1.3.0 (phases 6–14 shipped without version
bumps; 1.1/1.2 never cut).

## v1.0.0 (2026-09-27)

First public release of `@alaminnna/ica-unofficial`.

- Login: credentials + cookies/session resume, 2FA (legacy + Bloks),
  challenge flows, device-bound sessions, proxy support
- Messaging: text/link send + reply, threads, inbox, pending requests
  (list/count/approve), reactions, unsend/delete, mark-seen, typing
- Media: photo/video/voice sends via messenger attachment flow
- Users: info by id/username, id-from-username lookups
- Realtime: MQTT listener (message/typing/presence/seen), FBNS register
- Bot: fca-style test bot with grouped commands, auto-reconnect,
  auto-approve, fastMode, rate guard, challenge handlers
- Anti-ban: Retry-After backoff, cooldown flags, single auto-relogin,
  delay layers, socks-capable proxy
- Logger with levels, colors, sections ([BOT], [AUTH], [HTTP], [MSG], [USER])