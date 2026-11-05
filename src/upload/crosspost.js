/**
 * @alaminnna/ica-unofficial — upload/crosspost
 *
 * RESPONSIBILITY: cross-post discovery + extra_data builders only — FB feed/reel
 *   destinations, Threads profile, coauthor invites, schedule_at. Discovery runs
 *   BEFORE bytes upload; raises clear errors when unconfirmed.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./rupload (graphqlWww, dumps), ../core/delays
 * MUST NOT:       never treat Account Center linking ids as publish destinations
 *
 * DEBUG: when cross-post silently doesn't happen, start looking here — destination
 *   resolution (unified config → connected services → explicit overrides)
 */

'use strict';

const { graphqlWww, dumps, GRAPHQL_QUERY_URL } = require('./rupload');

const FB_UNIFIED_DOC_ID = '216179630714134719310007237117';
const FB_UNIFIED_FRIENDLY = 'CrosspostingUnifiedConfigsQuery';
const FB_UNIFIED_ROOT = 'xcxp_unified_crossposting_configs_root';
const FB_SERVICES_DOC_ID = '21631519911413744205623093060';
const FB_SERVICES_FRIENDLY = 'FxIgConnectedServicesInfoQuery';
const FB_SERVICES_ROOT = 'fx_service_cache';
const THREADS_DOC_ID = '1294688273527445410149299611';
const THREADS_FRIENDLY = 'LinkedBarcelonaProfileQuery';
const THREADS_ROOT = 'xcxp_fetch_linked_threads_profile';

const FB_FEED_SURFACE = { source_surface: 'FEED', destination_app: 'FB', destination_surface: 'FEED' };

function iterDicts(value, out) {
  const acc = out || [];
  if (Array.isArray(value)) {
    value.forEach((child) => iterDicts(child, acc));
  } else if (value && typeof value === 'object') {
    acc.push(value);
    Object.keys(value).forEach((k) => iterDicts(value[k], acc));
  }
  return acc;
}

function candidateValue(config, keys) {
  for (const key of keys) {
    const value = config[key];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function graphqlRoot(config, rootField) {
  const data = (config || {}).data;
  if (data && typeof data === 'object') {
    if (data[rootField] !== undefined && data[rootField] !== null) {
      return data[rootField];
    }
    for (const key of Object.keys(data)) {
      if (key.indexOf(rootField) !== -1) {
        return data[key];
      }
    }
  }
  if ((config || {})[rootField] !== undefined && (config || {})[rootField] !== null) {
    return config[rootField];
  }
  for (const key of Object.keys(config || {})) {
    if (key.indexOf(rootField) !== -1) {
      return config[key];
    }
  }
  return config || {};
}

function normalizeBypass(value) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return null;
  }
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (ignored) {
      list = [list];
    }
  }
  if (!Array.isArray(list)) {
    list = [list];
  }
  return list.map((item) => String(item));
}

function stripFbPrefix(typeText) {
  let text = String(typeText || '').toUpperCase();
  if (text.indexOf('FB_') === 0) {
    text = text.slice(3);
  }
  return text;
}

async function fbUnifiedConfig(client, surfaces) {
  return graphqlWww(client, {
    friendlyName: FB_UNIFIED_FRIENDLY,
    variables: { configs_request: { source_app: 'IG', crosspost_app_surface_list: surfaces } },
    clientDocId: FB_UNIFIED_DOC_ID,
    extraHeaders: { 'X-Root-Field-Name': FB_UNIFIED_ROOT, Priority: 'u=3, i', 'X-FB-RMD': 'state=URL_ELIGIBLE' },
    purpose: null,
  });
}

async function fbConnectedServices(client) {
  return graphqlWww(client, {
    friendlyName: FB_SERVICES_FRIENDLY,
    variables: {
      service_names: ['CROSS_POSTING_SETTING'],
      custom_partner_params: [
        { value: 'FB', key: 'CROSSPOSTING_DESTINATION_APP' },
        { value: '', key: 'CROSSPOSTING_SHARE_TO_SURFACE' },
        { value: 'true', key: 'OVERRIDE_USER_VALIDATION_WITH_CXP_ELIGIBILITY_RULE' },
      ],
      client_caller_name: 'ig_android_service_cache_crossposting_setting',
      caller_name: 'fx_product_foundation_client_FXOnline_client_cache',
    },
    clientDocId: FB_SERVICES_DOC_ID,
    extraHeaders: { Priority: 'u=3, i', 'X-FB-RMD': 'state=URL_ELIGIBLE', 'X-Root-Field-Name': FB_SERVICES_ROOT },
    purpose: null,
  });
}

function fbCandidatesFromUnified(config, surface) {
  const root = graphqlRoot(config, FB_UNIFIED_ROOT);
  const out = [];
  iterDicts(root).forEach((node) => {
    const mappings = node.identity_mapping;
    if (!Array.isArray(mappings)) {
      return;
    }
    mappings.forEach((mapping) => {
      (mapping.destination_identities || []).forEach((dest) => {
        if (dest && typeof dest === 'object') {
          out.push({ source_surface: surface, destination_app: 'FB', destination_surface: surface, ...dest });
        }
      });
    });
  });
  return out;
}

// Resolve a confirmed FB FEED destination. Throws clear Error when unconfirmed.
async function fbFeedDestination(client, options) {
  const opts = options || {};
  if (opts.destinationId && opts.destinationType) {
    return { destination_id: String(opts.destinationId), destination_type: stripFbPrefix(opts.destinationType) };
  }
  const variants = [undefined, [FB_FEED_SURFACE]];
  for (const surfaces of variants) {
    const config = opts.config || await fbUnifiedConfig(client, surfaces);
    const candidates = fbCandidatesFromUnified(config, 'FEED');
    for (const candidate of candidates) {
      const id = candidateValue(candidate, ['share_to_fb_destination_id', 'obfuscated_identity_id', 'identity_id', 'feed_destination_id', 'destination_id']);
      const type = candidateValue(candidate, ['share_to_fb_destination_type', 'identity_type', 'destination_type']);
      if (id && type && (stripFbPrefix(type) === 'USER' || stripFbPrefix(type) === 'PAGE')) {
        return { destination_id: String(id), destination_type: stripFbPrefix(type) };
      }
    }
    if (opts.config) {
      break;
    }
  }
  if (!opts.config && !(opts.destinationId || opts.destinationType)) {
    try {
      const services = await fbConnectedServices(client);
      const root = graphqlRoot(services, FB_SERVICES_ROOT);
      const found = iterDicts(root).map((n) => candidateValue(n, ['share_to_fb_destination_id', 'destination_id'])).find(Boolean);
      if (found) {
        return { destination_id: String(found), destination_type: 'USER' };
      }
    } catch (ignored) {
      // fall through to the clear error below
    }
  }
  throw new Error('@alaminnna/ica-unofficial: Facebook Feed sharing has no confirmed destination. Link a Facebook account/page or pass destinationId+destinationType.');
}

// Resolve a confirmed FB REELS destination (audience + bypass aware).
async function fbReelsDestination(client, options) {
  const opts = options || {};
  if (opts.destinationId && opts.destinationType) {
    return { destination_id: String(opts.destinationId), destination_type: stripFbPrefix(opts.destinationType) };
  }
  const config = opts.config || await fbUnifiedConfig(client, undefined);
  const candidates = fbCandidatesFromUnified(config, 'REELS');
  for (const candidate of candidates) {
    const id = candidateValue(candidate, ['share_to_fb_destination_id', 'obfuscated_identity_id', 'identity_id', 'reels_destination_id', 'destination_id']);
    const type = candidateValue(candidate, ['share_to_fb_destination_type', 'identity_type', 'destination_type']);
    if (id && type && (stripFbPrefix(type) === 'USER' || stripFbPrefix(type) === 'PAGE')) {
      const audience = candidateValue(candidate, ['share_to_fb_destination_audience_type', 'reels_destination_audience_type', 'destination_audience_type']);
      return { destination_id: String(id), destination_type: stripFbPrefix(type), destination_audience_type: audience ? String(audience) : null };
    }
  }
  throw new Error('@alaminnna/ica-unofficial: Facebook Reel sharing has no confirmed destination. Link a Facebook account/page or pass destinationId+destinationType.');
}

function fbFeedExtraData(destination, bypass) {
  const data = {
    share_to_facebook: '1',
    share_to_fb_destination_id: destination.destination_id,
    share_to_fb_destination_type: destination.destination_type,
    no_token_crosspost: '1',
    attempt_id: require('../core/utils').uuid4(),
  };
  const normalized = normalizeBypass(bypass);
  if (normalized) {
    data.share_to_facebook_validation_bypass = normalized;
  }
  return data;
}

function fbReelsExtraData(destination, bypass) {
  const data = {
    share_to_facebook: '1',
    is_reel_shared_to_fb: true,
    share_to_facebook_reels: true,
    cross_app_share_type: '2',
    share_to_fb_destination_id: destination.destination_id,
    share_to_fb_destination_type: destination.destination_type,
    xpost_surface: 'IG_REELS_COMPOSER',
    no_token_crosspost: '1',
    attempt_id: require('../core/utils').uuid4(),
  };
  if (destination.destination_audience_type) {
    data.share_to_fb_destination_audience_type = destination.destination_audience_type;
  }
  const normalized = normalizeBypass(bypass);
  if (normalized) {
    data.share_to_facebook_validation_bypass = dumps(normalized).split(' ').join('');
    data.validation_check_bypass = true;
  }
  return data;
}

// Threads linked profile discovery (GraphQL www, fallback query transport).
async function threadsDestination(client, options) {
  const opts = options || {};
  if (opts.destinationId) {
    return { destination_id: String(opts.destinationId) };
  }
  let config = opts.config;
  if (!config) {
    const base = {
      friendlyName: THREADS_FRIENDLY,
      variables: {},
      clientDocId: THREADS_DOC_ID,
      extraHeaders: { 'X-Root-Field-Name': THREADS_ROOT, Priority: 'u=3, i', 'X-FB-RMD': 'state=URL_ELIGIBLE' },
      purpose: null,
    };
    try {
      config = await graphqlWww(client, base);
    } catch (wwwErr) {
      config = await graphqlWww(client, { ...base, url: GRAPHQL_QUERY_URL });
    }
  }
  const profile = graphqlRoot(config, THREADS_ROOT) || {};
  const id = candidateValue(profile, ['id', 'strong_id__', 'destination_id', 'obfuscated_identity_id']);
  if (!id) {
    throw new Error('@alaminnna/ica-unofficial: Threads sharing has no linked Threads profile. Link one or pass destinationId.');
  }
  return { destination_id: String(id) };
}

function threadsExtraData(destination, bypass) {
  const data = { share_to_threads: '1', share_to_threads_destination_id: destination.destination_id };
  const normalized = normalizeBypass(bypass);
  if (normalized) {
    data.share_to_threads_validation_bypass = normalized;
  }
  return data;
}

// Port of with_coauthor_user_ids: sets invite_coauthor_user_ids, conflicts raise.
function withCoauthorIds(extraData, ids) {
  const data = { ...(extraData || {}) };
  if (ids === undefined || ids === null) {
    return data;
  }
  if (!Array.isArray(ids)) {
    throw new Error('@alaminnna/ica-unofficial: coauthorUserIds must be a list of user IDs.');
  }
  if (data.invite_coauthor_user_ids !== undefined || data.invite_coauthor_user_id !== undefined) {
    throw new Error("@alaminnna/ica-unofficial: use either coauthorUserIds or extraData['invite_coauthor_user_ids'], not both.");
  }
  data.invite_coauthor_user_ids = ids.map((id) => String(id));
  return data;
}

// Port of _scheduled_extra_data: publish_mode + content_scheduling_metadata.
function withSchedule(extraData, scheduleAt) {
  const data = { ...(extraData || {}) };
  if (scheduleAt === undefined || scheduleAt === null) {
    return data;
  }
  const ts = scheduleAt instanceof Date ? Math.floor(scheduleAt.getTime() / 1000) : Number(scheduleAt);
  if (!ts) {
    throw new Error('@alaminnna/ica-unofficial: scheduleAt must be a unix timestamp or Date.');
  }
  data.publish_mode = 'scheduled';
  data.content_scheduling_metadata = dumps({ scheduled_publish_time: ts });
  return data;
}

// Feed crosspost resolver (photo/video/album): discovery BEFORE bytes, explicit extra_data wins.
async function resolveFeedCrosspost(client, options) {
  const opts = options || {};
  const generated = {};
  if (opts.shareToFacebook) {
    const dest = await fbFeedDestination(client, {
      destinationId: opts.fbDestinationId,
      destinationType: opts.fbDestinationType,
    });
    Object.assign(generated, fbFeedExtraData(dest, opts.fbValidationBypass));
  }
  if (opts.shareToThreads) {
    const dest = await threadsDestination(client, { destinationId: opts.threadsDestinationId });
    Object.assign(generated, threadsExtraData(dest, opts.threadsValidationBypass));
  }
  return { ...generated, ...(opts.extraData || {}) };
}

// Reel crosspost resolver (clip): FB reels variant + shared Threads shape.
async function resolveReelsCrosspost(client, options) {
  const opts = options || {};
  const generated = {};
  if (opts.shareToFacebook) {
    const dest = await fbReelsDestination(client, {
      destinationId: opts.fbDestinationId,
      destinationType: opts.fbDestinationType,
    });
    Object.assign(generated, fbReelsExtraData(dest, opts.fbValidationBypass));
  }
  if (opts.shareToThreads) {
    const dest = await threadsDestination(client, { destinationId: opts.threadsDestinationId });
    Object.assign(generated, threadsExtraData(dest, opts.threadsValidationBypass));
  }
  return { ...generated, ...(opts.extraData || {}) };
}

module.exports = {
  fbFeedDestination,
  fbReelsDestination,
  fbFeedExtraData,
  fbReelsExtraData,
  threadsDestination,
  threadsExtraData,
  withCoauthorIds,
  withSchedule,
  resolveFeedCrosspost,
  resolveReelsCrosspost,
};