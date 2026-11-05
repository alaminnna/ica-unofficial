/**
 * @alaminnna/ica-unofficial — message/events
 *
 * RESPONSIBILITY: pure event-shape helpers only (listen-event building + content filter).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing — zero requires (must stay dependency-free).
 * MUST NOT:       never emit, never touch network/client; never mutate CONTENT_TYPES.
 *
 * DEBUG: when event fields are missing/wrong or ghost events fire, start looking here —
 * toListenEvent field mapping or isContentMessage filter list is usually the cause.
 */

'use strict';

const CONTENT_TYPES = ['text', 'link', 'media', 'media_share', 'reel_share', 'story_share', 'felix_share', 'clip', 'voice_media', 'visual_media', 'animated_media', 'xma_share', 'generic_xma', 'hashtag', 'location', 'profile', 'like', 'reaction', 'raven_media'];

function toListenEvent(kind, data) {
  const raw = (data && data.raw !== undefined) ? data.raw : data;
  const message = (data && data.message) || data || {};
  return {
    type: kind,
    threadID: message.thread_id === undefined || message.thread_id === null ? null : String(message.thread_id),
    messageID: message.id === undefined || message.id === null ? null : String(message.id),
    senderID: message.user_id === undefined || message.user_id === null ? null : String(message.user_id),
    body: message.text === undefined || message.text === null ? '' : String(message.text),
    timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
    isGroup: Boolean(message.is_group || (message.users && message.users.length > 2)),
    attachments: message.attachments || [],
    isPendingRequest: Boolean(data.isPendingRequest),
    mentions: message.mentions || {},
    sharedItem: message.sharedItem || null,
    reaction: message.reaction || null,
    replyTo: message.replyTo || null,
    self: Boolean(message.self),
    botContext: message.botContext || null,
    raw,
  };
}

function isContentMessage(inner) {
  if (!inner || inner.user_id === undefined || inner.user_id === null || inner.user_id === '') {
    return false;
  }
  return CONTENT_TYPES.indexOf(inner.item_type) !== -1;
}

module.exports = { CONTENT_TYPES, toListenEvent, isContentMessage };