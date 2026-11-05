/**
 * @alaminnna/ica-unofficial — auth/index
 * 
 * RESPONSIBILITY: ONLY wires auth submodules onto the client, no logic.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./login, ./session, ./bloks, ./signup, ./attestation (wiring only)
 * MUST NOT:       no direct api calls here
 * 
 * DEBUG: when client.loginWithCredentials is not a function, start looking here — useAuth not called
 */

'use strict';

const { loginWithCredentials } = require('./login');
const { loginWithSession, getSession, saveSession } = require('./session');
const { bloksAsyncAction } = require('./bloks');
const {
  getSignupConfig, checkEmail, checkUsername, checkPhoneNumber, sendSignupSmsCode,
  sendVerifyEmail, checkConfirmationCode, checkAgeEligibility, accountsCreate, signup,
  getFeaturedAccounts, getAccountFamily,
} = require('./signup');
const {
  getUsdidSettings, setUsdidSettings, usdidGenerate, usdidPublicKeyDer, usdidHeader,
  usdidRegistrationToken, usdidRegister, attestationCreateAndroidKeystore, attestationParams,
} = require('./attestation');

function useAuth(client) {
  client.loginWithCredentials = (options) => loginWithCredentials(client, options);
  client.loginWithSession = (options) => loginWithSession(client, options);
  client.getSession = () => getSession(client);
  client.saveSession = (filePath) => saveSession(client, filePath);
  client.bloksAction = (action, params, options) => bloksAsyncAction(client, action, params, options);
  client.getSignupConfig = () => getSignupConfig(client);
  client.checkEmail = (email) => checkEmail(client, email);
  client.checkUsername = (username) => checkUsername(client, username);
  client.checkPhoneNumber = (phoneNumber) => checkPhoneNumber(client, phoneNumber);
  client.sendSignupSmsCode = (phoneNumber) => sendSignupSmsCode(client, phoneNumber);
  client.sendVerifyEmail = (email) => sendVerifyEmail(client, email);
  client.checkConfirmationCode = (email, code) => checkConfirmationCode(client, email, code);
  client.checkAgeEligibility = (year, month, day) => checkAgeEligibility(client, year, month, day);
  client.accountsCreate = (options) => accountsCreate(client, options);
  client.signup = (options) => signup(client, options);
  client.getFeaturedAccounts = (targetUserId) => getFeaturedAccounts(client, targetUserId);
  client.getAccountFamily = () => getAccountFamily(client);
  client.getUsdidSettings = () => getUsdidSettings(client);
  client.setUsdidSettings = (settings) => setUsdidSettings(client, settings);
  client.usdidGenerate = (force) => usdidGenerate(client, force);
  client.usdidPublicKeyDer = () => usdidPublicKeyDer(client);
  client.usdidHeader = (ttl) => usdidHeader(client, ttl);
  client.usdidRegistrationToken = (ttl) => usdidRegistrationToken(client, ttl);
  client.usdidRegister = (clientDocId) => usdidRegister(client, clientDocId);
  client.attestationCreateAndroidKeystore = (keyHash, domain) => attestationCreateAndroidKeystore(client, keyHash, domain);
  client.attestationParams = (challengeNonce) => attestationParams(client, challengeNonce);
}

module.exports = { useAuth };