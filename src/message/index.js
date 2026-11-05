/**
 * @alaminnna/ica-unofficial — message/index
 * 
 * RESPONSIBILITY: wires message submodules onto the client plus backwards-compat overloads (sendMessage/sendReply/sendTyping signatures) — no wire protocol, no HTTP here.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./listener, ./sending, ./threads, ./listen, ./normalize, ./events
 * MUST NOT:       no direct api calls, no transport logic here
 * 
 * DEBUG: when client.getThreads is not a function, start looking here — useMessage not called in core/client.js; when the legacy sendMessage(string, threadId) signature breaks, the overload shim below is the cause
 */

'use strict';

const { getThreads, getThread, getMessages, pendingRequests, approveRequest, markThreadSeen } = require('./threads/threads');
const { sendText, unsendMessage } = require('./sending/send');
const { editMessage } = require('./sending/edit');
const { sendReaction, deleteReaction, setMessageReaction, likeDirectMessage, unlikeDirectMessage } = require('./sending/reactions');
const { deleteMessage, setTyping: manageSetTyping, getThreadAdmins } = require('./threads/manage');
const { getPendingCount } = require('./threads/requests');
const { searchThreads, searchMessages, getUsersPresence, getActivePresence, searchGenAiBots, getChannels, getThreadByParticipants } = require('./threads/search');
const {
  createThread, hideThread, updateThreadTitle, addUsersToThread, markThreadUnread,
  muteThread, unmuteThread, muteVideoCall, unmuteVideoCall, setE2eeEligibility,
  getSpamInboxChunk, getSpamInbox,
} = require('./threads/rooms');
const {
  removeMember, setGroupTitle, getGroupMembers, inspectAccount, leaveGroup, joinGroupInvite, resolveGroupInvite,
} = require('./threads/group');
const { sendPhoto, sendVideo, sendVoice, sendFile } = require('./sending/media');
const { shareMedia, shareStory, shareProfile, sendCutoutSticker } = require('./sending/share');
const { listen, listenMqtt } = require('./listen');

function useMessage(client) {
  client.getThreads = (options) => getThreads(client, options);
  client.getThread = (threadId, options) => getThread(client, threadId, options);
  client.getMessages = (threadId, options) => getMessages(client, threadId, options);
  client.pendingRequests = (options, cb) => dualize(pendingRequests(client, options), cb);
  client.getPendingRequests = client.pendingRequests;
  client.approveRequest = (threadId, cb) => dualize(approveRequest(client, threadId), cb);
  client.markThreadSeen = (threadId, messageId) => markThreadSeen(client, threadId, messageId);
  client.sendMessage = (a, b, cb) => sendMessageShim(client, a, b, cb);
  client.sendReply = (threadId, text, replyTo, cb) => sendMessageShim(client, { text, threadIds: [threadId], replyTo }, undefined, cb);
  client.unsendMessage = (threadId, messageId) => unsendMessage(client, threadId, messageId);
  client.editMessage = (threadId, messageId, newText, options) => editMessage(client, threadId, messageId, newText, options);
  client.sendReaction = (threadId, messageId, emoji, options) => sendReaction(client, threadId, messageId, emoji, options);
  client.deleteReaction = (threadId, messageId, emoji, options) => deleteReaction(client, threadId, messageId, emoji, options);
  client.likeDirectMessage = (threadId, messageId, cb) => dualize(likeDirectMessage(client, threadId, messageId), cb);
  client.unlikeDirectMessage = (threadId, messageId, cb) => dualize(unlikeDirectMessage(client, threadId, messageId), cb);
  client.listen = (onEvent, options) => listen(client, onEvent, options);
  client.listenMqtt = client.listen;
  client.realtimeConnect = (options) => {
    const { RealtimeClient } = require('./listener/realtime');
    if (!client._realtimeClient) {
      const api = {
        sessionid: client.sessionid,
        phoneId: client.phoneId,
        userAgent: client.userAgent,
        userId: client.userId,
        appVersion: client.appVersion,
        locale: client.locale,
        clientRef: client,
        directThreads: async (amount) => {
          const { getThreads } = require('./threads/threads');
          await getThreads(client, { amount: amount === undefined ? 1 : amount });
          return (client.api && client.api.lastJson) || {};
        },
      };
      client._realtimeClient = new RealtimeClient(api, options && options.transport);
    }
    return client._realtimeClient;
  };
  client.realtimeDisconnect = () => {
    try {
      if (client._realtimeClient) {
        client._realtimeClient.disconnect();
      }
    } finally {
      client._realtimeClient = null;
    }
  };
  client.realtimeOn = (event, handler) => client.realtimeConnect().on(event, handler);
  client.realtimePing = () => {
    if (!client._realtimeClient) {
      throw new (require('../exceptions').RealtimeNotConnected)();
    }
    return client._realtimeClient.ping();
  };
  client.realtimeReadOnce = () => {
    if (!client._realtimeClient) {
      throw new (require('../exceptions').RealtimeNotConnected)();
    }
    return client._realtimeClient.readOnce();
  };
  const REALTIME_DIRECT_METHODS = [
    'directSendText', 'directSendReaction', 'directMarkSeen', 'directIndicateActivity',
    'directSubscribe', 'irisSubscribe', 'graphQlSubscribe', 'skywalkerSubscribe',
    'sendForegroundState', 'publishJson',
  ];
  REALTIME_DIRECT_METHODS.forEach((name) => {
    client[name] = (...args) => {
      let callback = null;
      if (args.length > 0 && typeof args[args.length - 1] === 'function') {
        callback = args.pop();
      }
      const promise = Promise.resolve().then(() => {
        const rt = client._realtime || client._realtimeClient;
        if (!rt || typeof rt[name] !== 'function') {
          throw new (require('../exceptions').RealtimeNotConnected)();
        }
        return rt[name](...args);
      });
      return dualize(promise, callback);
    };
  });
  client.fbnsConnect = (options) => {
    const { FbnsClient, FbnsDeviceAuth } = require('./listener/fbns');
    const opts = options || {};
    if (!client._fbnsClient) {
      client._fbnsClient = new FbnsClient(client, opts.transport, opts.auth || FbnsDeviceAuth.fromClient(client));
    }
    return client._fbnsClient;
  };
  client.fbnsDisconnect = () => {
    try {
      if (client._fbnsClient) {
        client._fbnsClient.disconnect();
      }
    } finally {
      client._fbnsClient = null;
    }
  };
  client.fbnsOn = (event, handler) => client.fbnsConnect().on(event, handler);
  client.fbnsPing = () => {
    if (!client._fbnsClient) {
      throw new Error('@alaminnna/ica-unofficial: FBNS client is not connected');
    }
    return client._fbnsClient.ping();
  };
  client.fbnsReadOnce = () => {
    if (!client._fbnsClient) {
      throw new Error('@alaminnna/ica-unofficial: FBNS client is not connected');
    }
    return client._fbnsClient.readOnce();
  };
  client.sendTyping = (threadId) => sendTypingShim(client, threadId);
  client.setTyping = (threadId, on, cb) => dualize(manageSetTyping(client, threadId, on), cb);
  client.sendPhoto = (options, cb) => dualize(sendPhoto(client, options), cb);
  client.sendVideo = (options, cb) => dualize(sendVideo(client, options), cb);
  client.sendVoice = (options, cb) => dualize(sendVoice(client, options), cb);
  client.sendFile = (options, cb) => dualize(sendFile(client, options), cb);
  client.setMessageReaction = (options, cb) => dualize(setMessageReaction(client, options), cb);
  client.deleteMessage = (threadId, messageId, cb) => dualize(deleteMessage(client, threadId, messageId), cb);
  client.getThreadAdmins = (threadId, options, cb) => {
    const callback = typeof options === 'function' ? options : cb;
    const opts = typeof options === 'function' ? undefined : options;
    return dualize(getThreadAdmins(client, threadId, opts), callback);
  };
  client.getPendingCount = (cb) => dualize(getPendingCount(client), cb);
  client.searchThreads = (query, mode, cb) => {
    let m = mode;
    let callback = cb;
    if (typeof m === 'function') {
      callback = m;
      m = undefined;
    }
    return dualize(searchThreads(client, query, m), callback);
  };
  client.searchMessages = (query, cb) => dualize(searchMessages(client, query), cb);
  client.getUsersPresence = (userIds, cb) => dualize(getUsersPresence(client, userIds), cb);
  client.getActivePresence = (cb) => dualize(getActivePresence(client), cb);
  client.searchGenAiBots = (amount, cb) => dualize(searchGenAiBots(client, amount), cb);
  client.getChannels = (options, cb) => dualize(getChannels(client, options), cb);
  client.getThreadByParticipants = (userIds, cb) => dualize(getThreadByParticipants(client, userIds), cb);
  client.createThread = (options, cb) => dualize(createThread(client, options), cb);
  client.hideThread = (threadId, moveToSpam, cb) => dualize(hideThread(client, threadId, moveToSpam), cb);
  client.updateThreadTitle = (threadId, title, cb) => dualize(updateThreadTitle(client, threadId, title), cb);
  client.addUsersToThread = (threadId, userIds, cb) => dualize(addUsersToThread(client, threadId, userIds), cb);
  client.markThreadUnread = (threadId, cb) => dualize(markThreadUnread(client, threadId), cb);
  client.muteThread = (threadId, cb) => dualize(muteThread(client, threadId), cb);
  client.unmuteThread = (threadId, cb) => dualize(unmuteThread(client, threadId), cb);
  client.muteVideoCall = (threadId, cb) => dualize(muteVideoCall(client, threadId), cb);
  client.unmuteVideoCall = (threadId, cb) => dualize(unmuteVideoCall(client, threadId), cb);
  client.setE2eeEligibility = (value, cb) => dualize(setE2eeEligibility(client, value), cb);
  client.getSpamInbox = (amount, cb) => dualize(getSpamInbox(client, amount), cb);
  client.getSpamInboxChunk = (cursor, cb) => dualize(getSpamInboxChunk(client, cursor), cb);
  client.removeMember = (threadId, users, cb) => dualize(removeMember(client, threadId, users), cb);
  client.leaveGroup = (threadId, cb) => dualize(leaveGroup(client, threadId), cb);
  client.joinGroupInvite = (input, cb) => dualize(joinGroupInvite(client, input), cb);
  client.resolveGroupInvite = (input, cb) => dualize(resolveGroupInvite(client, input), cb);
  client.setGroupTitle = (threadId, title, cb) => dualize(setGroupTitle(client, threadId, title), cb);
  client.getGroupMembers = (threadId, cb) => dualize(getGroupMembers(client, threadId), cb);
  client.inspectAccount = (input, cb) => dualize(inspectAccount(client, input), cb);
  client.shareMedia = (options, cb) => dualize(shareMedia(client, options), cb);
  client.shareStory = (options, cb) => dualize(shareStory(client, options), cb);
  client.shareProfile = (options, cb) => dualize(shareProfile(client, options), cb);
  client.sendCutoutSticker = (options, cb) => dualize(sendCutoutSticker(client, options), cb);
}

function dualize(promise, cb) {
  if (typeof cb === 'function') {
    promise.then((out) => cb(null, out), (err) => cb(err, null));
    return undefined;
  }
  return promise;
}

function sendTypingShim(client, threadId) {
  if (client.preferMqttActions === false) {
    return false;
  }
  const rt = client._realtime || client._realtimeClient;
  if (!rt || typeof rt.indicateActivity !== 'function') {
    return false;
  }
  rt.indicateActivity(threadId, true).catch(() => {});
  return true;
}

function sendMessageShim(client, a, b, cb) {
  let options;
  let callback = cb;
  if (typeof a === 'string') {
    options = { text: a };
    if (typeof b === 'string' || typeof b === 'number') {
      options.threadIds = [b];
    } else if (b && typeof b === 'object') {
      if (b.threadId) {
        options.threadIds = [b.threadId];
      }
      if (b.userIds) {
        options.userIds = b.userIds;
      }
    }
    if (typeof cb !== 'function' && typeof b === 'function') {
      callback = b;
    }
  } else {
    options = a || {};
    if (options.threadId && !options.threadIds) {
      options.threadIds = [options.threadId];
    }
    if (typeof b === 'function') {
      callback = b;
    }
  }
  const promise = sendText(client, options);
  if (typeof callback === 'function') {
    promise.then((info) => callback(null, info), (err) => callback(err, null));
    return undefined;
  }
  return promise;
}

module.exports = { useMessage };