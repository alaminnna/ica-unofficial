/**
 * @alaminnna/ica-unofficial — core/logger
 * 
 * RESPONSIBILITY: leveled, colored, section-tagged logger.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing
 * MUST NOT:       never log secrets (callers must mask)
 * 
 * DEBUG: when logs go silent, start looking here — log level wiring
 */

'use strict';

/* ============================================================
   @alaminnna/ica-unofficial Global Logger
   Zero-dependency, pure Node.js + ANSI escape codes
   ============================================================ */

/* ---- Constants ---- */

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

const MODULE_COLORS = {
  AUTH: '\x1b[36m',    // cyan
  HTTP: '\x1b[34m',    // blue
  MSG: '\x1b[35m',     // magenta
  LISTEN: '\x1b[32m',  // green
  BOT: '\x1b[33m',     // yellow
  SESSION: '\x1b[31m', // red
  CORE: '\x1b[37m',    // white
};

const LEVEL_COLORS = {
  error: '\x1b[31m',   // red
  warn: '\x1b[33m',    // yellow
  info: '\x1b[37m',    // white
  debug: '\x1b[90m',   // gray
  success: '\x1b[32m', // green
  event: '\x1b[32m',   // green
};

const RESET = '\x1b[0m';
const GRAY = '\x1b[90m';

/* ---- State ---- */

let globalLevel = 'error'; // library default: error only (no spam)
let useColors = true;
let isTTY = false;
try { isTTY = Boolean(process.stdout.isTTY); } catch (_) { /* non-TTY */ }
let activeSpinner = null;
let activePulse = null;

/* ---- Utility ---- */

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return GRAY + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + RESET;
}

function colorize(text, color) {
  if (!useColors) return text;
  return color + text + RESET;
}

function shouldLog(level) {
  return LEVELS[level] <= LEVELS[globalLevel];
}

function formatValue(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (typeof val === 'object') {
    try { return JSON.stringify(val); } catch (_) { return String(val); }
  }
  return String(val);
}

function formatMessage(module, level, args) {
  const msg = args.map(formatValue).join(' ');
  const modTag = '[' + module + ']';
  const modColor = MODULE_COLORS[module] || MODULE_COLORS.CORE;
  const lvlColor = LEVEL_COLORS[level] || LEVEL_COLORS.info;
  const lvlTag = level.toUpperCase().padEnd(7);
  return timestamp() + ' ' + colorize(modTag, modColor) + ' ' + colorize(lvlTag, lvlColor) + ' ' + msg;
}

/* ---- Core logging ---- */

function log(module, level, args) {
  const filterLevel = (level === 'success' || level === 'event') ? 'info' : level;
  if (!shouldLog(filterLevel)) return;

  // Pause spinner / pulse so we never break their line
  if (activeSpinner) { process.stdout.write('\r\x1b[K'); }
  if (activePulse) { process.stdout.write('\r\x1b[K'); }

  const line = formatMessage(module, level, args);
  process.stdout.write(line + '\n');

  // Restore spinner / pulse
  if (activeSpinner) { activeSpinner.render(); }
  if (activePulse) { activePulse.render(); }
}

/* ---- Module logger factory ---- */

function createLogger(module, options) {
  const opts = options || {};
  const mod = opts.module || module;
  return {
    debug: (...args) => log(mod, 'debug', args),
    info: (...args) => log(mod, 'info', args),
    warn: (...args) => log(mod, 'warn', args),
    error: (...args) => log(mod, 'error', args),
    success: (...args) => log(mod, 'success', args),
    event: (...args) => log(mod, 'event', args),
  };
}

/* ---- Banner ---- */

const BANNER_ART = [
  '██╗███╗░░██╗░██████╗████████╗░░░░░░█████╗░░█████╗░░█████╗░',
  '██║████╗░██║██╔════╝╚══██╔══╝░░░░░██╔══██╗██╔══██╗██╔══██╗',
  '██║██╔██╗██║╚█████╗░░░░██║░░░░░░░░░███████║██║░░╚═╝███████║',
  '██║██║╚████║░╚═══██╗░░░██║░░░░░░░░░██╔══██║██║░░██╗██╔══██║',
  '██║██║░╚███║██████╔╝░░░██║░░░░░░░░░██║░░██║╚█████╔╝██║░░██║',
  '╚═╝╚═╝░░╚══╝╚═════╝░░░░╚═╝░░░░░░░░░╚═╝░░╚═╝░╚════╝░╚═╝░░╚═╝',
];

const BANNER_SUBTITLE = 'by alaminnna';

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait for animation frames */ }
}

function banner(options) {
  const opts = options || {};
  if (opts.showBanner === false) return;

  const lines = BANNER_ART;
  const totalLines = lines.length;

  // Slide-up reveal: print from bottom to top
  for (let i = totalLines - 1; i >= 0; i--) {
    const line = lines[i];
    // Gradient: cyan (top) -> magenta (bottom)
    const ratio = totalLines > 1 ? i / (totalLines - 1) : 0;
    const r = Math.round(0 + ratio * 255);
    const g = Math.round(255 - ratio * 255);
    const b = Math.round(255 - ratio * 0);
    const color = '\x1b[38;2;' + r + ';' + g + ';' + b + 'm';

    process.stdout.write(color + line + RESET + '\n');

    if (i > 0) {
      sleepSync(opts.frameDelay || 60);
    }
  }

  // Subtitle
  process.stdout.write('\n' + colorize(BANNER_SUBTITLE, '\x1b[90m') + '\n\n');
}

/* ---- Spinner ---- */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function spinner(text, options) {
  const opts = options || {};
  const interval = opts.interval || 80;
  let frame = 0;
  let stopped = false;
  let timer = null;

  const spinnerObj = {
    render() {
      if (stopped) return;
      const ch = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
      process.stdout.write('\r' + colorize(ch, '\x1b[36m') + ' ' + text);
      frame++;
    },
    success(finalText) {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write('\r\x1b[K');
      process.stdout.write(colorize('✓', '\x1b[32m') + ' ' + (finalText || text) + '\n');
    },
    fail(finalText) {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write('\r\x1b[K');
      process.stdout.write(colorize('✗', '\x1b[31m') + ' ' + (finalText || text) + '\n');
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write('\r\x1b[K');
    },
  };

  activeSpinner = spinnerObj;
  timer = setInterval(() => spinnerObj.render(), interval);
  spinnerObj.render();

  return spinnerObj;
}

/* ---- Box ---- */

function box(title, lines, options) {
  const opts = options || {};
  const minWidth = opts.width || 40;
  const contentWidth = Math.max(
    title.length + 4,
    ...lines.map((l) => l.length + 4),
    minWidth
  );
  const hLine = '─'.repeat(contentWidth - 2);
  const titleLine = '┌─ ' + title + ' ' + '─'.repeat(Math.max(0, contentWidth - title.length - 5)) + '┐';
  const bottomLine = '└' + hLine + '┘';

  process.stdout.write(colorize(titleLine, '\x1b[36m') + '\n');
  lines.forEach((line) => {
    const padded = '│ ' + line.padEnd(contentWidth - 4) + ' │';
    process.stdout.write(colorize(padded, '\x1b[37m') + '\n');
  });
  process.stdout.write(colorize(bottomLine, '\x1b[36m') + '\n');
}

/* ---- Pulse ---- */

function pulse(textFn, options) {
  const opts = options || {};
  const interval = opts.interval || 1000;
  let stopped = false;
  let timer = null;

  const pulseObj = {
    render() {
      if (stopped) return;
      const text = typeof textFn === 'function' ? textFn() : textFn;
      process.stdout.write('\r' + colorize('●', '\x1b[32m') + ' ' + text);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write('\r\x1b[K');
    },
  };

  activePulse = pulseObj;
  timer = setInterval(() => pulseObj.render(), interval);
  pulseObj.render();

  return pulseObj;
}

/* ---- Configure ---- */

function configure(options) {
  const opts = options || {};
  if (opts.level) globalLevel = opts.level;
  if (opts.colors !== undefined) useColors = opts.colors && isTTY;
}

/* ---- Exports ---- */

module.exports = {
  createLogger,
  banner,
  spinner,
  box,
  pulse,
  configure,
  LEVELS,
};