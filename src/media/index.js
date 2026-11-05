/**
 * @alaminnna/ica-unofficial — media/index
 * 
 * RESPONSIBILITY: ONLY wires media submodules onto the client, no logic.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./info, ./download, ./story, ./engagement, ./manage, ./notes, ./live, ./feed, ./comments
 * MUST NOT:       no direct api calls here
 * 
 * DEBUG: when client.getMediaInfo is not a function, start looking here — useMedia not called
 */

'use strict';

const { getMediaInfo } = require('./info');
const { downloadMedia } = require('./download');
const { getStory, getUserStories, downloadStory } = require('./story');
const { getLikedMedias, getMediaLikers, getCommentReplies } = require('./engagement');
const {
  deleteMedia,
  editMedia,
  linkReel,
  archiveMedia,
  unarchiveMedia,
  getArchivedMedias,
  pinMedia,
  unpinMedia,
  pinReel,
  unpinReel,
  markMediaSeen,
  markClipsSeen,
  getMediaOembed,
  getMediaAuthor,
  getMediaInfoV2,
  videoRefreshResources,
  uploadCutoutSticker,
  getUserClips,
  getUserVideos,
} = require('./manage');
const { createMediaNote, deleteMediaNote } = require('./notes');
const {
  createLivestream,
  startLivestream,
  endLivestream,
  getLivestreamInfo,
  getLivestreamComments,
  getLivestreamViewers,
} = require('./live');
const { getTimelineFeed, getReels, getExploreReels, getFriendsReels } = require('./feed');
const {
  getCollections, getCollectionIdByName, getCollectionMediasChunk, getCollectionMedias,
  getCollectionMediasByName, saveMedia, unsaveMedia,
} = require('./collections');
const {
  getCommentsChunk, getComments, postComment,
  checkOffensiveComment, checkOffensiveCommentRaw,
  likeComment, unlikeComment, pinComment, unpinComment,
  bulkDeleteComments, getCommentLikersChunk, getCommentLikers,
} = require('./comments');

function useMedia(client) {
  client.getMediaInfo = (input) => getMediaInfo(client, input);
  client.downloadMedia = (options) => downloadMedia(client, options);
  client.getStory = (storyId) => getStory(client, storyId);
  client.getUserStories = (userId, amount) => getUserStories(client, userId, amount);
  client.downloadStory = (options) => downloadStory(client, options);
  client.getLikedMedias = (amount) => getLikedMedias(client, amount);
  client.getMediaLikers = (mediaId) => getMediaLikers(client, mediaId);
  client.getCommentReplies = (mediaId, commentId, amount) => getCommentReplies(client, mediaId, commentId, amount);
  client.deleteMedia = (mediaId) => deleteMedia(client, mediaId);
  client.editMedia = (options) => editMedia(client, options);
  client.linkReel = (mediaId, targetMediaId, linkName) => linkReel(client, mediaId, targetMediaId, linkName);
  client.archiveMedia = (mediaId) => archiveMedia(client, mediaId);
  client.unarchiveMedia = (mediaId) => unarchiveMedia(client, mediaId);
  client.getArchivedMedias = (amount) => getArchivedMedias(client, amount);
  client.pinMedia = (mediaPk) => pinMedia(client, mediaPk);
  client.unpinMedia = (mediaPk) => unpinMedia(client, mediaPk);
  client.pinReel = (mediaPk) => pinReel(client, mediaPk);
  client.unpinReel = (mediaPk) => unpinReel(client, mediaPk);
  client.markMediaSeen = (mediaIds, skippedIds) => markMediaSeen(client, mediaIds, skippedIds);
  client.markClipsSeen = (mediaIds, blendIds) => markClipsSeen(client, mediaIds, blendIds);
  client.getMediaOembed = (url) => getMediaOembed(client, url);
  client.getMediaAuthor = (mediaPk) => getMediaAuthor(client, mediaPk);
  client.getMediaInfoV2 = (mediaId) => getMediaInfoV2(client, mediaId);
  client.videoRefreshResources = (mediaId, allVariants) => videoRefreshResources(client, mediaId, allVariants);
  client.uploadCutoutSticker = (options) => uploadCutoutSticker(client, options);
  client.getUserClips = (options) => getUserClips(client, options);
  client.getUserVideos = (options) => getUserVideos(client, options);
  client.createMediaNote = (options) => createMediaNote(client, options);
  client.deleteMediaNote = (noteId, extraData) => deleteMediaNote(client, noteId, extraData);
  client.createLivestream = (title) => createLivestream(client, title);
  client.startLivestream = (broadcastId) => startLivestream(client, broadcastId);
  client.endLivestream = (broadcastId) => endLivestream(client, broadcastId);
  client.getLivestreamInfo = (broadcastId) => getLivestreamInfo(client, broadcastId);
  client.getLivestreamComments = (broadcastId) => getLivestreamComments(client, broadcastId);
  client.getLivestreamViewers = (broadcastId) => getLivestreamViewers(client, broadcastId);
  client.getTimelineFeed = (options) => getTimelineFeed(client, options);
  client.getReels = (options) => getReels(client, options);
  client.getExploreReels = (options) => getExploreReels(client, options);
  client.getFriendsReels = (options) => getFriendsReels(client, options);
  client.getComments = (options) => getComments(client, options);
  client.getCommentsChunk = (options) => getCommentsChunk(client, options);
  client.postComment = (options) => postComment(client, options);
  client.checkOffensiveComment = (mediaId, text) => checkOffensiveComment(client, mediaId, text);
  client.checkOffensiveCommentRaw = (mediaId, text) => checkOffensiveCommentRaw(client, mediaId, text);
  client.likeComment = (commentId) => likeComment(client, commentId);
  client.unlikeComment = (commentId) => unlikeComment(client, commentId);
  client.pinComment = (mediaId, commentId) => pinComment(client, mediaId, commentId);
  client.unpinComment = (mediaId, commentId) => unpinComment(client, mediaId, commentId);
  client.bulkDeleteComments = (mediaId, commentIds) => bulkDeleteComments(client, mediaId, commentIds);
  client.getCommentLikersChunk = (commentId, endCursor) => getCommentLikersChunk(client, commentId, endCursor);
  client.getCommentLikers = (commentId, amount) => getCommentLikers(client, commentId, amount);
  client.getCollections = (cb) => dualize(getCollections(client), cb);
  client.getCollectionIdByName = (name, cb) => dualize(getCollectionIdByName(client, name), cb);
  client.getCollectionMediasChunk = (options, cb) => dualize(getCollectionMediasChunk(client, options), cb);
  client.getCollectionMedias = (options, cb) => dualize(getCollectionMedias(client, options), cb);
  client.getCollectionMediasByName = (options, cb) => dualize(getCollectionMediasByName(client, options), cb);
  client.saveMedia = (options, cb) => dualize(saveMedia(client, options), cb);
  client.unsaveMedia = (options, cb) => dualize(unsaveMedia(client, options), cb);
}

module.exports = { useMedia };