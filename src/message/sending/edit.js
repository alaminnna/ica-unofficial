/**
 * @alaminnna/ica-unofficial — message/sending/edit
 *
 * RESPONSIBILITY: true Direct message edit via web GraphQL (IGDirectEditMessageMutation).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ../threads/threads (pk resolve), ../../core/device (mutation token)
 * MUST NOT:       never touch listener state; resend fallback only when true edit
 *                 fails and opts.fallback !== false
 *
 * DEBUG: session-bound web fields (fb_dtsg/lsd) are bootstrapped per login from the
 * Instagram web page (see ensureWebSession) — never hardcode one account's tokens.
 * Pass fresh browser values via options.web to override.
 */

'use strict';

const { generateMutationToken } = require('../../core/device');
const { getThread } = require('../threads/threads');
const { sendText, unsendMessage } = require('./send');

const GRAPHQL_API_URL = 'https://www.instagram.com/api/graphql';
const EDIT_DOC_ID = '32480262318254796';
const EDIT_FRIENDLY_NAME = 'IGDirectEditMessageMutation';
const WEB_APP_ID = '936619743392459';
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const WEB_SESSION_TTL_MS = 30 * 60 * 1000;

// App-build constants (not account secrets) — safe to keep as defaults.
const WEB_DEFAULTS = {
  jazoest: null,
  spinR: '1049201819',
  spinB: 'trunk',
  spinT: '1791017666',
  rev: '1049201819',
  hsi: '7692362308289818815',
  hs: '20729.HYP:instagram_web_pkg.2.1...0',
  s: 'f0vp3d:rn38ub:f93dsk',
  dyn: '7xe5WwlEnwn8yEqxemh0no6u5U4e1ZyUW3qi7UK360CEboG4E2vwpUe8hw2nVE4W0qa321Rw8G11wBz81s8hwGxu786a3a1YwBgao6C1uwoE2swlo8od8-U2zxe2Gexe5E2iwNwh8lw8Xxm16wmE4qdw62wLyES1TwVwDwHg2ZwrUK2K2WErwZg2fwxyo6O1fxC1mgO2m3zhAq4rwIxeUnAwCAxW1oxe6U5q0EoKmUhw5nyFEaVE4616wAwj83KwRyrg5e',
  csr: 'gpE2xBmygH4QItQvGRCaiafXVAiEBluyjTrdD9RAe-nftdBtFeF4hF2H-mSgztGmQO24UOA_mjW9qdSABRNalWgDqTnmD8GnhvdnFFHp9fGybYyWEgSpGinCy4sxaTbXy2em9G8hkiUG5bGr_jhp98F2XBAh8CGx2q5WqhoWufU8oybAGdV9Fkqaiyrrzp4idyFpoHyu9gshy6QdVE-4QEK9zk8xiEyEWEN1yqQ4HogAAAKVui-EigC4qjxeufzEGh2E2Tx61UxS0DUb8nx509u0hK03Re0YU0dAE0s1wdK00VmU0dkgKbyk5-1ezpTw5-w1rx163CcwaG3-4k1xybG0wo0AS1F8Elg-86o1mE0xq15IQw4S3q8g6K0Dmr8m4C04Oo2-DgdU09uUzc0qy0li04M404f80bo8myo886J017C0xE1c8oc3tw71wtE7u8gnw0wxw',
  hsdp: 'g4li8wV10Dit5SzTtBt5JdsCBISFetdz8dt218bx9rQg8i8l4OEucghZAOwBCG449zUdy0Maixgyi6k8w8y1ap6p6gK4Aim2e9c8AxiczUSE6XxKawywsUO362aUy6rz-9DwwK1Dwxwke1AwLxC22EdE2Ix2UycUfU8GwZzoiDAxa4oa4m0p60iG0pO09LwiU3Ew3G980Ae0YQ7o6q781so1OoO0Yo1GEsw4Uxnw5zxu0Joiwdm09-wtU1woaojwzwc2hw6DZK48',
  hblp: '4wRw9-dwjqCCxiu6Eiw8-fKq58ym58Fd6ULU9A2Ou3e59e2K3W3-2abx91ZungOhKh246onABUOczUSEGdwh8ixJ2o98G1Cz8qKUGU8HGm6rz-9DCGUiKu1vzohU9Q68Vw-Czogz8qDCx3wwG3q485u13x2XABCUgwKwwWwZzo-FV8ix7xi8yei0hC1Twp88ouzUeoeEiwnU1ao1ZU76m1bwayEf83Uwda0tOi0F84fg2fwaq223q0yocA7o6q784O0BU2cwjUO1Exq3m1dw-wBw42way1swai78198C9xnwywIU14onwbm4E3lw2foiwJzWwp8qwNw921zw_wzBy8G2eq0Kp61Lwho426K0A_rx2',
  sjsp: 'g4li8yiMz10DJQmADvBpnhrjn9FrdGjDjUO3t243nemZ424y5hcH73ohZAOwBwa28w',
  crn: 'comet.igweb.PolarisDirectInboxRoute',
  asbdId: '359341',
};

function pickFirst(html, patterns) {
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      return m[1];
    }
  }
  return null;
}

function charCodeSum(s) {
  let n = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i += 1) {
    n += str.charCodeAt(i);
  }
  return n;
}

// jazoest is derived from the session fb_dtsg (verified against a captured pair).
function withJazoest(web) {
  if (!web.jazoest && web.fbDtsg) {
    web.jazoest = '2' + charCodeSum(web.fbDtsg);
  }
  return web;
}

// Session-bound web tokens for the LOGGED-IN account: manual override wins,
// then 30-min cache, then bootstrap from the Instagram web page (jar cookies).
async function ensureWebSession(client, options) {
  const manual = (options && options.web) || {};
  if (manual.fbDtsg && manual.lsd) {
    return withJazoest({ ...WEB_DEFAULTS, ...manual });
  }
  const cached = client._webSession;
  if (cached && Date.now() - cached.at < WEB_SESSION_TTL_MS && cached.fields.fbDtsg && cached.fields.lsd) {
    return withJazoest({ ...WEB_DEFAULTS, ...cached.fields, ...manual });
  }
  const res = await client.http.axios.get('https://www.instagram.com/', {
    headers: {
      'User-Agent': WEB_UA,
      'X-CSRFToken': client.csrftoken || '',
      Accept: 'text/html',
    },
    timeout: 30000,
  });
  const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
  const fbDtsg = pickFirst(html, [
    /DTSGInitialData[\s\S]{0,800}?"token"\s*:\s*"([^"]+)"/,
    /"token"\s*:\s*"([A-Za-z0-9_\-:]+)"[^}]{0,300}?"async_get_token"/,
  ]);
  const lsd = pickFirst(html, [/"lsd"\s*:\s*"([^"]+)"/]);
  if (!fbDtsg || !lsd) {
    throw new Error('@alaminnna/ica-unofficial: web session bootstrap failed (no fb_dtsg/lsd) — pass fresh values via options.web');
  }
  const actorId = pickFirst(html, [/CurrentUserInitialData[\s\S]{0,800}?"USER_ID"\s*:\s*"(\d+)"/]);
  const fields = {
    fbDtsg,
    lsd,
    actorId: actorId || null,
    spinR: pickFirst(html, [/"__spin_r"\s*:\s*(\d+)/]) || WEB_DEFAULTS.spinR,
    spinT: pickFirst(html, [/"__spin_t"\s*:\s*(\d+)/]) || WEB_DEFAULTS.spinT,
    rev: pickFirst(html, [/"__rev"\s*:\s*"?(\d+)"?/]) || WEB_DEFAULTS.rev,
    hsi: pickFirst(html, [/"hsi"\s*:\s*"(\d+)"/]) || WEB_DEFAULTS.hsi,
  };
  client._webSession = { at: Date.now(), fields };
  return withJazoest({ ...WEB_DEFAULTS, ...fields, ...manual });
}

async function resolveThreadPk(client, threadId, options) {
  if (options && options.threadV2Id) {
    return String(options.threadV2Id);
  }
  const id = String(threadId);
  if (id.length <= 20 && id.indexOf('3402823668') !== 0) {
    return id;
  }
  const thread = await getThread(client, id, { amount: 1 });
  if (!thread || !thread.pk) {
    throw new Error('@alaminnna/ica-unofficial: cannot resolve thread pk for ' + id);
  }
  return String(thread.pk);
}

function parseWebPayload(data) {
  if (typeof data === 'string') {
    const stripped = data.replace(/^for\s*\(\s*;;\s*\)\s*;?/, '');
    try {
      return JSON.parse(stripped);
    } catch (err) {
      return { _raw: stripped.slice(0, 500) };
    }
  }
  return data || {};
}
function toForm(data) {
  return Object.keys(data)
    .filter((k) => data[k] !== undefined && data[k] !== null)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(data[k]))
    .join('&');
}

/**
 * Edit own Direct text message: true web GraphQL edit first; when the server
 * rejects it (or silently ignores it) falls back to unsend + resend so the
 * visible text is always corrected. Pass { fallback: false } to disable.
 * @returns {Promise<boolean|object>} true (edited in place) | resend info (fallback, has .id)
 */
async function editMessage(client, threadId, messageId, newText, options) {
  const opts = options || {};
  const text = newText === undefined || newText === null ? '' : String(newText).trim();
  if (!text) {
    throw new Error('@alaminnna/ica-unofficial: editMessage needs non-empty newText');
  }
  const web = await ensureWebSession(client, opts);
  const threadPk = await resolveThreadPk(client, threadId, opts);
  let targetItemId = null;
  let targetMessageId = null;
  if (opts.targetMessageId) {
    targetMessageId = String(opts.targetMessageId);
  } else if (String(messageId).indexOf('mid.') === 0) {
    targetMessageId = String(messageId);
  } else {
    targetItemId = String(messageId);
  }
  const variables = {
    thread_id: threadPk,
    target_item_id: targetItemId,
    body: { sensitive_string_value: text },
    offline_threading_id: opts.offlineThreadingId || generateMutationToken(),
    target_message_id: targetMessageId,
  };
  const form = toForm({
    av: opts.av || web.actorId || String(client.userId || client.dsUserId || ''),
    __d: 'www',
    __user: '0',
    __a: '1',
    __req: 'z',
    __hs: web.hs,
    dpr: '1',
    __ccg: 'GOOD',
    __rev: web.rev,
    __s: web.s,
    __hsi: web.hsi,
    __dyn: web.dyn,
    __csr: web.csr,
    __hsdp: web.hsdp,
    __hblp: web.hblp,
    __sjsp: web.sjsp,
    __comet_req: '7',
    fb_dtsg: web.fbDtsg,
    jazoest: web.jazoest,
    lsd: web.lsd,
    __spin_r: web.spinR,
    __spin_b: web.spinB,
    __spin_t: web.spinT,
    __crn: web.crn,
    qpl_active_flow_ids: '354954279',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: EDIT_FRIENDLY_NAME,
    server_timestamps: 'true',
    variables: JSON.stringify(variables),
    doc_id: EDIT_DOC_ID,
    fb_api_analytics_tags: '["qpl_active_flow_ids=354954279"]',
  });
  const csrftoken = client.csrftoken || '';
  const fallback = opts.fallback !== false;
  const isMid = String(messageId).indexOf('mid.') === 0;
  let graphDetail = '';
  let graphed = false;
  try {
    const res = await client.http.axios.post(GRAPHQL_API_URL, form, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-CSRFToken': csrftoken,
        'X-IG-App-ID': WEB_APP_ID,
        'X-FB-Friendly-Name': EDIT_FRIENDLY_NAME,
        'X-FB-LSD': web.lsd,
        'X-ASBD-ID': web.asbdId,
        Origin: 'https://www.instagram.com',
        Referer: 'https://www.instagram.com/direct/t/' + threadPk + '/',
        'User-Agent': WEB_UA,
        Priority: 'u=1, i',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      timeout: 30000,
    });
    const json = parseWebPayload(res && res.data);
    if (json.errors) {
      graphDetail = JSON.stringify(json.errors).slice(0, 300);
    } else if (json.error) {
      graphDetail = json.error + ' ' + (json.errorSummary || '') + ': ' + String(json.errorDescription || json.message || '').slice(0, 300);
    } else {
      graphed = true;
    }
  } catch (err) {
    const data = err && err.response && err.response.data;
    const snippet = (typeof data === 'object' ? JSON.stringify(data) : String(data || '')).slice(0, 200);
    graphDetail = 'HTTP ' + ((err && err.response && err.response.status) || '?') + ': ' + (snippet || String((err && err.message) || err).slice(0, 200));
  }
  if (graphed) {
    const applied = await verifyEditApplied(client, threadId, messageId, text);
    if (applied) {
      return true;
    }
    graphDetail = graphDetail || 'server accepted but text unchanged';
  }
  if (!fallback || isMid) {
    throw new Error('@alaminnna/ica-unofficial: editMessage failed: ' + (graphDetail || 'unknown'));
  }
  client._lastEditNote = graphDetail || 'silent-noop';
  const deleted = await unsendMessage(client, threadId, messageId);
  if (!deleted) {
    throw new Error('@alaminnna/ica-unofficial: edit fallback unsend failed: ' + (graphDetail || 'unknown'));
  }
  const info = await sendText(client, { text, threadIds: [threadId] });
  const resent = await verifyEditApplied(client, threadId, info && info.id, text);
  if (!resent) {
    throw new Error('@alaminnna/ica-unofficial: edit fallback resend not visible');
  }
  return info;
}

async function verifyEditApplied(client, threadId, messageId, text) {
  try {
    const thread = await getThread(client, threadId, { amount: 10 });
    const msg = ((thread && thread.messages) || []).find((m) => String(m.id) === String(messageId));
    if (!msg) {
      return false;
    }
    const body = msg.text === undefined || msg.text === null ? msg.link_text || '' : msg.text;
    return String(body) === text;
  } catch (err) {
    return false;
  }
}

module.exports = { editMessage, ensureWebSession, GRAPHQL_API_URL, EDIT_DOC_ID, EDIT_FRIENDLY_NAME, WEB_DEFAULTS };
