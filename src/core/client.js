/**
 * @alaminnna/ica-unofficial — core/client
 * 
 * RESPONSIBILITY: composition root: Client builds device/http/session and composes all mixins.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./*, ../auth, ../message, ../user, ../account, ../media
 * MUST NOT:       never implement feature logic here — only wiring
 * 
 * DEBUG: when any client.* method is missing, start looking here — mixin wiring in the constructor
 */

'use strict';

const { createLogger } = require('./logger');
const log = createLogger('CORE');
const { createHttpClient, createApiClient } = require('./http');
const { buildBaseHeaders } = require('./headers');
const { createDeviceBundle } = require('./device');
const { useAuth } = require('../auth');
const { useMessage } = require('../message');
const { useUser } = require('../user');
const { useAccount } = require('../account');
const { generateTOTP } = require('../auth/totp');
const { createIdentityCache } = require('../user/cache');
const { RateGuard } = require('./delays');
const { useMedia } = require('../media');
const { useUpload } = require('../upload');
const { useStory } = require('../story');
const { useDiscover } = require('../discover');

class Client {
  constructor(options) {
    const opts = options || {};
    this.options = opts;
    this.http = createHttpClient({ proxy: opts.proxy });
    this.clientLog = (opts.log && typeof opts.log.debug === 'function') ? opts.log : { debug() {}, info() {}, error() {} };
    if (opts.proxy) {
      const { maskProxy } = require('./proxy');
      this.clientLog.debug('proxy on ' + maskProxy(opts.proxy));
      this.checkProxyIp().catch(() => {});
    } else {
      this.clientLog.debug('proxy off');
    }
    this.bundle = createDeviceBundle((opts.settings && opts.settings.bundle) || null);
    this.authorizationData = {};
    this.mid = '';
    this.igURur = '';
    this.igWwwClaim = '';
    this.bloksVersioningId = this.bundle.deviceSettings.bloks_versioning_id;
    this.caaAac = '';
    this.caaWaterfallId = '';
    this.username = null;
    this.password = null;
    this.userId = null;
    this.phoneNumber = null;
    this.lastLogin = null;
    this.reloginAttempt = 0;
    this.challengeCodeHandler = opts.challengeCodeHandler || null;
    this.changePasswordHandler = opts.changePasswordHandler || null;
    this.authLog = (opts.log && typeof opts.log.info === 'function') ? opts.log.info.bind(opts.log) : () => {};
    this.cooldownUntil = 0;
    this.cooldownReason = '';
    this.settings = {};
    this.publicGet = opts.publicGet || null;
    this.rateGuard = opts.rateGuard || new RateGuard();
    this.identityCache = opts.identityCache || createIdentityCache();
    const self = this;
    this.api = opts.apiClient || createApiClient({
      axios: this.http.axios,
      baseHeaders: () => buildBaseHeaders(self),
      getAuthHeader: () => self.getAuthHeader(),
      onMid: (mid) => {
        self.mid = mid;
      },
      onCooldown: (info) => {
        self.cooldownUntil = info.until;
        self.cooldownReason = info.reason;
      },
    });
    useAuth(this);
    useMessage(this);
    useUser(this);
    useAccount(this);
    useMedia(this);
    useUpload(this);
    useStory(this);
    useDiscover(this);
    this.generateTOTP = (seed, opts) => generateTOTP(seed, opts);
    log.debug('client initialized');
  }

  getAuthHeader() {
    if (!this.authorizationData || !this.authorizationData.sessionid) {
      return '';
    }
    return 'Bearer IGT:2:' + Buffer.from(JSON.stringify(this.authorizationData)).toString('base64');
  }

  async checkProxyIp() {
    try {
      const res = await this.http.axios.get('https://api.ipify.org?format=json', { timeout: 8000 });
      this.clientLog.debug('proxy ip check: ' + ((res && res.data && res.data.ip) || 'unknown'));
    } catch (err) {
      this.clientLog.debug('proxy ip check skipped');
    }
  }

  cookies() {
    return this.http.jar.getCookiesSync('https://i.instagram.com');
  }

  cookieValue(name) {
    const found = this.cookies().find((c) => c.key === name);
    return found ? found.value : '';
  }

  get sessionid() {
    return this.cookieValue('sessionid') || this.authorizationData.sessionid || '';
  }

  get dsUserId() {
    return this.cookieValue('ds_user_id') || this.authorizationData.ds_user_id || '';
  }

  get csrftoken() {
    return this.cookieValue('csrftoken') || this.bundle.csrftoken;
  }

  get rankToken() {
    return this.userId ? String(this.userId) + '_' + this.bundle.uuids.uuid : '';
  }

  get phoneId() {
    return this.bundle.uuids.phone_id;
  }

  get uuid() {
    return this.bundle.uuids.uuid;
  }

  get androidDeviceId() {
    return this.bundle.uuids.android_device_id;
  }

  get userAgent() {
    return this.bundle.userAgent;
  }

  get appVersion() {
    return this.bundle.deviceSettings.app_version;
  }

  get locale() {
    return this.bundle.locale;
  }

  get country() {
    return this.bundle.country;
  }

  async getCurrentUser() {
    const data = await this.api.request({ endpoint: 'accounts/current_user/', method: 'GET', params: { edit: 'true' } });
    const user = (data && data.user) || {};
    if (user.username) {
      this.username = user.username;
    }
    if (user.pk) {
      this.userId = Number(user.pk);
    }
    return user;
  }

  async logout() {
    const res = await this.api.request({ endpoint: 'accounts/logout/', data: { one_tap_app_login: true } });
    if ((res && res.status) === 'ok') {
      this.authorizationData = {};
      this.lastLogin = null;
      this.reloginAttempt = 0;
      this.http.jar.removeAllCookiesSync();
      return true;
    }
    return false;
  }
}

module.exports = { Client };