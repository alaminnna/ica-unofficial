/**
 * @alaminnna/ica-unofficial — media/download
 * 
 * RESPONSIBILITY: media/story byte downloads to disk with safe filenames.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:fs, node:path, axios
 * MUST NOT:       never trust remote filenames unsanitized
 * 
 * DEBUG: when a saved file is corrupt or missing, start looking here — stream and naming logic
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');

function sanitizeFilename(name) {
  return String(name || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120) || 'file';
}

function extFromUrl(url, fallback) {
  const pathname = String(url).split('?')[0];
  const base = pathname.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot !== -1 && base.length - dot <= 6) {
    return base.slice(dot);
  }
  return fallback;
}

async function downloadUrl(options) {
  const opts = options || {};
  if (!opts.url) {
    throw new Error('@alaminnna/ica-unofficial: downloadUrl needs { url, path }');
  }
  const dir = path.dirname(opts.path);
  fs.mkdirSync(dir, { recursive: true });
  const instance = opts.axiosInstance || axios.create();
  const res = await instance.get(opts.url, { responseType: 'stream', timeout: 120000, maxBodyLength: Infinity });
  const expected = Number(res.headers && (res.headers['content-length'] || res.headers['Content-Length']));
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(opts.path);
    let failed = false;
    const fail = (err) => {
      if (!failed) {
        failed = true;
        try {
          fs.unlinkSync(opts.path);
        } catch (cleanupErr) {
          // ignore cleanup errors
        }
        reject(err);
      }
    };
    res.data.on('error', fail);
    writer.on('error', fail);
    writer.on('finish', () => {
      if (failed) {
        return;
      }
      if (expected && fs.statSync(opts.path).size !== expected) {
        fail(new Error('@alaminnna/ica-unofficial: incomplete download (size mismatch)'));
        return;
      }
      resolve(opts.path);
    });
    res.data.pipe(writer);
  });
  return opts.path;
}

async function downloadMedia(client, options) {
  const opts = options || {};
  const { getMediaInfo } = require('./info');
  const info = await getMediaInfo(client, opts.mediaId === undefined ? opts.url : opts.mediaId);
  const isVideo = info.mediaType === 2;
  const url = isVideo ? info.videoUrl : info.thumbnailUrl;
  if (!url) {
    throw new Error('@alaminnna/ica-unofficial: no downloadable URL for media');
  }
  const ext = extFromUrl(url, isVideo ? '.mp4' : '.jpg');
  const folder = opts.folder || client.downloadFolder || './downloads';
  const filename = sanitizeFilename((info.username || 'media') + '_' + (info.pk || 'file')) + ext;
  const filePath = path.resolve(folder, filename);
  if (opts.overwrite === false && fs.existsSync(filePath)) {
    return filePath;
  }
  return downloadUrl({ url, path: filePath });
}

module.exports = { sanitizeFilename, extFromUrl, downloadUrl, downloadMedia };