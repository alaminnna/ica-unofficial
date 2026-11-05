/**
 * @alaminnna/ica-unofficial — message/threads/requests
 * 
 * RESPONSIBILITY: pending requests list/approve plus lightweight pending counters.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./threads, client.api
 * MUST NOT:       never send from here
 * 
 * DEBUG: when pending counts are 0 while the app shows requests, start looking here — preview endpoint params
 */

'use strict';

const { pendingRequests, approveRequest } = require('./threads');

async function getPendingRequests(client, options) {
  return pendingRequests(client, options);
}

async function getPendingCount(client) {
  const res = await client.api.request({
    endpoint: 'direct_v2/async_get_pending_requests_preview/',
    method: 'GET',
    params: { pending_inbox_filters: '[]' },
  });
  const data = res || {};
  return {
    total: Number(data.pending_requests_total || 0),
    unread: Number(data.unread_pending_requests || 0),
  };
}

module.exports = { getPendingRequests, getPendingCount, approveRequest };