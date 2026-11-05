/**
 * @alaminnna/ica-unofficial — discover/index
 *
 * RESPONSIBILITY: ONLY wires discover submodules onto the client, no logic.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./location, ./insights, ./track, ./search, ./hashtag + dualize for callback/promise
 * MUST NOT:       no direct api calls here
 *
 * DEBUG: when client.searchLocations is not a function, start looking here — useDiscover not called
 */

'use strict';

const {
  searchLocations, getLocationInfo, getLocationMedias, getLocationMediasChunk,
  getLocationMediasTop, getLocationMediasRecent, searchLocationsByName, searchLocationByPk,
  completeLocation, buildLocation, locationStoryStickerId, getLocationGuides,
} = require('./location');
const { getAccountInsights, getMediaInsights } = require('./insights');
const {
  searchMusic, musicInFeedBrowser, musicTrending, searchMusicV2, musicKeywordSearch,
  bookmarkTrack, bookmarkedTracks, clipsAudioBrowser, verifyAudioTitle,
  trackInfoByCanonicalId, trackInfoById, trackStreamInfoById,
} = require('./track');
const {
  topsearchFlat, searchUsersAdvanced, searchHashtags, searchPlaces, searchMedias,
  webSearchTopsearch, webSearchTopsearchHashtags, fbsearchItem, keywordTypeahead,
  typeaheadStream, typeaheadUsers, recentSearches, searchAccountsV2, searchReelsV2,
  topsearchV2, suggestedProfiles, searchUsers,
} = require('./search');
const {
  getHashtagInfo, getHashtagMediasChunk, getHashtagMedias, getHashtagMediasTop,
  getHashtagMediasRecent, getHashtagMediasReels, followHashtag, unfollowHashtag,
  getFollowedHashtags,
} = require('./hashtag');

function dualize(promise, cb) {
  if (typeof cb === 'function') {
    promise.then((out) => cb(null, out), (err) => cb(err, null));
    return undefined;
  }
  return promise;
}

function useDiscover(client) {
  client.searchLocations = (options, cb) => dualize(searchLocations(client, options), cb);
  client.getLocationInfo = (locationPk, cb) => dualize(getLocationInfo(client, locationPk), cb);
  client.getLocationMedias = (options, cb) => dualize(getLocationMedias(client, options), cb);
  client.getLocationMediasChunk = (options, cb) => dualize(getLocationMediasChunk(client, options), cb);
  client.getLocationMediasTop = (locationPk, amount, cb) => dualize(getLocationMediasTop(client, locationPk, amount), cb);
  client.getLocationMediasRecent = (locationPk, amount, cb) => dualize(getLocationMediasRecent(client, locationPk, amount), cb);
  client.searchLocationsByName = (name, cb) => dualize(searchLocationsByName(client, name), cb);
  client.searchLocationByPk = (locationPk, cb) => dualize(searchLocationByPk(client, locationPk), cb);
  client.completeLocation = (location, cb) => dualize(completeLocation(client, location), cb);
  client.buildLocation = (location) => buildLocation(location);
  client.locationStoryStickerId = (location) => locationStoryStickerId(location);
  client.getLocationGuides = (locationPk, cb) => dualize(getLocationGuides(client, locationPk), cb);
  client.getAccountInsights = (cb) => dualize(getAccountInsights(client), cb);
  client.getMediaInsights = (mediaPk, cb) => dualize(getMediaInsights(client, mediaPk), cb);
  client.searchMusic = (query, browseSessionId, cb) => dualize(searchMusic(client, query, browseSessionId), cb);
  client.musicInFeedBrowser = (browseSessionId, cb) => dualize(musicInFeedBrowser(client, browseSessionId), cb);
  client.musicTrending = (product, cb) => dualize(musicTrending(client, product), cb);
  client.searchMusicV2 = (query, options, cb) => dualize(searchMusicV2(client, query, options), cb);
  client.musicKeywordSearch = (query, options, cb) => dualize(musicKeywordSearch(client, query, options), cb);
  client.bookmarkTrack = (audioId, surface, cb) => dualize(bookmarkTrack(client, audioId, surface), cb);
  client.bookmarkedTracks = (maxId, cb) => dualize(bookmarkedTracks(client, maxId), cb);
  client.clipsAudioBrowser = (options, cb) => dualize(clipsAudioBrowser(client, options), cb);
  client.verifyAudioTitle = (title, cb) => dualize(verifyAudioTitle(client, title), cb);
  client.trackInfoByCanonicalId = (canonicalId, cb) => dualize(trackInfoByCanonicalId(client, canonicalId), cb);
  client.trackInfoById = (trackId, maxId, cb) => dualize(trackInfoById(client, trackId, maxId), cb);
  client.trackStreamInfoById = (trackId, maxId, cb) => dualize(trackStreamInfoById(client, trackId, maxId), cb);
  client.topsearchFlat = (query, cb) => dualize(topsearchFlat(client, query), cb);
  client.searchUsersAdvanced = (query, amount, cb) => dualize(searchUsersAdvanced(client, query, amount), cb);
  client.searchHashtags = (query, amount, cb) => dualize(searchHashtags(client, query, amount), cb);
  client.searchPlaces = (query, options, cb) => dualize(searchPlaces(client, query, options), cb);
  client.searchMedias = (options, cb) => dualize(searchMedias(client, options), cb);
  client.webSearchTopsearch = (query, cb) => dualize(webSearchTopsearch(client, query), cb);
  client.webSearchTopsearchHashtags = (query, cb) => dualize(webSearchTopsearchHashtags(client, query), cb);
  client.fbsearchItem = (options, cb) => dualize(fbsearchItem(client, options), cb);
  client.keywordTypeahead = (query, options, cb) => dualize(keywordTypeahead(client, query, options), cb);
  client.typeaheadStream = (query, options, cb) => dualize(typeaheadStream(client, query, options), cb);
  client.typeaheadUsers = (query, options, cb) => dualize(typeaheadUsers(client, query, options), cb);
  client.recentSearches = (cb) => dualize(recentSearches(client), cb);
  client.searchAccountsV2 = (query, pageToken, cb) => dualize(searchAccountsV2(client, query, pageToken), cb);
  client.searchReelsV2 = (query, options, cb) => dualize(searchReelsV2(client, query, options), cb);
  client.topsearchV2 = (query, options, cb) => dualize(topsearchV2(client, query, options), cb);
  client.suggestedProfiles = (userId, cb) => dualize(suggestedProfiles(client, userId), cb);
  client.searchUsers = (query, count, cb) => dualize(searchUsers(client, query, count), cb);
  client.getHashtagInfo = (name, cb) => dualize(getHashtagInfo(client, name), cb);
  client.getHashtagMediasChunk = (options, cb) => dualize(getHashtagMediasChunk(client, options), cb);
  client.getHashtagMedias = (options, cb) => dualize(getHashtagMedias(client, options), cb);
  client.getHashtagMediasTop = (name, amount, cb) => dualize(getHashtagMediasTop(client, name, amount), cb);
  client.getHashtagMediasRecent = (name, amount, cb) => dualize(getHashtagMediasRecent(client, name, amount), cb);
  client.getHashtagMediasReels = (name, amount, cb) => dualize(getHashtagMediasReels(client, name, amount), cb);
  client.followHashtag = (name, cb) => dualize(followHashtag(client, name), cb);
  client.unfollowHashtag = (name, cb) => dualize(unfollowHashtag(client, name), cb);
  client.getFollowedHashtags = (amount, cb) => dualize(getFollowedHashtags(client, amount), cb);
}

module.exports = { useDiscover };