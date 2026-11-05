/**
 * @alaminnna/ica-unofficial — account/index
 *
 * RESPONSIBILITY: ONLY wires account submodules onto the client, no logic.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./profile, ./security, ./contact, ./notifications + dualize for callback/promise.
 * MUST NOT:       no direct api calls here; never log PII.
 *
 * DEBUG: when client.getAccountInfo is not a function, start here — useAccount not
 * called in src/core/client.js constructor.
 */

'use strict';

const profile = require('./profile');
const security = require('./security');
const contact = require('./contact');
const notifications = require('./notifications');

function dualize(promise, cb) {
  if (typeof cb === 'function') {
    promise.then((out) => cb(null, out), (err) => cb(err, null));
    return undefined;
  }
  return promise;
}

function maskTail(value, show) {
  const s = String(value || '');
  if (!s) {
    return '';
  }
  const n = show || 3;
  if (s.length <= n + 3) {
    return '***';
  }
  return '***' + s.slice(-n);
}

function useAccount(client) {
  client.getAccountInfo = (cb) => dualize(profile.getAccountInfo(client), cb);
  client.editAccount = (fields, cb) => dualize(profile.editAccount(client, fields), cb);
  client.setBiography = (text, cb) => dualize(profile.setBiography(client, text), cb);
  client.setExternalUrl = (url, cb) => dualize(profile.setExternalUrl(client, url), cb);
  client.removeBioLinks = (linkIds, cb) => dualize(profile.removeBioLinks(client, linkIds), cb);
  client.getBioLinks = (cb) => dualize(profile.getBioLinks(client), cb);
  client.changeProfilePicture = (options, cb) => dualize(profile.changeProfilePicture(client, options), cb);
  client.setPrivate = (cb) => dualize(profile.setPrivate(client), cb);
  client.setPublic = (cb) => dualize(profile.setPublic(client), cb);
  client.convertToBusiness = (categoryId, opts, cb) => dualize(profile.convertToBusiness(client, categoryId, opts), cb);
  client.convertToCreator = (categoryId, opts, cb) => dualize(profile.convertToCreator(client, categoryId, opts), cb);
  client.convertToProfessional = (type, categoryId, opts, cb) => dualize(profile.convertToProfessional(client, type, categoryId, opts), cb);
  client.getNewsInbox = (markAsSeen, cb) => dualize(profile.getNewsInbox(client, markAsSeen), cb);
  client.setAiInfoLabel = (enabled, cb) => dualize(profile.setAiInfoLabel(client, enabled), cb);
  client.getSecurityInfo = (cb) => dualize(security.getSecurityInfo(client), cb);
  client.changePassword = (oldPassword, newPassword, cb) => dualize(security.changePassword(client, oldPassword, newPassword), cb);
  client.sendPasswordReset = (identifier, cb) => dualize(security.sendPasswordReset(client, identifier), cb);
  client.sendConfirmEmail = (email, cb) => dualize(contact.sendConfirmEmail(client, email), cb);
  client.confirmEmail = (email, code, cb) => dualize(contact.confirmEmail(client, email, code), cb);
  client.sendConfirmPhone = (phoneNumber, cb) => dualize(contact.sendConfirmPhone(client, phoneNumber), cb);
  client.confirmPhone = (phoneNumber, code, cb) => dualize(contact.confirmPhone(client, phoneNumber, code), cb);
  client.setNotificationSetting = (contentType, value, cb) => dualize(notifications.setNotificationSetting(client, contentType, value), cb);
  client.muteAllNotifications = (value, cb) => dualize(notifications.muteAllNotifications(client, value), cb);
  client.disableAllNotifications = (cb) => dualize(notifications.disableAllNotifications(client), cb);
  client.notificationLikes = (value, cb) => dualize(notifications.notificationLikes(client, value), cb);
  client.notificationLikeAndCommentOnPhotoUserTagged = (value, cb) => dualize(notifications.notificationLikeAndCommentOnPhotoUserTagged(client, value), cb);
  client.notificationUserTagged = (value, cb) => dualize(notifications.notificationUserTagged(client, value), cb);
  client.notificationComments = (value, cb) => dualize(notifications.notificationComments(client, value), cb);
  client.notificationCommentLikes = (value, cb) => dualize(notifications.notificationCommentLikes(client, value), cb);
  client.notificationFirstPost = (value, cb) => dualize(notifications.notificationFirstPost(client, value), cb);
  client.notificationNewFollower = (value, cb) => dualize(notifications.notificationNewFollower(client, value), cb);
  client.notificationFollowRequestAccepted = (value, cb) => dualize(notifications.notificationFollowRequestAccepted(client, value), cb);
  client.notificationConnection = (value, cb) => dualize(notifications.notificationConnection(client, value), cb);
  client.notificationTaggedInBio = (value, cb) => dualize(notifications.notificationTaggedInBio(client, value), cb);
  client.notificationPendingDirectShare = (value, cb) => dualize(notifications.notificationPendingDirectShare(client, value), cb);
  client.notificationDirectShareActivity = (value, cb) => dualize(notifications.notificationDirectShareActivity(client, value), cb);
  client.notificationDirectGroupRequests = (value, cb) => dualize(notifications.notificationDirectGroupRequests(client, value), cb);
  client.notificationVideoCall = (value, cb) => dualize(notifications.notificationVideoCall(client, value), cb);
  client.notificationRooms = (value, cb) => dualize(notifications.notificationRooms(client, value), cb);
  client.notificationLiveBroadcast = (value, cb) => dualize(notifications.notificationLiveBroadcast(client, value), cb);
  client.notificationFelixUploadResult = (value, cb) => dualize(notifications.notificationFelixUploadResult(client, value), cb);
  client.notificationViewCount = (value, cb) => dualize(notifications.notificationViewCount(client, value), cb);
  client.notificationFundraiserCreator = (value, cb) => dualize(notifications.notificationFundraiserCreator(client, value), cb);
  client.notificationFundraiserSupporter = (value, cb) => dualize(notifications.notificationFundraiserSupporter(client, value), cb);
  client.notificationReminders = (value, cb) => dualize(notifications.notificationReminders(client, value), cb);
  client.notificationAnnouncements = (value, cb) => dualize(notifications.notificationAnnouncements(client, value), cb);
  client.notificationReportUpdated = (value, cb) => dualize(notifications.notificationReportUpdated(client, value), cb);
  client.notificationLogin = (value, cb) => dualize(notifications.notificationLogin(client, value), cb);
}

module.exports = { useAccount, maskTail };