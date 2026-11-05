/**
 * @alaminnna/ica-unofficial — core/http
 * 
 * RESPONSIBILITY: HTTP layer: axios+jar, retries, cooldowns, error mapping to exceptions,
 *   private GraphQL query transport.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./logger, ./headers, axios, tough-cookie, ../exceptions (lazy)
 * MUST NOT:       never swallow mapped errors
 * 
 * DEBUG: when 429/feedback/JSON-decode hits, start looking here — retry and mapping logic
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('HTTP');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const APP_ID = '567067343352427';
const RETRY_STATUSES = [429, 500, 502, 503, 504];
const PRIVATE_GRAPHQL_QUERY_URL = 'https://i.instagram.com/graphql/query';

function createHttpClient(options) {
  const opts = options || {};
  const jar = new CookieJar();
  const axiosConfig = { jar, withCredentials: true };
  if (opts.proxy) {
    const { parseProxy, buildProxyAgents } = require('./proxy');
    const parsed = parseProxy(opts.proxy);
    const agents = buildProxyAgents(parsed);
    if (agents && agents.axiosProxy) {
      axiosConfig.proxy = agents.axiosProxy;
    }
    if (agents && agents.httpAgent) {
      axiosConfig.httpAgent = agents.httpAgent;
      axiosConfig.httpsAgent = agents.httpsAgent;
      axiosConfig.proxy = false;
    }
  }
  const instance = wrapper(axios.create(axiosConfig));
  async function request(config, retries) {
    const remaining = retries === undefined ? 3 : retries;
    try {
      return await instance.request(config);
    } catch (err) {
      const status = err && err.response && err.response.status;
      if (remaining > 0 && RETRY_STATUSES.indexOf(status) !== -1) {
        return request(config, remaining - 1);
      }
      throw err;
    }
  }
  return { axios: instance, jar, request, APP_ID, RETRY_STATUSES };
}

function toFormBody(data) {
  const params = new URLSearchParams();
  Object.keys(data || {}).forEach((key) => {
    if (data[key] !== undefined && data[key] !== null) {
      params.append(key, String(data[key]));
    }
  });
  return params.toString();
}

function buildUrl(endpoint, domain) {
  const path = endpoint.startsWith('/') ? endpoint : '/v1/' + endpoint;
  return 'https://' + (domain || 'i.instagram.com') + '/api' + path;
}

function parseRetryAfter(headers) {
  const raw = headers && (headers['retry-after'] || headers['Retry-After']);
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) {
    return Math.min(Math.max(0, seconds) * 1000, 120000);
  }
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) {
    return Math.min(Math.max(0, at - Date.now()), 120000);
  }
  return null;
}

function throwMappedError(status, json, endpoint, rawText, hooks) {
  const data = json && typeof json === 'object' ? json : {};
  const extra = { ...data, statusCode: status };
  const message = data.message || '';
  const ex = require('../exceptions');
  const cool = hooks && hooks.onCooldown;
  if (message === 'Please wait a few minutes' || message.indexOf('Please wait a few minutes') !== -1) {
    if (cool) {
      cool({ until: Date.now() + 600000, reason: 'PleaseWaitFewMinutes' });
    }
    const PleaseWait = ex.PleaseWaitFewMinutes || ex.ClientError;
    throw new PleaseWait(message, extra);
  }
  if (status === 403) {
    if (message === 'login_required') {
      throw new ex.SessionExpired(message || 'login_required', extra);
    }
    if (rawText && rawText.length < 512) {
      extra.message = rawText;
    }
    throw new ex.ClientForbiddenError(message, extra);
  }
  if (status === 400) {
    if (data.two_factor_info) {
      if (!data.message) {
        data.message = 'Two-factor authentication required';
        extra.message = data.message;
      }
      if (data.error_type !== 'two_factor_required') {
        data.error_type = 'two_factor_required';
        extra.error_type = 'two_factor_required';
      }
      throw new ex.TwoFactorRequired(data.message, extra);
    }
    if (message === 'challenge_required') {
      const url = ((data.challenge || {}).url) || '';
      if (url.indexOf('/suspended/') !== -1) {
        throw new ex.AccountSuspended(message, extra);
      }
      throw new ex.ChallengeRequired(message, extra);
    }
    if (message === 'feedback_required') {
      if (cool) {
        cool({ until: Date.now() + 600000, reason: 'FeedbackRequired' });
      }
      throw new ex.FeedbackRequired(message + ': ' + (data.feedback_message || ''), extra);
    }
    const errorType = data.error_type;
    if (errorType === 'sentry_block' || errorType === 'rate_limit_error') {
      throw new ex.ClientError(message, extra);
    }
    if (errorType === 'bad_password') {
      throw new ex.BadPassword(message || 'Instagram rejected the login credentials.', extra);
    }
    if (errorType === 'two_factor_required') {
      throw new ex.TwoFactorRequired(message || 'Two-factor authentication required', extra);
    }
    if (message.indexOf('The username you entered') !== -1) {
      throw new ex.ProxyAddressIsBlocked('Instagram has blocked your IP address, use a quality proxy provider (not free, not shared)', extra);
    }
    if (errorType || message) {
      throw new ex.UnknownError(message, extra);
    }
    throw new ex.ClientBadRequestError(message, extra);
  }
  if (status === 429) {
    throw new ex.ClientThrottledError(message, extra);
  }
  if (status === 401) {
    throw new ex.ClientUnauthorizedError(message, extra);
  }
  if (status === 404) {
    if (rawText === 'Not Found') {
      throw new ex.ChallengeRequired(message, extra);
    }
    throw new ex.ClientNotFoundError(message, extra);
  }
  if (status === 408) {
    throw new ex.ClientRequestTimeout(message, extra);
  }
  throw new ex.ClientError(message, extra);
}
function createApiClient(deps) {
  const api = {
    lastJson: {},
    lastResponse: null,
    async request(opts) {
      const ex = require('../exceptions');
      const endpoint = opts.endpoint;
      const method = (opts.method || 'POST').toUpperCase();
      log.debug(method + ' ' + endpoint);
      const url = buildUrl(endpoint, opts.domain);
      const headers = { ...deps.baseHeaders(), ...(opts.headers || {}) };
      const auth = deps.getAuthHeader();
      if (auth && !headers.Authorization && !headers.authorization) {
        headers.Authorization = auth;
      }
      const config = { method, url, headers };
      if (method === 'POST' || opts.data) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
        let body = toFormBody(opts.data);
        if (opts.withSignature) {
          body = 'signed_body=SIGNATURE.' + encodeURIComponent(body);
        }
        config.data = body;
      }
      if (opts.params) {
        config.params = opts.params;
      }
      if (!opts.login && deps.sleepMs) {
        await deps.sleepMs();
      }
      const RETRYABLE = [429, 500, 502, 503, 504];
      let res;
      for (let attempt = 0; ; attempt += 1) {
        try {
          res = await deps.axios.request({ timeout: 30000, ...config });
          break;
        } catch (err) {
          const status = err && err.response && err.response.status;
          const retryable = !err.response || RETRYABLE.indexOf(status) !== -1;
          if (!retryable || attempt >= 3) {
            if (err && err.response) {
              let json = {};
              let rawText = '';
              try {
                json = typeof err.response.data === 'object' ? err.response.data : JSON.parse(err.response.data);
              } catch (parseErr) {
                rawText = String(err.response.data);
              }
              api.lastJson = json;
              api.lastResponse = err.response;
              throwMappedError(status, json, endpoint, rawText, { onCooldown: deps.onCooldown });
            }
            throw new ex.ClientConnectionError(String((err && err.message) || err), {});
          }
          const retryAfter = parseRetryAfter(err.response ? err.response.headers : null);
          const waitMs = retryAfter === null ? 1000 * (attempt + 1) : retryAfter;
          log.debug('retry ' + endpoint + ' in ' + waitMs + 'ms (attempt ' + (attempt + 1) + ')');
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
      const resHeaders = res.headers || {};
      const mid = resHeaders['ig-set-x-mid'] || resHeaders['IG-Set-X-Mid'];
      if (mid && deps.onMid) {
        deps.onMid(mid);
      }
      let json;
      try {
        json = typeof res.data === 'object' ? res.data : JSON.parse(res.data);
      } catch (err) {
        throw new ex.ClientJSONDecodeError('JSONDecodeError while opening ' + url, {});
      }
      api.lastJson = json;
      api.lastResponse = res;
      if (json && json.status === 'fail') {
        throw new ex.ClientError(json.message || 'request failed', { ...json });
      }
      if (json && json.error_title) {
        throw new ex.ClientError(json.message || 'request failed', { ...json });
      }
      return json;
    },
  };
  return api;
}

async function privateGraphqlQuery(client, options) {
  const opts = options || {};
  const { buildBaseHeaders } = require('./headers');
  const data = {
    method: 'post',
    pretty: 'false',
    format: 'json',
    server_timestamps: 'true',
    locale: 'user',
    fb_api_req_friendly_name: opts.friendlyName,
    enable_canonical_naming: 'true',
    enable_canonical_variable_overrides: 'true',
    enable_canonical_naming_ambiguous_type_prefixing: 'true',
    variables: JSON.stringify(opts.variables || {}),
  };
  if (opts.clientDocId) {
    data.client_doc_id = String(opts.clientDocId);
  }
  const headers = {
    ...buildBaseHeaders(client),
    'X-FB-Friendly-Name': opts.friendlyName,
    'X-Root-Field-Name': opts.rootField,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  };
  if (opts.clientDocId) {
    headers['X-Client-Doc-Id'] = String(opts.clientDocId);
  }
  if (opts.priority) {
    headers.Priority = opts.priority;
  }
  Object.assign(headers, opts.extraHeaders || {});
  const authHeader = typeof client.getAuthHeader === 'function' ? client.getAuthHeader() : '';
  if (authHeader && !headers.Authorization) {
    headers.Authorization = authHeader;
  }
  const form = Object.keys(data)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(data[k]))
    .join('&');
  const res = await client.http.axios.post(PRIVATE_GRAPHQL_QUERY_URL, form, { headers, timeout: 30000 });
  const json = (res && res.data) || {};
  const payload = (json && json.data) || json || {};
  if (opts.rootField) {
    if (payload[opts.rootField] && typeof payload[opts.rootField] === 'object') {
      return payload[opts.rootField];
    }
    const key = Object.keys(payload).find((k) => k.indexOf(opts.rootField) !== -1 && typeof payload[k] === 'object');
    if (key) {
      return payload[key];
    }
  }
  return payload;
}

module.exports = { createHttpClient, APP_ID, RETRY_STATUSES, createApiClient, throwMappedError, buildUrl, parseRetryAfter, privateGraphqlQuery, PRIVATE_GRAPHQL_QUERY_URL };