'use strict';

const { Client } = require('./src/core/client');
const exceptions = require('./src/exceptions');
const { maybeAutoUpdate, checkForUpdate } = require('./src/core/update');

async function runLogin(options) {
  await maybeAutoUpdate(options);
  const client = new Client(options);
  if (options && (options.session || options.cookies)) {
    await client.loginWithSession(options);
  } else {
    await client.loginWithCredentials(options);
  }
  return client;
}

function login(options, callback) {
  if (typeof callback === 'function') {
    runLogin(options).then(
      (api) => callback(null, api),
      (err) => callback(err, null)
    );
    return undefined;
  }
  return runLogin(options);
}

module.exports.login = login;
module.exports.Client = Client;
module.exports.checkForUpdate = checkForUpdate;
module.exports.maybeAutoUpdate = maybeAutoUpdate;
// Explicit assignments (not a spread) so ESM named imports resolve
// via static analysis: import { ChallengeRequired } from '...'.
module.exports.ClientError = exceptions.ClientError;
module.exports.LoginError = exceptions.LoginError;
module.exports.BadPassword = exceptions.BadPassword;
module.exports.BadCredentials = exceptions.BadCredentials;
module.exports.TwoFactorRequired = exceptions.TwoFactorRequired;
module.exports.ChallengeRequired = exceptions.ChallengeRequired;
module.exports.ChallengeSelfieCaptcha = exceptions.ChallengeSelfieCaptcha;
module.exports.ChallengeUnknownStep = exceptions.ChallengeUnknownStep;
module.exports.SelectContactPointRecoveryForm = exceptions.SelectContactPointRecoveryForm;
module.exports.RecaptchaChallengeForm = exceptions.RecaptchaChallengeForm;
module.exports.SubmitPhoneNumberForm = exceptions.SubmitPhoneNumberForm;
module.exports.LegacyForceSetNewPasswordForm = exceptions.LegacyForceSetNewPasswordForm;
module.exports.SessionExpired = exceptions.SessionExpired;
module.exports.PleaseWaitFewMinutes = exceptions.PleaseWaitFewMinutes;
module.exports.ReloginAttemptExceeded = exceptions.ReloginAttemptExceeded;
module.exports.DirectError = exceptions.DirectError;
module.exports.DirectThreadNotFound = exceptions.DirectThreadNotFound;
module.exports.DirectMessageNotFound = exceptions.DirectMessageNotFound;
module.exports.DirectMessageRequestsDisabled = exceptions.DirectMessageRequestsDisabled;
module.exports.ClientJSONDecodeError = exceptions.ClientJSONDecodeError;
module.exports.ClientConnectionError = exceptions.ClientConnectionError;
module.exports.ClientBadRequestError = exceptions.ClientBadRequestError;
module.exports.ClientUnauthorizedError = exceptions.ClientUnauthorizedError;
module.exports.ClientForbiddenError = exceptions.ClientForbiddenError;
module.exports.ClientNotFoundError = exceptions.ClientNotFoundError;
module.exports.ClientThrottledError = exceptions.ClientThrottledError;
module.exports.ClientRequestTimeout = exceptions.ClientRequestTimeout;
module.exports.ClientIncompleteReadError = exceptions.ClientIncompleteReadError;
module.exports.UnknownError = exceptions.UnknownError;
module.exports.FeedbackRequired = exceptions.FeedbackRequired;
module.exports.AccountSuspended = exceptions.AccountSuspended;
module.exports.ChallengeRedirection = exceptions.ChallengeRedirection;
module.exports.ProxyAddressIsBlocked = exceptions.ProxyAddressIsBlocked;
module.exports.RealtimeNotConnected = exceptions.RealtimeNotConnected;
module.exports.UserNotFound = exceptions.UserNotFound;
module.exports.InvalidTargetUser = exceptions.InvalidTargetUser;