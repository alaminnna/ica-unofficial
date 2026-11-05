/**
 * @alaminnna/ica-unofficial — user/index
 * 
 * RESPONSIBILITY: ONLY wires user submodules onto the client, no logic.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./info, ./notes, ./social, ./actions, ./requests, ./extras, ./discovery, ./lookup, ./content
 * MUST NOT:       no direct api calls here
 * 
 * DEBUG: when client.getFollowers is not a function, start looking here — useUser not called
 */

'use strict';

const { getUserInfo, getUserInfoByUsername, getUserIdFromUsername, getUsernameFromUserId, usernameFromUserId } = require('./info');
const { createNote, deleteNote, getNotes, notesMusicBrowser, createMusicNote } = require('./notes');
const { getFollowers, getFollowing, getMutualFollowers, getFollowersChunk, getFollowingChunk, iterUserFollowers, iterUserFollowing, searchFollowers, searchFollowing } = require('./social');
const { getFriendship, getUserFriendship, getUserFriendships, follow, unfollow, block, unblock } = require('./actions');
const {
  getFollowRequestsChunk, getFollowRequests,
  approveFollowRequest, declineFollowRequest, approveFollowRequests, declineFollowRequests,
  closeFriendAdd, closeFriendRemove,
  mutePostsFromFollow, unmutePostsFromFollow, muteStoriesFromFollow, unmuteStoriesFromFollow,
  setPostsNotifications, setVideosNotifications, setReelsNotifications, setStoriesNotifications,
  removeFollower, reportUser,
} = require('./requests');
const { getUserMedias, getUserTags, getUserStories, getUserMediasPaginated, getUserTagsPaginated, iterUserMedias } = require('./content');
const { getUserAbout, getUserGuides, getCreatorInfo } = require('./extras');
const { getChaining, fetchSuggestionDetails, getSuggestedProfiles, getRelatedProfiles, getRecommendedAccountsForCategory } = require('./discovery');
const {
  getUserStreamByUsername, getUserStreamById, getUserStreamByIdFlat, getUserStreamByUsernameFlat,
  getWebProfileInfo, getUserShortGql, getUsernameFromUserIdGql, getUserInfoV2Gql, getUserInfoByUsernameV2Gql,
  getFollowersPrivateGqlChunk, getFollowersPrivateGql, getFollowingPrivateGqlChunk, getFollowingPrivateGql,
  getClipsProfileGql, getInboxTrayGql, getFeedUserStreamItem,
} = require('./lookup');
const { linkAddressBook, unlinkAddressBook } = require('./addressbook');

function useUser(client) {
  client.getUserInfo = (userId) => getUserInfo(client, userId);
  client.getUserInfoByUsername = (username) => getUserInfoByUsername(client, username);
  client.getUserIdFromUsername = (username) => getUserIdFromUsername(client, username);
  client.getUsernameFromUserId = (userId) => getUsernameFromUserId(client, userId);
  client.usernameFromUserId = (userId) => usernameFromUserId(client, userId);
  client.createNote = (options) => createNote(client, options);
  client.deleteNote = (noteId) => deleteNote(client, noteId);
  client.getNotes = () => getNotes(client);
  client.notesMusicBrowser = () => notesMusicBrowser(client);
  client.createMusicNote = (options) => createMusicNote(client, options);
  client.getFollowers = (options) => getFollowers(client, options);
  client.getFollowing = (options) => getFollowing(client, options);
  client.getMutualFollowers = (options) => getMutualFollowers(client, options);
  client.getFollowersChunk = (options) => getFollowersChunk(client, options);
  client.getFollowingChunk = (options) => getFollowingChunk(client, options);
  client.iterUserFollowers = (options) => iterUserFollowers(client, options);
  client.iterUserFollowing = (options) => iterUserFollowing(client, options);
  client.searchFollowers = (userId, query) => searchFollowers(client, userId, query);
  client.searchFollowing = (userId, query) => searchFollowing(client, userId, query);
  client.getFriendship = (userId) => getFriendship(client, userId);
  client.getUserFriendship = (userId) => getUserFriendship(client, userId);
  client.getUserFriendships = (userIds) => getUserFriendships(client, userIds);
  client.getCreatorInfo = (userId, entryPoint) => getCreatorInfo(client, userId, entryPoint);
  client.linkAddressBook = (contacts, include) => linkAddressBook(client, contacts, include);
  client.unlinkAddressBook = () => unlinkAddressBook(client);
  client.getFeedUserStreamItem = (itemId, pullToRefresh) => getFeedUserStreamItem(client, itemId, pullToRefresh);
  client.follow = (options) => follow(client, options);
  client.unfollow = (options) => unfollow(client, options);
  client.block = (options) => block(client, options);
  client.unblock = (options) => unblock(client, options);
  client.getFollowRequests = (options) => getFollowRequests(client, options);
  client.getFollowRequestsChunk = (options) => getFollowRequestsChunk(client, options);
  client.approveFollowRequest = (userId) => approveFollowRequest(client, userId);
  client.declineFollowRequest = (userId) => declineFollowRequest(client, userId);
  client.approveFollowRequests = (userIds) => approveFollowRequests(client, userIds);
  client.declineFollowRequests = (userIds) => declineFollowRequests(client, userIds);
  client.closeFriendAdd = (userId) => closeFriendAdd(client, userId);
  client.closeFriendRemove = (userId) => closeFriendRemove(client, userId);
  client.mutePostsFromFollow = (userId) => mutePostsFromFollow(client, userId);
  client.unmutePostsFromFollow = (userId) => unmutePostsFromFollow(client, userId);
  client.muteStoriesFromFollow = (userId) => muteStoriesFromFollow(client, userId);
  client.unmuteStoriesFromFollow = (userId) => unmuteStoriesFromFollow(client, userId);
  client.setPostsNotifications = (userId, enabled) => setPostsNotifications(client, userId, enabled);
  client.setVideosNotifications = (userId, enabled) => setVideosNotifications(client, userId, enabled);
  client.setReelsNotifications = (userId, enabled) => setReelsNotifications(client, userId, enabled);
  client.setStoriesNotifications = (userId, enabled) => setStoriesNotifications(client, userId, enabled);
  client.removeFollower = (userId) => removeFollower(client, userId);
  client.reportUser = (userId, reason) => reportUser(client, userId, reason);
  client.getUserAbout = (userId) => getUserAbout(client, userId);
  client.getUserGuides = (userId) => getUserGuides(client, userId);
  client.getChaining = (userId) => getChaining(client, userId);
  client.fetchSuggestionDetails = (userId, chainedIds) => fetchSuggestionDetails(client, userId, chainedIds);
  client.getSuggestedProfiles = (userId, expand) => getSuggestedProfiles(client, userId, expand);
  client.getRelatedProfiles = (userId) => getRelatedProfiles(client, userId);
  client.getRecommendedAccountsForCategory = (userId) => getRecommendedAccountsForCategory(client, userId);
  client.getUserStreamByUsername = (username) => getUserStreamByUsername(client, username);
  client.getUserStreamById = (userId) => getUserStreamById(client, userId);
  client.getUserStreamByIdFlat = (userId) => getUserStreamByIdFlat(client, userId);
  client.getUserStreamByUsernameFlat = (username) => getUserStreamByUsernameFlat(client, username);
  client.getWebProfileInfo = (username) => getWebProfileInfo(client, username);
  client.getUserShortGql = (userId) => getUserShortGql(client, userId);
  client.getUsernameFromUserIdGql = (userId) => getUsernameFromUserIdGql(client, userId);
  client.getUserInfoV2Gql = (userId) => getUserInfoV2Gql(client, userId);
  client.getUserInfoByUsernameV2Gql = (username) => getUserInfoByUsernameV2Gql(client, username);
  client.getFollowersPrivateGqlChunk = (options) => getFollowersPrivateGqlChunk(client, options);
  client.getFollowersPrivateGql = (options) => getFollowersPrivateGql(client, options);
  client.getFollowingPrivateGqlChunk = (options) => getFollowingPrivateGqlChunk(client, options);
  client.getFollowingPrivateGql = (options) => getFollowingPrivateGql(client, options);
  client.getClipsProfileGql = (userId, options) => getClipsProfileGql(client, userId, options);
  client.getInboxTrayGql = (userId) => getInboxTrayGql(client, userId);
  client.getUserMedias = (options) => getUserMedias(client, options);
  client.getUserMediasPaginated = (options) => getUserMediasPaginated(client, options);
  client.iterUserMedias = (options) => iterUserMedias(client, options);
  client.getUserTags = (options) => getUserTags(client, options);
  client.getUserTagsPaginated = (options) => getUserTagsPaginated(client, options);
  client.getUserStories = (userId, amount) => getUserStories(client, userId, amount);
}

module.exports = { useUser };