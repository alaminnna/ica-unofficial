/**
 * @alaminnna/ica-unofficial — auth/caa
 * 
 * RESPONSIBILITY: CAA (Bloks) login path with legacy fallback markers.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./bloks, ../core/crypto, ../exceptions
 * MUST NOT:       never bypass challenge on failure
 * 
 * DEBUG: when CAA keeps falling back to legacy, start looking here — availability markers
 */

'use strict';

const bloks = require('./bloks');
const { passwordEncrypt } = require('../core/crypto');
const { ClientError, ChallengeError } = require('../exceptions');

const CAA_DOMAIN = 'b.i.instagram.com';
const AP_2SV_ENTRYPOINT = 'com.bloks.www.ap.two_step_verification.entrypoint_async';
const AP_2SV_CODE_ENTRY = 'com.bloks.www.ap.two_step_verification.code_entry';
const AP_2SV_CODE_ENTRY_ASYNC = 'com.bloks.www.ap.two_step_verification.code_entry_async';
const CAA_EXPERIMENT = 'caa_iteration_v3_perf_ig_4';
const CAA_MARKER_ID = 36707139;

function newWaterfallId() {
  return require('../core/utils').uuid4();
}

function caaNetworkInfo() {
  return {
    active_subscriptions_info: null,
    default_subscription_info: {
      network_type: null,
      is_data_roaming: 1,
      is_esim: null,
      is_gsm_roaming: 0,
      is_sim_sms_capable: null,
      is_mobile_data_enabled: 1,
      sim_carrier_id: 1,
      sim_carrier_id_name: null,
      sim_state: 5,
      sim_operator: '310260',
      sim_operator_name: 'T-Mobile',
      signal_strength: null,
      group_id_level_1: null,
      network_operator: '310260',
    },
    is_airplane_mode: 0,
    is_active_network_cellular: 0,
    is_device_sms_capable: 1,
    sim_count: 1,
    is_wifi: 1,
  };
}

async function caaProcessClientData(client, waterfallId, domain) {
  client.caaWaterfallId = waterfallId || newWaterfallId();
  client.caaAac = '';
  const result = await bloks.bloksAsyncAction(client, 'com.bloks.www.bloks.caa.login.process_client_data_and_redirect', {
    is_from_logged_out: false,
    logged_out_user: '',
    qpl_join_id: null,
    family_device_id: client.bundle.uuids.phone_id,
    device_id: client.bundle.uuids.android_device_id,
    offline_experiment_group: CAA_EXPERIMENT,
    waterfall_id: client.caaWaterfallId,
    logout_source: '',
    show_internal_settings: false,
    last_auto_login_time: 0,
    disable_auto_login: false,
    qe_device_id: client.bundle.uuids.uuid,
    use_auto_login_interstitial: true,
    disable_recursive_auto_login_interstitial: true,
    auto_login_interstitial_experiment_group_name: '',
    is_from_logged_in_switcher: false,
    switcher_logged_in_uid: '',
    account_list: [],
    blocked_uid: [],
    INTERNAL_INFRA_THEME: 'THREE_NEUTRAL_GRAY',
    layered_homepage_experiment_group: 'Deploy: Not in Experiment',
    launched_url: '',
    sim_phone_numbers: [],
    is_from_registration_reminder: false,
  }, { domain: domain || CAA_DOMAIN });
  client.caaAac = bloks.extractAac(result);
  return result;
}

async function caaOauthFetch(client, username, domain) {
  client.caaWaterfallId = client.caaWaterfallId || newWaterfallId();
  return bloks.bloksAsyncAction(client, 'com.bloks.www.caa.login.oauth.token.fetch.async', {
    client_input_params: {
      username_input: username || client.username,
      si_device_param_network_info: caaNetworkInfo(),
      aac: client.caaAac,
      lois_settings: { lois_token: '' },
      cloud_trust_token: null,
      zero_balance_state: '',
      network_bssid: null,
    },
    server_params: {
      is_from_logged_out: 0,
      layered_homepage_experiment_group: 'Deploy: Not in Experiment',
      device_id: client.bundle.uuids.android_device_id,
      login_surface: 'login_home',
      waterfall_id: client.caaWaterfallId,
      INTERNAL__latency_qpl_instance_id: Date.now(),
      is_platform_login: 0,
      login_entry_point: 'logged_out',
      INTERNAL__latency_qpl_marker_id: CAA_MARKER_ID,
      family_device_id: client.bundle.uuids.phone_id,
      offline_experiment_group: CAA_EXPERIMENT,
      access_flow_version: 'pre_mt_behavior',
      is_from_logged_in_switcher: 0,
      qe_device_id: client.bundle.uuids.uuid,
    },
  }, { domain: domain || CAA_DOMAIN });
}

async function caaPrepare(client, username, domain) {
  await caaProcessClientData(client, '', domain);
  if (client.caaAac) {
    await caaOauthFetch(client, username, domain);
  }
  return Boolean(client.caaAac);
}

async function caaSendLogin(client, password, username, options) {
  const opts = options || {};
  if (!client.caaAac) {
    throw new ClientError('@alaminnna/ica-unofficial: CAA login requires a server-issued aac; call caaPrepare() first', {});
  }
  const enc = String(password).indexOf('#PWD_') === 0 ? String(password) : await passwordEncrypt(String(password), opts.key);
  if (!opts.key && String(password).indexOf('#PWD_') !== 0) {
    throw new ClientError('@alaminnna/ica-unofficial: passwordEncrypt needs { keyId, pubKey }; fetch via fetchPasswordKey first', {});
  }
  const flowId = client.caaWaterfallId || newWaterfallId();
  client.caaWaterfallId = flowId;
  const textInputId = require('node:crypto').randomBytes(2).toString('hex') + 'ig';
  const contactPoint = username || client.username;
  return bloks.bloksAsyncAction(client, 'com.bloks.www.bloks.caa.login.async.send_login_request', {
    client_input_params: {
      blocked_uids: [],
      aac: client.caaAac,
      sim_phones: [],
      aymh_accounts: [],
      network_bssid: null,
      secure_family_device_id: '',
      has_granted_read_contacts_permissions: 0,
      auth_secure_device_id: '',
      has_whatsapp_installed: 0,
      si_device_param_network_info: caaNetworkInfo(),
      password: enc,
      sso_token_map_json_string: '',
      block_store_machine_id: '',
      ig_vetted_device_nonces: null,
      cloud_trust_token: null,
      event_flow: 'login_manual',
      password_contains_non_ascii: String(!/^[\x00-\x7f]*$/.test(String(password))).toLowerCase(),
      client_known_key_hash: '',
      sso_accounts_auth_data: [],
      encrypted_msisdn: '',
      has_granted_read_phone_permissions: 0,
      app_manager_id: '',
      should_show_nested_nta_from_aymh: 0,
      device_id: client.bundle.uuids.android_device_id,
      zero_balance_state: '',
      login_attempt_count: opts.loginAttemptCount || 1,
      machine_id: client.mid,
      flash_call_permission_status: { READ_PHONE_STATE: 'DENIED', READ_CALL_LOG: 'DENIED', ANSWER_PHONE_CALLS: 'DENIED' },
      accounts_list: [],
      gms_incoming_call_retriever_eligibility: 'eligible',
      family_device_id: client.bundle.uuids.phone_id,
      fb_ig_device_id: [],
      device_emails: [],
      try_num: opts.tryNum || 1,
      lois_settings: { lois_token: '' },
      event_step: 'home_page',
      headers_infra_flow_id: '',
      openid_tokens: {},
      contact_point: contactPoint,
    },
    server_params: {
      should_trigger_override_login_2fa_action: 0,
      is_from_logged_out: 0,
      should_trigger_override_login_success_action: 0,
      login_credential_type: 'none',
      server_login_source: 'login',
      waterfall_id: flowId,
      two_step_login_type: 'one_step_login',
      login_source: 'Login',
      is_platform_login: 0,
      login_entry_point: 'logged_out',
      INTERNAL__latency_qpl_marker_id: CAA_MARKER_ID,
      is_from_aymh: 0,
      offline_experiment_group: CAA_EXPERIMENT,
      is_from_landing_page: 0,
      left_nav_button_action: 'NONE',
      password_text_input_id: textInputId + ':82',
      is_from_empty_password: 0,
      is_from_msplit_fallback: 0,
      ar_event_source: 'login_home_page',
      qe_device_id: client.bundle.uuids.uuid,
      username_text_input_id: textInputId + ':81',
      layered_homepage_experiment_group: 'Deploy: Not in Experiment',
      device_id: client.bundle.uuids.android_device_id,
      login_surface: 'login_home',
      INTERNAL__latency_qpl_instance_id: Date.now(),
      reg_flow_source: 'login_home_native_integration_point',
      is_caa_perf_enabled: 1,
      credential_type: 'password',
      is_from_password_entry_page: 0,
      caller: 'gslr',
      family_device_id: client.bundle.uuids.phone_id,
      is_from_assistive_id: 0,
      access_flow_version: 'pre_mt_behavior',
      is_from_logged_in_switcher: 0,
    },
  }, { domain: opts.domain || CAA_DOMAIN });
}

function caaNeedsTwoStep(result) {
  const strings = bloks.collectStrings(result, []);
  return strings.some((text) => text.indexOf(AP_2SV_ENTRYPOINT) !== -1);
}

async function apEntry(client, contextData, domain) {
  return bloks.bloksAsyncAction(client, AP_2SV_ENTRYPOINT, {
    client_input_params: {
      auth_secure_device_id: '',
      accounts_list: [],
      has_whatsapp_installed: 0,
      family_device_id: client.bundle.uuids.phone_id,
      machine_id: client.mid,
    },
    server_params: {
      use_open_instead_of_push: 0,
      context_data: contextData,
      INTERNAL__latency_qpl_marker_id: CAA_MARKER_ID,
      INTERNAL__latency_qpl_instance_id: Date.now(),
      device_id: client.bundle.uuids.uuid,
      use_close_instead_of_back: 0,
    },
  }, { domain: domain || CAA_DOMAIN });
}

async function apCodeEntry(client, contextData, domain) {
  return bloks.bloksApp(client, AP_2SV_CODE_ENTRY, {
    client_input_params: { aac: client.caaAac },
    server_params: {
      context_data: contextData,
      show_close_button: 0,
      device_id: client.bundle.uuids.uuid,
      INTERNAL_INFRA_screen_id: 'generic_code_entry',
      is_dismissable: 1,
    },
  }, { domain: domain || CAA_DOMAIN });
}

async function apSubmitCode(client, contextData, code, domain) {
  return bloks.bloksAsyncAction(client, AP_2SV_CODE_ENTRY_ASYNC, {
    client_input_params: {
      auth_secure_device_id: '',
      aac: client.caaAac,
      code: String(code),
      family_device_id: client.bundle.uuids.phone_id,
      device_id: client.bundle.uuids.android_device_id,
      machine_id: client.mid,
    },
    server_params: {
      context_data: contextData,
      INTERNAL__latency_qpl_marker_id: CAA_MARKER_ID,
      INTERNAL__latency_qpl_instance_id: Date.now(),
      device_id: client.bundle.uuids.uuid,
    },
  }, { domain: domain || CAA_DOMAIN });
}

async function caaResolveTwoStep(client, sendResult, code, domain) {
  const entryContext = bloks.extractContextData(sendResult, AP_2SV_ENTRYPOINT);
  if (!entryContext) {
    return { loggedIn: false, reason: 'missing entrypoint context_data' };
  }
  const entryResult = await apEntry(client, entryContext, domain);
  const codeContext = bloks.extractContextData(entryResult, AP_2SV_CODE_ENTRY);
  if (!codeContext) {
    return { loggedIn: false, reason: 'missing code_entry context_data' };
  }
  const codeResult = await apCodeEntry(client, codeContext, domain);
  const submitContext = bloks.extractContextData(codeResult, AP_2SV_CODE_ENTRY_ASYNC);
  if (!submitContext) {
    return { loggedIn: false, reason: 'missing code_entry_async context_data' };
  }
  if (!String(code || '').trim()) {
    const err = new (require('../exceptions').TwoFactorRequired)('@alaminnna/ica-unofficial: CAA profile code required; pass verificationCode', {});
    throw err;
  }
  let submitResult;
  try {
    submitResult = await apSubmitCode(client, submitContext, code, domain);
  } catch (err) {
    if (err && (err.name === 'ChallengeError' || err.name === 'ChallengeRequired')) {
      throw err;
    }
    throw new ChallengeError('@alaminnna/ica-unofficial: CAA profile-code submission failed: ' + ((err && err.message) || err), {});
  }
  return { loggedIn: bloks.applyLoginResponse(client, submitResult), reason: '' };
}

async function caaLogin(client, options) {
  const opts = options || {};
  const username = opts.username || client.username;
  const password = opts.password;
  const domain = opts.domain || CAA_DOMAIN;
  if (opts.prepare !== false) {
    const ready = await caaPrepare(client, username, domain);
    if (!ready) {
      return { loggedIn: false, context: '', result: {}, reason: 'CAA preflight did not return account access data' };
    }
  }
  const result = await caaSendLogin(client, password, username, { key: opts.key, domain });
  let loggedIn = bloks.applyLoginResponse(client, result);
  if (!loggedIn && caaNeedsTwoStep(result)) {
    const twoStep = await caaResolveTwoStep(client, result, opts.verificationCode, domain);
    loggedIn = twoStep.loggedIn;
    if (!loggedIn && !twoStep.reason) {
      twoStep.reason = 'CAA login did not return a session';
    }
    if (!loggedIn && twoStep.reason) {
      return { loggedIn: false, context: '', result, reason: twoStep.reason };
    }
  }
  const context = loggedIn ? '' : bloks.extract2svContext(result);
  return { loggedIn, context, result, reason: loggedIn ? '' : 'CAA login did not return a session' };
}

function collectCaaMarkers(result) {
  return bloks.collectStrings(result, []).filter((text) => text.indexOf('CAA_') === 0 && text.indexOf(':') !== -1);
}

module.exports = {
  CAA_DOMAIN,
  AP_2SV_ENTRYPOINT,
  AP_2SV_CODE_ENTRY,
  AP_2SV_CODE_ENTRY_ASYNC,
  caaPrepare,
  caaSendLogin,
  caaNeedsTwoStep,
  caaResolveTwoStep,
  caaLogin,
  collectCaaMarkers,
};