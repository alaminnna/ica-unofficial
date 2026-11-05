/**
 * @alaminnna/ica-unofficial — message/sending/send
 * 
 * RESPONSIBILITY: text send/reply over HTTP Direct API.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../threads/threads, ../../core/device, ../../exceptions
 * MUST NOT:       never touch listener state
 * 
 * DEBUG: when sendMessage returns ok=false or 429, start looking here — payload and mutation token
 */

'use strict';

const { generateMutationToken } = require('../../core/device');
const { NAV_CHAIN, normalizeMessage } = require('../threads/threads');

function compactJson(obj) {
  return JSON.stringify(obj);
}

function asIdList(ids) {
  if (ids === undefined || ids === null) {
    return [];
  }
  if (typeof ids === 'number' || typeof ids === 'string') {
    return [String(ids)];
  }
  return ids.map((id) => String(id));
}

async function sendText(client, options) {
  const opts = options || {};
  const threadIds = asIdList(opts.threadIds === undefined ? opts.threadId : opts.threadIds);
  const userIds = asIdList(opts.userIds === undefined ? opts.userId : opts.userIds);
  if ((!threadIds.length && !userIds.length) || (threadIds.length && userIds.length)) {
    throw new Error('@alaminnna/ica-unofficial: specify threadIds or userIds, but not both');
  }
  const token = generateMutationToken();
  const text = String(opts.text === undefined || opts.text === null ? '' : opts.text);
  const isLink = text.indexOf('http') !== -1;
  const data = {
    action: 'send_item',
    is_x_transport_forward: 'false',
    send_silently: 'false',
    is_shh_mode: '0',
    send_attribution: opts.sendAttribution || 'message_button',
    client_context: token,
    device_id: client.androidDeviceId,
    mutation_token: token,
    _uuid: client.uuid,
    btt_dual_send: 'false',
    nav_chain: NAV_CHAIN,
    is_ae_dual_send: 'false',
    offline_threading_id: token,
  };
  if (isLink) {
    data.link_text = text;
    const urls = text.match(/https?:\/\/[^\s]+/g) || [];
    data.link_urls = compactJson(urls);
  } else {
    data.text = text;
  }
  if (threadIds.length > 0) {
    data.thread_ids = compactJson(threadIds);
  }
  if (userIds.length > 0) {
    data.recipient_users = compactJson([userIds]);
  }
  if (opts.replyTo) {
    data.replied_to_action_source = 'swipe';
    data.replied_to_item_id = opts.replyTo.id;
    data.replied_to_client_context = opts.replyTo.client_context;
  }
  const res = await client.api.request({
    method: 'POST',
    endpoint: 'direct_v2/threads/broadcast/' + (isLink ? 'link' : 'text') + '/',
    data,
  });
  return normalizeMessage((res || {}).payload || {});
}

async function unsendMessage(client, threadId, messageId) {
  const res = await client.api.request({
    method: 'POST',
    endpoint: 'direct_v2/threads/' + threadId + '/items/' + messageId + '/delete/',
    data: { _uuid: client.uuid },
  });
  return ((res || {}).status || '') === 'ok';
}

module.exports = { sendText, unsendMessage };