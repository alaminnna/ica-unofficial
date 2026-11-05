/**
 * @alaminnna/ica-unofficial — account/notifications
 *
 * RESPONSIBILITY: app-level notification settings (change_notification_settings).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api, client.rateGuard
 * MUST NOT:       never burst writes — all go through rateGuard.schedule
 *
 * DEBUG: when a toggle returns false, start looking here — content_type strings
 */

'use strict';

const SETTING_VALUES = ['off', 'following_only', 'everyone'];
const MUTE_ALL_VALUES = ['cancel', '15_minutes', '1_hour', '2_hour', '4_hour', '8_hour'];

// method suffix -> content_type (3 differ from their suffix).
const CONTENT_TYPES = {
  muteAll: 'mute_all',
  likes: 'likes',
  likeAndCommentOnPhotoUserTagged: 'like_and_comment_on_photo_user_tagged',
  userTagged: 'user_tagged',
  comments: 'comments',
  commentLikes: 'comment_likes',
  firstPost: 'first_post',
  newFollower: 'new_follower',
  followRequestAccepted: 'follow_request_accepted',
  connection: 'connection_notification',
  taggedInBio: 'tagged_in_bio',
  pendingDirectShare: 'pending_direct_share',
  directShareActivity: 'direct_share_activity',
  directGroupRequests: 'direct_group_requests',
  videoCall: 'video_call',
  rooms: 'rooms',
  liveBroadcast: 'live_broadcast',
  felixUploadResult: 'felix_upload_result',
  viewCount: 'view_count',
  fundraiserCreator: 'fundraiser_creator',
  fundraiserSupporter: 'fundraiser_supporter',
  reminders: 'notification_reminders',
  announcements: 'announcements',
  reportUpdated: 'report_updated',
  login: 'login_notification',
};

function guardOf(client) {
  if (client.rateGuard && typeof client.rateGuard.schedule === 'function') {
    return client.rateGuard;
  }
  return { schedule: (fn) => fn() };
}

function checkSetting(value) {
  if (SETTING_VALUES.indexOf(value) === -1) {
    throw new Error('@alaminnna/ica-unofficial: invalid setting_value ' + value + ' (off|following_only|everyone)');
  }
  return value;
}

async function setNotificationSetting(client, contentType, settingValue) {
  const guard = guardOf(client);
  const res = await guard.schedule(() => client.api.request({
    endpoint: 'notifications/change_notification_settings/',
    method: 'POST',
    data: {
      content_type: contentType,
      setting_value: settingValue,
      _uid: String(client.userId),
      _uuid: client.uuid,
    },
  }));
  return ((res || {}).status || '') === 'ok';
}

async function muteAllNotifications(client, value) {
  const setting = value || '8_hour';
  if (MUTE_ALL_VALUES.indexOf(setting) === -1) {
    throw new Error('@alaminnna/ica-unofficial: invalid mute_all value ' + setting);
  }
  return setNotificationSetting(client, 'mute_all', setting);
}

async function disableAllNotifications(client) {
  const names = Object.keys(CONTENT_TYPES).filter((k) => k !== 'muteAll');
  for (const key of names) {
    const contentType = CONTENT_TYPES[key];
    const ok = await setNotificationSetting(client, contentType, 'off');
    if (!ok) {
      return false;
    }
  }
  return true;
}

const api = { setNotificationSetting, muteAllNotifications, disableAllNotifications };
Object.keys(CONTENT_TYPES).forEach((key) => {
  if (key === 'muteAll') {
    return;
  }
  const contentType = CONTENT_TYPES[key];
  api['notification' + key[0].toUpperCase() + key.slice(1)] = (client, value) => (
    setNotificationSetting(client, contentType, checkSetting(value === undefined ? 'off' : value))
  );
});

module.exports = { SETTING_VALUES, MUTE_ALL_VALUES, CONTENT_TYPES, ...api };