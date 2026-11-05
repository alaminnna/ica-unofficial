/**
 * @alaminnna/ica-unofficial — exceptions/index
 * 
 * RESPONSIBILITY: error hierarchy: every mapped Instagram failure as a class.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing
 * MUST NOT:       never throw raw Errors from core/http
 * 
 * DEBUG: when an error arrives unmapped as UnknownError, start looking here — missing subclass or mapping
 */

'use strict';

class ClientError extends Error {
  constructor(message, extra) {
    super(message);
    this.name = 'ClientError';
    this.extra = extra || {};
  }
}

class LoginError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'LoginError';
  }
}

class BadPassword extends LoginError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'BadPassword';
  }
}

class BadCredentials extends LoginError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'BadCredentials';
  }
}

class TwoFactorRequired extends LoginError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'TwoFactorRequired';
  }
}

class ChallengeRequired extends LoginError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ChallengeRequired';
  }
}

class ChallengeSelfieCaptcha extends ChallengeRequired {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ChallengeSelfieCaptcha';
  }
}

class ChallengeUnknownStep extends ChallengeRequired {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ChallengeUnknownStep';
  }
}

class SelectContactPointRecoveryForm extends ChallengeRequired {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'SelectContactPointRecoveryForm';
  }
}

class RecaptchaChallengeForm extends ChallengeRequired {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'RecaptchaChallengeForm';
  }
}

class SubmitPhoneNumberForm extends ChallengeRequired {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'SubmitPhoneNumberForm';
  }
}

class LegacyForceSetNewPasswordForm extends ChallengeRequired {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'LegacyForceSetNewPasswordForm';
  }
}

class SessionExpired extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'SessionExpired';
  }
}

class ReloginAttemptExceeded extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ReloginAttemptExceeded';
  }
}


class DirectError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'DirectError';
  }
}

class DirectThreadNotFound extends DirectError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'DirectThreadNotFound';
  }
}

class DirectMessageNotFound extends DirectError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'DirectMessageNotFound';
  }
}

class DirectMessageRequestsDisabled extends DirectError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'DirectMessageRequestsDisabled';
  }
}

class ClientJSONDecodeError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ClientJSONDecodeError';
  }
}

class ClientConnectionError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ClientConnectionError';
  }
}

class ClientBadRequestError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ClientBadRequestError';
  }
}

class ClientUnauthorizedError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ClientUnauthorizedError';
  }
}

class ClientForbiddenError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ClientForbiddenError';
  }
}

class ClientNotFoundError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ClientNotFoundError';
  }
}

class ClientThrottledError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ClientThrottledError';
  }
}

class ClientRequestTimeout extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ClientRequestTimeout';
  }
}

class ClientIncompleteReadError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ClientIncompleteReadError';
  }
}

class PleaseWaitFewMinutes extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'PleaseWaitFewMinutes';
  }
}

class UnknownError extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'UnknownError';
  }
}

class FeedbackRequired extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'FeedbackRequired';
  }
}

class AccountSuspended extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'AccountSuspended';
  }
}

class ChallengeRedirection extends ChallengeRequired {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ChallengeRedirection';
  }
}

class ProxyAddressIsBlocked extends ClientError {
  constructor(message, extra) {
    super(message, extra);
    this.name = 'ProxyAddressIsBlocked';
  }
}

class RealtimeNotConnected extends ClientError {
  constructor(message, extra) {
    super(message || '@alaminnna/ica-unofficial: realtime client is not connected', extra);
    this.name = 'RealtimeNotConnected';
  }
}

class UserNotFound extends ClientError {
  constructor(message, extra) {
    super(message || '@alaminnna/ica-unofficial: user not found', extra);
    this.name = 'UserNotFound';
  }
}

class InvalidTargetUser extends ClientError {
  constructor(message, extra) {
    super(message || '@alaminnna/ica-unofficial: not eligible for chaining', extra);
    this.name = 'InvalidTargetUser';
  }
}
module.exports = {
  ClientError,
  LoginError,
  BadPassword,
  BadCredentials,
  TwoFactorRequired,
  ChallengeRequired,
  ChallengeSelfieCaptcha,
  ChallengeUnknownStep,
  SelectContactPointRecoveryForm,
  RecaptchaChallengeForm,
  SubmitPhoneNumberForm,
  LegacyForceSetNewPasswordForm,
  SessionExpired,
  PleaseWaitFewMinutes,
  ReloginAttemptExceeded,
  DirectError,
  DirectThreadNotFound,
  DirectMessageNotFound,
  DirectMessageRequestsDisabled,
  ClientJSONDecodeError,
  ClientConnectionError,
  ClientBadRequestError,
  ClientUnauthorizedError,
  ClientForbiddenError,
  ClientNotFoundError,
  ClientThrottledError,
  ClientRequestTimeout,
  ClientIncompleteReadError,
  UnknownError,
  FeedbackRequired,
  AccountSuspended,
  ChallengeRedirection,
  ProxyAddressIsBlocked,
  RealtimeNotConnected,
  UserNotFound,
  InvalidTargetUser,
};