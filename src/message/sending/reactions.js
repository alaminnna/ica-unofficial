/**
 * @alaminnna/ica-unofficial — message/sending/reactions
 * 
 * RESPONSIBILITY: message reactions set/delete.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../threads/threads, ../../core/device
 * MUST NOT:       never touch listener state
 * 
 * DEBUG: when a reaction is not applied, start looking here — emoji/item mapping
 */

'use strict';

const { generateMutationToken } = require('../../core/device');
const { NAV_CHAIN } = require('../threads/threads');

function compactJson(obj) {
  return JSON.stringify(obj);
}

async function react(client, threadId, messageId, emoji, status, options) {
  const opts = options || {};
  const token = generateMutationToken();
  const data = {
    action: 'send_item',
    is_x_transport_forward: 'false',
    send_silently: 'false',
    is_shh_mode: '0',
    send_attribution: 'message_reaction',
    client_context: token,
    device_id: client.androidDeviceId,
    mutation_token: token,
    btt_dual_send: 'false',
    nav_chain: NAV_CHAIN,
    is_ae_dual_send: 'false',
    offline_threading_id: token,
    thread_ids: compactJson([String(threadId)]),
    item_type: 'reaction',
    reaction_type: 'like',
    reaction_status: status,
    node_type: 'item',
    item_id: String(messageId),
    emoji: emoji || '?',
    reaction_action_source: opts.actionSource || 'double_tap',
  };
  if (opts.clientContext) {
    data.original_message_client_context = opts.clientContext;
  }
  if (opts.targetItemType) {
    data.target_item_type = opts.targetItemType;
  }
  const res = await client.api.request({ method: 'POST', endpoint: 'direct_v2/threads/broadcast/reaction/', data });
  return ((res || {}).status || '') === 'ok';
}

async function sendReaction(client, threadId, messageId, emoji, options) {
  return react(client, threadId, messageId, emoji, 'created', options);
}

async function deleteReaction(client, threadId, messageId, emoji, options) {
  return react(client, threadId, messageId, emoji, 'deleted', options);
}

async function setMessageReaction(client, options) {
  const opts = options || {};
  if (opts.revert) {
    throw new Error('@alaminnna/ica-unofficial: setMessageReaction does not support revert:true, use deleteReaction instead');
  }
  return sendReaction(client, opts.threadId, opts.messageId, opts.emoji, opts);
}

async function likeDirectMessage(client, threadId, messageId) {
  return sendReaction(client, threadId, messageId, '❤️');
}

async function unlikeDirectMessage(client, threadId, messageId) {
  return deleteReaction(client, threadId, messageId, '❤️');
}

module.exports = { sendReaction, deleteReaction, setMessageReaction, likeDirectMessage, unlikeDirectMessage };