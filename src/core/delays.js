/**
 * @alaminnna/ica-unofficial — core/delays
 * 
 * RESPONSIBILITY: RateGuard plus jitter/sleep helpers for anti-ban pacing.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing
 * MUST NOT:       never busy-loop
 * 
 * DEBUG: when bursts cause 429s or replies feel slow, start looking here — guard windows
 */

'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterRange(range) {
  const min = range && range[0] !== undefined ? range[0] : 0;
  const max = range && range[1] !== undefined ? range[1] : min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

class RateGuard {
  constructor(options) {
    const opts = options || {};
    this.maxActions = opts.maxActions || 5;
    this.windowMs = opts.windowMs || 10000;
    this.spacingMs = opts.spacingMs === undefined ? 200 : opts.spacingMs;
    this.stamps = [];
  }

  async schedule(fn) {
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
    if (this.stamps.length >= this.maxActions) {
      const oldest = this.stamps[0];
      const wait = Math.max(0, this.windowMs - (now - oldest)) + this.spacingMs;
      await sleep(wait);
      return this.schedule(fn);
    }
    this.stamps.push(Date.now());
    return fn();
  }
}

module.exports = { sleep, jitterRange, RateGuard };