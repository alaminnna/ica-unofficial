/**
 * @alaminnna/ica-unofficial — auth/totp
 *
 * RESPONSIBILITY: RFC 6238 TOTP code generation only (totp_generate_code parity), zero deps.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:crypto only — never client/api/http.
 * MUST NOT:       never log seeds/codes; never do server enrollment (generate/enable/disable are out of scope).
 *
 * DEBUG: when .totp code mismatches authenticator, check here — base32 pad/casefold or clock skew (30s step).
 */

'use strict';

const crypto = require('node:crypto');

function base32Decode(input) {
  let s = String(input || '').trim().replace(/[\s-]/g, '').toUpperCase();
  const missing = s.length % 8;
  if (missing !== 0) {
    s += '='.repeat(8 - missing);
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s) {
    if (ch === '=') {
      continue;
    }
    const val = alphabet.indexOf(ch);
    if (val === -1) {
      throw new Error('invalid base32 seed');
    }
    bits += val.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    out.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(out);
}

function intToBytes(num) {
  const buf = Buffer.alloc(8);
  let n = num;
  for (let i = 7; i >= 0; i -= 1) {
    buf[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return buf;
}

function generateOTP(seed, counter, digits) {
  const key = base32Decode(seed);
  const msg = intToBytes(counter);
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % (10 ** digits)).padStart(digits, '0');
}

function generateTOTP(seed, options) {
  const opts = options || {};
  const digits = opts.digits || 6;
  const step = opts.step || 30;
  const at = opts.at === undefined ? Date.now() : opts.at;
  const counter = Math.floor(Math.floor(at / 1000) / step);
  return generateOTP(seed, counter, digits);
}

module.exports = { generateTOTP, base32Decode };