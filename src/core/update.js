/**
 * @alaminnna/ica-unofficial — core/update
 *
 * RESPONSIBILITY: self-update check only: compare the running version
 *   against the npm registry and, when outdated, attempt `npm install`
 *   of the latest release before login proceeds. Never throws, never
 *   blocks longer than its timeouts, never changes login outcome.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        axios, node:child_process, node:path, ./logger
 * MUST NOT:       never reject login on registry/install failure; never
 *   use a shell (execFile only); never hot-swap running code (a restart
 *   is required for the new version to take effect).
 *
 * DEBUG: when no update check happens, look here — skip flags, env
 *   kill-switches, or the in-memory interval cache.
 */

'use strict';

const { execFile } = require('node:child_process');
const { createLogger } = require('./logger');

const log = createLogger('UPDATE');

const PACKAGE_NAME = '@alaminnna/ica-unofficial';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_CHECK_TIMEOUT_MS = 8000;
const DEFAULT_INSTALL_TIMEOUT_MS = 180000;
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastCheckAt = 0;

function currentVersion() {
  try {
    return String(require('../../package.json').version || '0.0.0');
  } catch (err) {
    return '0.0.0';
  }
}

function compareVersions(a, b) {
  const pa = String(a || '').split('.');
  const pb = String(b || '').split('.');
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    const va = Number.isNaN(na) ? String(pa[i] || '') : null;
    const vb = Number.isNaN(nb) ? String(pb[i] || '') : null;
    if (va !== null || vb !== null) {
      if (String(pa[i] || '') !== String(pb[i] || '')) {
        return String(pa[i] || '') < String(pb[i] || '') ? -1 : 1;
      }
    } else if (na !== nb) {
      return na < nb ? -1 : 1;
    }
  }
  return 0;
}

function updateSkipped(options, env) {
  const opts = options || {};
  const penv = env || process.env;
  if (opts.skipUpdateCheck === true) {
    return true;
  }
  const raw = penv.ICA_SKIP_UPDATE_CHECK;
  return raw === '1' || String(raw || '').toLowerCase() === 'true';
}

function autoInstallEnabled(options, env) {
  const opts = options || {};
  const penv = env || process.env;
  if (opts.autoUpdate === false) {
    return false;
  }
  const raw = penv.ICA_AUTO_UPDATE;
  if (raw === '0' || String(raw || '').toLowerCase() === 'false') {
    return false;
  }
  return true;
}

function shouldCheckNow(options, now) {
  const opts = options || {};
  if (opts.forceUpdateCheck === true) {
    return true;
  }
  const interval = typeof opts.updateCheckIntervalMs === 'number' && opts.updateCheckIntervalMs >= 0
    ? opts.updateCheckIntervalMs
    : DEFAULT_CHECK_INTERVAL_MS;
  return (now || Date.now()) - lastCheckAt >= interval;
}

async function checkForUpdate(options) {
  const opts = options || {};
  const version = opts.version || currentVersion();
  const registry = opts.registryUrl || DEFAULT_REGISTRY;
  const timeout = typeof opts.updateCheckTimeoutMs === 'number' ? opts.updateCheckTimeoutMs : DEFAULT_CHECK_TIMEOUT_MS;
  const httpGet = opts.httpGet || require('axios').get;
  const url = registry.replace(/\/+$/, '') + '/' + PACKAGE_NAME.replace('/', '%2F') + '/latest';
  try {
    const res = await httpGet(url, { timeout });
    const latest = String((res && res.data && res.data.version) || '');
    if (!latest) {
      return { current: version, latest: null, updateAvailable: false, error: 'empty registry response' };
    }
    return { current: version, latest, updateAvailable: compareVersions(version, latest) < 0 };
  } catch (err) {
    return { current: version, latest: null, updateAvailable: false, error: String((err && err.message) || err) };
  }
}

function runExecFile(execFn, cmd, args, opts) {
  return new Promise((resolve) => {
    execFn(cmd, args, opts, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function tryAutoUpdate(options) {
  const opts = options || {};
  const execFn = opts.execFn || execFile;
  const cwd = opts.cwd || process.cwd();
  const timeout = typeof opts.updateInstallTimeoutMs === 'number' ? opts.updateInstallTimeoutMs : DEFAULT_INSTALL_TIMEOUT_MS;
  const target = PACKAGE_NAME + '@latest';
  try {
    const res = await runExecFile(execFn, 'npm', ['install', target, '--no-audit', '--no-fund'], { cwd, timeout });
    if (res.err) {
      const msg = String((res.err && res.err.message) || res.err);
      const tail = (res.stderr || '').split('\n').filter(Boolean).slice(-3).join(' | ');
      return { ok: false, error: tail ? msg + ' :: ' + tail : msg };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// Main entry: check, optionally install, then let the caller proceed.
// Never throws and never returns a failure — login outcome is unaffected.
async function maybeAutoUpdate(options) {
  const opts = options || {};
  try {
    if (updateSkipped(opts)) {
      return { checked: false, reason: 'skipped' };
    }
    if (!shouldCheckNow(opts)) {
      return { checked: false, reason: 'cached' };
    }
    lastCheckAt = Date.now();
    const info = await checkForUpdate(opts);
    if (!info.updateAvailable) {
      return { checked: true, current: info.current, latest: info.latest, updateAvailable: false };
    }
    log.info('update available: ' + info.current + ' -> ' + info.latest + ' — installing before login');
    if (!autoInstallEnabled(opts)) {
      log.info('auto-install disabled — run `npm install ' + PACKAGE_NAME + '@latest` then restart');
      return { checked: true, current: info.current, latest: info.latest, updateAvailable: true, installed: false };
    }
    const res = await tryAutoUpdate(opts);
    if (res.ok) {
      log.info('updated to ' + info.latest + ' — restart the process to run the new version');
      return { checked: true, current: info.current, latest: info.latest, updateAvailable: true, installed: true };
    }
    log.info('auto-update failed (' + res.error + ') — continuing with ' + info.current);
    return { checked: true, current: info.current, latest: info.latest, updateAvailable: true, installed: false, installError: res.error };
  } catch (err) {
    return { checked: false, reason: 'error', error: String((err && err.message) || err) };
  }
}

function resetUpdateCache() {
  lastCheckAt = 0;
}

module.exports = {
  PACKAGE_NAME,
  DEFAULT_REGISTRY,
  DEFAULT_CHECK_TIMEOUT_MS,
  DEFAULT_INSTALL_TIMEOUT_MS,
  DEFAULT_CHECK_INTERVAL_MS,
  currentVersion,
  compareVersions,
  updateSkipped,
  autoInstallEnabled,
  shouldCheckNow,
  checkForUpdate,
  tryAutoUpdate,
  maybeAutoUpdate,
  resetUpdateCache,
};
