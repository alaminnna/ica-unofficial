/**
 * @alaminnna/ica-unofficial — story/index
 *
 * RESPONSIBILITY: ONLY wires story submodules onto the client, no logic.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./reads, ./upload, ./builder, ./viewers, ./tray, ./highlights, ./extras + dualize for callback/promise
 * MUST NOT:       no direct api calls here
 *
 * DEBUG: when client.uploadPhotoStory is not a function, start looking here — useStory not called
 */

'use strict';

const { normalizeStory, getUserStories, getStory, downloadStory } = require('./reads');
const { uploadPhotoStory, uploadVideoStory, deleteStory } = require('./upload');
const { storyBuilder } = require('./builder');
const { getStoryViewers } = require('./viewers');
const { getStoryTray } = require('./tray');
const {
  getStoryInfo, getStoryLikersChunk, getStoryLikers, likeStory, unlikeStory,
  voteStoryPoll, getStickerTray, getArchiveStoryDaysPaginated, getArchiveStoryDays,
  getArchiveStories,
  shareMediaToStory,
} = require('./extras');
const {
  highlightPkFromUrl, getUserHighlights, getHighlightInfo, createHighlight, editHighlight,
  changeHighlightTitle, changeHighlightCover, addStoriesToHighlight, removeStoriesFromHighlight,
  deleteHighlight,
} = require('./highlights');

function dualize(promise, cb) {
  if (typeof cb === 'function') {
    promise.then((out) => cb(null, out), (err) => cb(err, null));
    return undefined;
  }
  return promise;
}

function useStory(client) {
  client.getUserStories = (userId, amount, cb) => dualize(getUserStories(client, userId, amount), cb);
  client.getStory = (storyId, cb) => dualize(getStory(client, storyId), cb);
  client.downloadStory = (options, cb) => dualize(downloadStory(client, options), cb);
  client.uploadPhotoStory = (options, cb) => dualize(uploadPhotoStory(client, options), cb);
  client.uploadVideoStory = (options, cb) => dualize(uploadVideoStory(client, options), cb);
  client.deleteStory = (storyId, cb) => dualize(deleteStory(client, storyId), cb);
  client.storyBuilder = (background) => storyBuilder(background);
  client.getStoryViewers = (options, cb) => dualize(getStoryViewers(client, options), cb);
  client.getStoryTray = (options, cb) => dualize(getStoryTray(client, options), cb);
  client.getStoryInfo = (storyId, cb) => dualize(getStoryInfo(client, storyId), cb);
  client.getStoryLikersChunk = (storyId, options, cb) => dualize(getStoryLikersChunk(client, storyId, options), cb);
  client.getStoryLikers = (storyId, amount, cb) => dualize(getStoryLikers(client, storyId, amount), cb);
  client.likeStory = (storyId, options, cb) => dualize(likeStory(client, storyId, options), cb);
  client.unlikeStory = (storyId, cb) => dualize(unlikeStory(client, storyId), cb);
  client.voteStoryPoll = (storyId, pollId, vote, cb) => dualize(voteStoryPoll(client, storyId, pollId, vote), cb);
  client.getStickerTray = (cb) => dualize(getStickerTray(client), cb);
  client.getArchiveStoryDaysPaginated = (options, cb) => dualize(getArchiveStoryDaysPaginated(client, options), cb);
  client.getArchiveStoryDays = (options, cb) => dualize(getArchiveStoryDays(client, options), cb);
  client.getArchiveStories = (amount, cb) => dualize(getArchiveStories(client, amount), cb);
  client.shareMediaToStory = (options, cb) => dualize(shareMediaToStory(client, options), cb);
  client.highlightPkFromUrl = (url) => highlightPkFromUrl(url);
  client.getUserHighlights = (userId, amount, cb) => dualize(getUserHighlights(client, userId, amount), cb);
  client.getHighlightInfo = (highlightId, cb) => dualize(getHighlightInfo(client, highlightId), cb);
  client.createHighlight = (options, cb) => dualize(createHighlight(client, options), cb);
  client.editHighlight = (highlightId, options, cb) => dualize(editHighlight(client, highlightId, options), cb);
  client.changeHighlightTitle = (highlightId, title, cb) => dualize(changeHighlightTitle(client, highlightId, title), cb);
  client.changeHighlightCover = (highlightId, coverPath, cb) => dualize(changeHighlightCover(client, highlightId, coverPath), cb);
  client.addStoriesToHighlight = (highlightId, storyIds, cb) => dualize(addStoriesToHighlight(client, highlightId, storyIds), cb);
  client.removeStoriesFromHighlight = (highlightId, storyIds, cb) => dualize(removeStoriesFromHighlight(client, highlightId, storyIds), cb);
  client.deleteHighlight = (highlightId, cb) => dualize(deleteHighlight(client, highlightId), cb);
}

module.exports = { useStory, normalizeStory, getUserStories, getStory, downloadStory };