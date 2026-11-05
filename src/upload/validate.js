/**
 * @alaminnna/ica-unofficial — upload/validate
 *
 * RESPONSIBILITY: upload input checks only — magic-byte sniffing, extension
 *   rules, and path|url resolution to a local file (tiny local downloader,
 *   no sideways import from src/media).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:fs, node:os, node:path, axios, ../core/delays
 * MUST NOT:       never import from src/media or other feature mixins (boundary)
 *
 * DEBUG: when uploads reject valid files, start looking here — sniff table or ext list
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');

const PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
const VIDEO_EXTS = ['.mp4'];
const SNIFF_BYTES = 64;

function sniffKind(buffer) {
  if (!buffer || buffer.length < 12) {
    return null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (buffer.slice(4, 8).toString('ascii') === 'ftyp') {
    return 'mp4';
  }
  return null;
}

function sniffFile(filePath, byteCount) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(byteCount || SNIFF_BYTES);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    return sniffKind(buf.slice(0, read));
  } finally {
    fs.closeSync(fd);
  }
}

function extOf(filePath) {
  return path.extname(String(filePath || '')).toLowerCase();
}

function assertPhotoFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('@alaminnna/ica-unofficial: photo file not found: ' + filePath);
  }
  const ext = extOf(filePath);
  if (PHOTO_EXTS.indexOf(ext) === -1) {
    throw new Error('@alaminnna/ica-unofficial: invalid photo format "' + ext + '". Only JPG/JPEG/PNG/WEBP supported.');
  }
  const kind = sniffFile(filePath);
  if (kind !== 'jpg' && kind !== 'png' && kind !== 'webp') {
    throw new Error('@alaminnna/ica-unofficial: photo magic bytes mismatch for: ' + filePath);
  }
  return ext;
}

function assertVideoFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('@alaminnna/ica-unofficial: video file not found: ' + filePath);
  }
  const ext = extOf(filePath);
  if (VIDEO_EXTS.indexOf(ext) === -1) {
    throw new Error('@alaminnna/ica-unofficial: invalid video format "' + ext + '". Only MP4 supported.');
  }
  if (sniffFile(filePath) !== 'mp4') {
    throw new Error('@alaminnna/ica-unofficial: video magic bytes mismatch (ftyp not found): ' + filePath);
  }
  return ext;
}

async function downloadToTemp(url, ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ica-unofficial-upload-'));
  const filePath = path.join(dir, 'input' + (ext || '.bin'));
  const res = await axios.get(String(url), { responseType: 'stream', timeout: 120000, maxBodyLength: Infinity });
  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    let failed = false;
    const fail = (err) => {
      if (!failed) {
        failed = true;
        reject(err);
      }
    };
    res.data.on('error', fail);
    writer.on('error', fail);
    writer.on('finish', resolve);
    res.data.pipe(writer);
  });
  return filePath;
}

// Input: { path } or { url }. Returns { path, cleanup } — caller MUST await cleanup()
// after the upload finishes (it removes the temp dir for url inputs; no-op for path).
async function resolveUploadInput(input, opts) {
  const options = opts || {};
  if (input && input.path) {
    const filePath = path.resolve(String(input.path));
    if (!fs.existsSync(filePath)) {
      throw new Error('@alaminnna/ica-unofficial: upload file not found: ' + filePath);
    }
    return { path: filePath, cleanup: async () => {} };
  }
  if (input && input.url) {
    const ext = options.ext || '.bin';
    const filePath = await downloadToTemp(input.url, ext);
    return {
      path: filePath,
      cleanup: async () => {
        try {
          fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        } catch (ignored) {
          // ignore temp cleanup errors
        }
      },
    };
  }
  throw new Error('@alaminnna/ica-unofficial: upload needs { path } or { url }');
}

module.exports = {
  PHOTO_EXTS,
  VIDEO_EXTS,
  sniffKind,
  sniffFile,
  extOf,
  assertPhotoFile,
  assertVideoFile,
  resolveUploadInput,
};