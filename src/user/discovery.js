/**
 * @alaminnna/ica-unofficial — user/discovery
 *
 * RESPONSIBILITY: suggestion surfaces: chaining, suggested profiles, related
 * profiles (gated GraphQL with chaining fallback).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./social (normalizeShort), ./lookup (publicGraphql), client.api, ../exceptions
 * MUST NOT:       never raise raw GraphQL gating errors — InvalidTargetUser or chaining fallback
 *
 * DEBUG: when suggested comes back empty on private targets, start looking
 * here — "Not eligible for chaining" mapping
 */

'use strict';

const { normalizeShort } = require('./social');
const { InvalidTargetUser, UserNotFound } = require('../exceptions');

const RELATED_QUERY_HASH = 'ad99dd9d3646cc3c0dda65debcd266a7';

function notEligible(err) {
  return String((err && err.message) || err).indexOf('Not eligible for chaining.') !== -1;
}

async function getChaining(client, userId) {
  const id = String(userId);
  try {
    return await client.api.request({
      endpoint: 'discover/chaining/',
      method: 'GET',
      params: {
        module: 'profile',
        target_id: id,
        profile_chaining_check: 'false',
        eligible_for_threads_cta: 'false',
      },
    });
  } catch (err) {
    if (notEligible(err)) {
      throw new InvalidTargetUser('@alaminnna/ica-unofficial: not eligible for chaining: ' + id, {});
    }
    throw err;
  }
}

async function fetchSuggestionDetails(client, userId, chainedIds) {
  return client.api.request({
    endpoint: 'discover/fetch_suggestion_details/',
    method: 'GET',
    params: {
      target_id: String(userId),
      chained_ids: String(chainedIds),
      include_social_context: '1',
    },
  });
}

async function getSuggestedProfiles(client, userId, expand) {
  const id = String(userId);
  const chained = await getChaining(client, id);
  if (!expand) {
    return chained;
  }
  const ids = ((chained || {}).users || [])
    .map((u) => u && u.pk)
    .filter(Boolean)
    .map(String)
    .join(',');
  if (!ids) {
    return chained;
  }
  return fetchSuggestionDetails(client, id, ids);
}

async function getRelatedProfiles(client, userId) {
  const id = String(userId);
  try {
    const { publicGraphql } = require('./lookup');
    const data = await publicGraphql(client, {
      queryHash: RELATED_QUERY_HASH,
      variables: { user_id: id, include_chaining: true },
    });
    if (!data || !data.user) {
      throw new UserNotFound('@alaminnna/ica-unofficial: related profiles user not found: ' + id, {});
    }
    const edges = (((data.user || {}).edge_chaining || {}).edges) || [];
    return edges
      .filter((e) => e && e.node)
      .map((e) => normalizeShort(e.node));
  } catch (err) {
    if (err && (err.name === 'UserNotFound' || err.name === 'InvalidTargetUser')) {
      throw err;
    }
    // gated hash — fall back to the reliable mobile surface
    const chained = await getChaining(client, id);
    return ((chained || {}).users || []).map(normalizeShort);
  }
}

async function getRecommendedAccountsForCategory(client, userId) {
  const id = String(userId);
  const { getUserStreamById } = require('./lookup');
  const envelope = await getUserStreamById(client, id);
  let categoryId = null;
  ((envelope || {}).stream_rows || []).forEach((row) => {
    const cid = ((row || {}).user || {}).category_id;
    if (categoryId === null && cid !== undefined && cid !== null) {
      categoryId = cid;
    }
  });
  return client.api.request({
    endpoint: 'discover/recommended_accounts_for_category/',
    method: 'GET',
    params: { target_id: id, category_id: categoryId },
  });
}

module.exports = {
  RELATED_QUERY_HASH,
  getChaining,
  fetchSuggestionDetails,
  getSuggestedProfiles,
  getRelatedProfiles,
  getRecommendedAccountsForCategory,
};