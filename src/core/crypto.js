/**
 * @alaminnna/ica-unofficial — core/crypto
 * 
 * RESPONSIBILITY: password encryption: RSA+AES-GCM #PWD_INSTAGRAM envelopes.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:crypto only
 * MUST NOT:       never log keys or plaintext
 * 
 * DEBUG: when bad_password strikes with a correct password, start looking here — key fetch and envelope format
 */

'use strict';

const crypto = require('node:crypto');

const PASSWORD_KEY_URL = 'https://i.instagram.com/api/v1/qe/sync/';

async function fetchPasswordKey(publicGet) {
  const res = await publicGet(PASSWORD_KEY_URL);
  const headers = res.headers || {};
  const lowered = {};
  Object.keys(headers).forEach((key) => {
    lowered[key.toLowerCase()] = headers[key];
  });
  return {
    keyId: Number(lowered['ig-set-password-encryption-key-id']),
    pubKey: lowered['ig-set-password-encryption-pub-key'],
  };
}

async function passwordEncrypt(password, key) {
  const sessionKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const decodedKey = Buffer.from(key.pubKey, 'base64');
  let recipient;
  if (decodedKey.slice(0, 5).toString() === '-----') {
    recipient = crypto.createPublicKey(decodedKey.toString('utf8'));
  } else {
    try {
      recipient = crypto.createPublicKey({ key: decodedKey, format: 'der', type: 'pkcs1' });
    } catch (err) {
      recipient = crypto.createPublicKey({ key: decodedKey, format: 'der', type: 'spki' });
    }
  }
  const rsaEncrypted = crypto.publicEncrypt({ key: recipient, padding: crypto.constants.RSA_PKCS1_PADDING }, sessionKey);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, iv);
  cipher.setAAD(Buffer.from(timestamp, 'utf8'));
  const aesEncrypted = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const sizeBuffer = Buffer.alloc(2);
  sizeBuffer.writeUInt16LE(rsaEncrypted.length, 0);
  const payload = Buffer.concat([
    Buffer.from([0x01, key.keyId & 0xff]),
    iv,
    sizeBuffer,
    rsaEncrypted,
    tag,
    aesEncrypted,
  ]);
  return '#PWD_INSTAGRAM:4:' + timestamp + ':' + payload.toString('base64');
}

module.exports = { PASSWORD_KEY_URL, fetchPasswordKey, passwordEncrypt };