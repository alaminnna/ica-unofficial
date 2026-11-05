/**
 * @alaminnna/ica-unofficial — media/codec
 * 
 * RESPONSIBILITY: shortcode<->pk alphabet codec and media URL parsing.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing
 * MUST NOT:       never do I/O here
 * 
 * DEBUG: when a URL yields the wrong pk, start looking here — alphabet/parse logic
 */

'use strict';

const ENCODING_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function divmodDecimal(digits, divisor) {
  let remainder = 0;
  const quotient = [];
  for (let i = 0; i < digits.length; i += 1) {
    const current = remainder * 10 + digits[i];
    const q = Math.floor(current / divisor);
    remainder = current % divisor;
    if (quotient.length > 0 || q > 0) {
      quotient.push(q);
    }
  }
  return { quotient, remainder };
}

function mulAddDecimal(digits, multiplier, addend) {
  let carry = addend;
  const out = digits.slice();
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const total = out[i] * multiplier + carry;
    out[i] = total % 10;
    carry = Math.floor(total / 10);
  }
  while (carry > 0) {
    out.unshift(carry % 10);
    carry = Math.floor(carry / 10);
  }
  let start = 0;
  while (start < out.length - 1 && out[start] === 0) {
    start += 1;
  }
  return out.slice(start);
}

function encodeId(num) {
  let digits = String(num).split('').map((ch) => Number(ch));
  if (digits.some((d) => Number.isNaN(d))) {
    throw new Error('@alaminnna/ica-unofficial: encodeId needs a decimal string');
  }
  if (digits.length === 1 && digits[0] === 0) {
    return ENCODING_CHARS[0];
  }
  const base = ENCODING_CHARS.length;
  const out = [];
  let current = digits;
  while (!(current.length === 1 && current[0] === 0)) {
    const step = divmodDecimal(current, base);
    out.push(ENCODING_CHARS[step.remainder]);
    current = step.quotient.length > 0 ? step.quotient : [0];
  }
  out.reverse();
  return out.join('');
}

function decodeShortcode(shortcode) {
  const base = ENCODING_CHARS.length;
  let digits = [0];
  String(shortcode).split('').forEach((ch) => {
    const index = ENCODING_CHARS.indexOf(ch);
    if (index < 0) {
      throw new Error('@alaminnna/ica-unofficial: invalid shortcode character');
    }
    digits = mulAddDecimal(digits, base, index);
  });
  return digits.join('');
}

function mediaPkFromUrl(url) {
  const path = String(url).split('?')[0];
  const parts = path.split('/').filter((part) => part.length > 0);
  if (parts.slice(0, 2).join('/') === 'share/p' || (parts[0] === 'share' && parts[1] === 'p')) {
    throw new Error('@alaminnna/ica-unofficial: share links need redirect follow (unsupported)');
  }
  const code = parts[parts.length - 1];
  if (!code) {
    throw new Error('@alaminnna/ica-unofficial: cannot extract shortcode from URL');
  }
  return code;
}

function shortcodeFromPk(pk) {
  return encodeId(String(pk).split('_')[0]);
}

module.exports = { ENCODING_CHARS, encodeId, decodeShortcode, mediaPkFromUrl, shortcodeFromPk };