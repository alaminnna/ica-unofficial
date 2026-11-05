/**
 * @alaminnna/ica-unofficial — core/config
 * 
 * RESPONSIBILITY: bot config load/validate/defaults for test/bot.js.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:fs, node:path, ./logger
 * MUST NOT:       never read secrets except via env passthrough
 * 
 * DEBUG: when unknown-key warnings appear, start looking here — DEFAULTS vs file drift
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  sessionFile: './cookies.json',
  proxy: '',
  credentials: { username: '', password: '' },
  prefix: '.',
  autoReconnect: true,
  reconnectMaxRetries: 5,
  maxReloginAttempts: 1,
  enableTypingIndicator: true,
  typingDuration: 500,
  delayRange: [500, 1500],
  replyDelay: [0, 80],
  typingForCommands: false,
  fastMode: false,
  listenPollInterval: 3000,
  listenMode: 'auto',
  noteAudience: 'followers',
  totpSeed: '',
  downloadFolder: './downloads',
  uploadFolder: './uploads',
  listenEvents: true,
  autoMarkRead: true,
  autoMarkDelivery: false,
  selfListen: false,
  online: true,
  respondInGroup: true,
  autoApproveRequests: false,
  respondInDM: true,
  logLevel: 'info',
  showBanner: true,
  logColors: true,
  preferMqttActions: true,
  fbnsEnabled: false,
};

const LOG_LEVELS = ['silent', 'error', 'info', 'debug'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override, warnings, trail) {
  const out = { ...base };
  Object.keys(override || {}).forEach((key) => {
    const where = trail ? trail + '.' + key : key;
    if (!(key in base)) {
      warnings.push('unknown config key: ' + where);
      return;
    }
    if (isPlainObject(base[key]) && isPlainObject(override[key])) {
      out[key] = deepMerge(base[key], override[key], warnings, where);
    } else {
      out[key] = override[key];
    }
  });
  return out;
}

function readJsonFile(filePath) {
  try {
    return { data: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

function validatePair(config, key, warnings) {
  const value = config[key];
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number' || value[0] < 0 || value[1] < value[0]) {
    warnings.push('invalid ' + key + ', using default');
    config[key] = DEFAULTS[key];
  }
}

function validate(config, warnings) {
  if (typeof config.prefix !== 'string' || config.prefix.length === 0) {
    warnings.push('invalid prefix, using default "."');
    config.prefix = '.';
  }
  if (LOG_LEVELS.indexOf(config.logLevel) === -1) {
    warnings.push('invalid logLevel, using default "info"');
    config.logLevel = 'info';
  }
  if (['followers', 'best_friends'].indexOf(config.noteAudience) === -1) {
    warnings.push('invalid noteAudience, using default "followers"');
    config.noteAudience = 'followers';
  }
  if (typeof config.downloadFolder !== 'string' || config.downloadFolder.length === 0) {
    warnings.push('invalid downloadFolder, using default');
    config.downloadFolder = './downloads';
  }
  if (typeof config.uploadFolder !== 'string' || config.uploadFolder.length === 0) {
    warnings.push('invalid uploadFolder, using default');
    config.uploadFolder = './uploads';
  }
  if (typeof config.uploadFolder !== 'string' || config.uploadFolder.length === 0) {
    warnings.push('invalid uploadFolder, using default');
    config.uploadFolder = './uploads';
  }
  if (['mqtt', 'polling', 'auto'].indexOf(config.listenMode) === -1) {
    warnings.push('invalid listenMode, using default "auto"');
    config.listenMode = 'auto';
  }
  ['typingDuration', 'reconnectMaxRetries', 'maxReloginAttempts', 'listenPollInterval'].forEach((key) => {
    if (typeof config[key] !== 'number' || config[key] < 0) {
      warnings.push('invalid ' + key + ', using default');
      config[key] = DEFAULTS[key];
    }
  });
  ['autoReconnect', 'enableTypingIndicator', 'listenEvents', 'autoMarkRead', 'autoMarkDelivery', 'selfListen', 'online', 'respondInGroup', 'respondInDM', 'autoApproveRequests', 'showBanner', 'logColors', 'fastMode', 'typingForCommands', 'preferMqttActions', 'fbnsEnabled'].forEach((key) => {
    if (typeof config[key] !== 'boolean') {
      warnings.push('invalid ' + key + ', using default');
      config[key] = DEFAULTS[key];
    }
  });
  return config;
}

function loadConfig(options) {
  const opts = options || {};
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const warnings = [];
  let config = JSON.parse(JSON.stringify(DEFAULTS));
  const filePath = path.join(cwd, 'bot.config.json');
  if (fs.existsSync(filePath)) {
    const read = readJsonFile(filePath);
    if (read.error) {
      warnings.push('bot.config.json unreadable, using defaults');
    } else {
      config = deepMerge(config, read.data, warnings, '');
    }
  }
  if (env.BOT_USERNAME) {
    config.credentials.username = env.BOT_USERNAME;
  }
  if (env.BOT_PASSWORD) {
    config.credentials.password = env.BOT_PASSWORD;
  }
  if (opts.cliSessionPath) {
    config.sessionFile = opts.cliSessionPath;
  }
  validate(config, warnings);
  return { config, warnings };
}

function createLogger(level) {
  const { createLogger: create } = require('./logger');
  const logger = create('BOT');
  const { configure } = require('./logger');
  configure({ level: level || 'info' });
  return {
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    success: logger.success,
    event: logger.event,
  };
}

module.exports = { DEFAULTS, loadConfig, createLogger, deepMerge, validate };