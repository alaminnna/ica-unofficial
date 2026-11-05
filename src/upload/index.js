/**
 * @alaminnna/ica-unofficial — upload/index
 *
 * RESPONSIBILITY: ONLY wires upload submodules onto the client, no logic.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        ./photo, ./video, ./album, ./igtv, ./reel + dualize for callback/promise
 * MUST NOT:       no direct api calls here
 *
 * DEBUG: when client.uploadPhoto is not a function, start looking here — useUpload not called
 */

'use strict';

const { uploadPhoto, uploadPhotoWithMusic } = require('./photo');
const { uploadVideo } = require('./video');
const { uploadAlbum, uploadAlbumWithMusic } = require('./album');
const { uploadIGTV } = require('./igtv');
const {
  uploadReel,
  uploadReelWithMusic,
  clipTrialEligible,
  clipInterestTopics,
  changeReelCover,
} = require('./reel');

function dualize(promise, cb) {
  if (typeof cb === 'function') {
    promise.then((out) => cb(null, out), (err) => cb(err, null));
    return undefined;
  }
  return promise;
}

function useUpload(client) {
  client.uploadPhoto = (options, cb) => dualize(uploadPhoto(client, options), cb);
  client.uploadPhotoWithMusic = (options, cb) => dualize(uploadPhotoWithMusic(client, options), cb);
  client.uploadVideo = (options, cb) => dualize(uploadVideo(client, options), cb);
  client.uploadAlbum = (options, cb) => dualize(uploadAlbum(client, options), cb);
  client.uploadAlbumWithMusic = (options, cb) => dualize(uploadAlbumWithMusic(client, options), cb);
  client.uploadIGTV = (options, cb) => dualize(uploadIGTV(client, options), cb);
  client.uploadReel = (options, cb) => dualize(uploadReel(client, options), cb);
  client.uploadReelWithMusic = (options, cb) => dualize(uploadReelWithMusic(client, options), cb);
  client.clipTrialEligible = (cb) => dualize(clipTrialEligible(client), cb);
  client.clipInterestTopics = (cb) => dualize(clipInterestTopics(client), cb);
  client.changeReelCover = (mediaPk, coverPath, cb) => dualize(changeReelCover(client, mediaPk, coverPath), cb);
}

module.exports = { useUpload };