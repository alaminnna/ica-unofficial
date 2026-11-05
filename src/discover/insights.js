/**
 * @alaminnna/ica-unofficial — discover/insights
 *
 * RESPONSIBILITY: insights reads only — account (business) + media inline
 *   insights via ads/graphql. Raw payloads returned (caller picks fields).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../upload/rupload (dumps), client.api
 * MUST NOT:       never assume business account — raise clear errors
 *
 * DEBUG: when insights fail, start looking here — business-account gating
 *   or doc_id drift in ads/graphql
 */

'use strict';

const { dumps } = require('../upload/rupload');

function withQueryParams(data, params) {
  return { ...data, query_params: dumps(params) };
}

async function getAccountInsights(client) {
  const data = withQueryParams({
    surface: 'account',
    doc_id: 2449243051851783,
    locale: 'en_US',
    vc_policy: 'insights_policy',
    strip_nulls: false,
    strip_defaults: false,
  }, {
    IgInsightsGridMediaImage_SIZE: 360,
    activityTab: true,
    audienceTab: true,
    contentTab: true,
    query_params: { access_token: '', id: String(client.userId) },
  });
  const res = await client.api.request({ endpoint: 'ads/graphql/', data });
  const manager = res && res.data && res.data.shadow_instagram_user && res.data.shadow_instagram_user.business_manager;
  if (!manager) {
    throw new Error('@alaminnna/ica-unofficial: account is not a business account (no insights)');
  }
  return manager;
}

async function getMediaInsights(client, mediaPk) {
  if (!mediaPk) {
    throw new Error('@alaminnna/ica-unofficial: getMediaInsights needs { mediaPk }');
  }
  const pk = String(mediaPk).split('_')[0];
  const data = withQueryParams({
    surface: 'post',
    doc_id: 3221905377882880,
    locale: 'en_US',
    vc_policy: 'insights_policy',
    strip_nulls: false,
    strip_defaults: false,
  }, {
    query_params: { access_token: '', id: pk },
  });
  const res = await client.api.request({ endpoint: 'ads/graphql/', data });
  const media = res && res.data && res.data.instagram_post_by_igid;
  if (!media) {
    throw new Error('@alaminnna/ica-unofficial: no insight data for media: ' + pk);
  }
  if (!media.inline_insights_node) {
    throw new Error('@alaminnna/ica-unofficial: media metadata without inline insights: ' + pk);
  }
  return media;
}

module.exports = {
  getAccountInsights,
  getMediaInsights,
};