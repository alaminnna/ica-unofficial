/**
 * @alaminnna/ica-unofficial — upload/thumb
 *
 * RESPONSIBILITY: video/image dimension probing + thumbnails only — pure-MP4
 *   moov parser (zero dep), JPEG/PNG/WebP size readers, ffmpeg thumbnail
 *   extraction, sharp photo resize with original-bytes fallback.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        node:fs, node:path, node:child_process, ../../core/delays
 * MUST NOT:       never silent-fallback a missing thumbnail — throw clear errors
 *
 * DEBUG: when video configure fails on dimensions or thumb is blank, start
 *   looking here — moov parse, ffmpeg availability, sharp availability
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function readBoxes(buffer, start, end, visit) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buffer.readUInt32BE(pos);
    const type = buffer.slice(pos + 4, pos + 8).toString('ascii');
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) {
        return;
      }
      size = Number(buffer.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) {
      return;
    }
    visit(type, pos + header, pos + size);
    pos += size;
  }
}

function parseMvhd(buffer, start, end) {
  if (end - start < 1) {
    return null;
  }
  const version = buffer[start];
  let timescale;
  let duration;
  if (version === 0) {
    if (end - start < 20) {
      return null;
    }
    timescale = buffer.readUInt32BE(start + 12);
    duration = buffer.readUInt32BE(start + 16);
  } else if (version === 1) {
    if (end - start < 32) {
      return null;
    }
    timescale = buffer.readUInt32BE(start + 20);
    duration = Number(buffer.readBigUInt64BE(start + 24));
  } else {
    return null;
  }
  if (!timescale) {
    return null;
  }
  return duration / timescale;
}

function parseTkhd(buffer, start, end) {
  if (end - start < 1) {
    return [null, null];
  }
  const version = buffer[start];
  const offset = version === 0 ? 76 : version === 1 ? 88 : null;
  if (offset === null || end - start < offset + 8) {
    return [null, null];
  }
  const width = Math.round(buffer.readUInt32BE(start + offset) / 65536);
  const height = Math.round(buffer.readUInt32BE(start + offset + 4) / 65536);
  if (width <= 0 || height <= 0) {
    return [null, null];
  }
  return [width, height];
}

function findMoovPayload(fd, fileSize) {
  let pos = 0;
  const header = Buffer.alloc(16);
  while (pos + 8 <= fileSize) {
    fs.readSync(fd, header, 0, 8, pos);
    let size = header.readUInt32BE(0);
    const type = header.slice(4, 8).toString('ascii');
    let headerSize = 8;
    if (size === 1) {
      fs.readSync(fd, header, 0, 16, pos);
      size = Number(header.readBigUInt64BE(8));
      headerSize = 16;
    } else if (size === 0) {
      size = fileSize - pos;
    }
    if (size < headerSize || pos + size > fileSize) {
      throw new Error('@alaminnna/ica-unofficial: invalid MP4 box size while scanning for moov');
    }
    if (type === 'moov') {
      const payload = Buffer.alloc(size - headerSize);
      fs.readSync(fd, payload, 0, payload.length, pos + headerSize);
      return payload;
    }
    pos += size;
  }
  throw new Error("@alaminnna/ica-unofficial: MP4 metadata box 'moov' was not found");
}

// Pure-JS MP4 probe (port of read_video_metadata). Returns { width, height, duration }.
function readMp4Metadata(filePath) {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  try {
    const moov = findMoovPayload(fd, stat.size);
    let movieDuration = null;
    const tracks = [];
    readBoxes(moov, 0, moov.length, (type, start, end) => {
      if (type === 'mvhd') {
        movieDuration = parseMvhd(moov, start, end);
      } else if (type === 'trak') {
        const track = { width: null, height: null, duration: null, handler: null };
        readBoxes(moov, start, end, (inner, s, e) => {
          if (inner === 'tkhd') {
            const dims = parseTkhd(moov, s, e);
            track.width = dims[0];
            track.height = dims[1];
          } else if (inner === 'mdia') {
            readBoxes(moov, s, e, (leaf, ls, le) => {
              if (leaf === 'mdhd') {
                track.duration = parseMvhd(moov, ls, le);
              } else if (leaf === 'hdlr' && le - ls >= 12) {
                track.handler = moov.slice(ls + 8, ls + 12).toString('ascii');
              }
            });
          }
        });
        tracks.push(track);
      }
    });
    const video = tracks.find((t) => t.handler === 'vide' && t.width && t.height) ||
      tracks.find((t) => t.width && t.height);
    if (!video) {
      throw new Error('@alaminnna/ica-unofficial: MP4 video track dimensions were not found');
    }
    const duration = movieDuration !== null && movieDuration !== undefined ? movieDuration : video.duration;
    if (duration === null || duration === undefined) {
      throw new Error('@alaminnna/ica-unofficial: MP4 video duration was not found');
    }
    return { width: video.width, height: video.height, duration: Number(duration) };
  } finally {
    fs.closeSync(fd);
  }
}

function readJpegSize(buffer) {
  let pos = 2;
  while (pos + 4 < buffer.length) {
    if (buffer[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = buffer[pos + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      pos += 2;
      continue;
    }
    const length = buffer.readUInt16BE(pos + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buffer.readUInt16BE(pos + 7), height: buffer.readUInt16BE(pos + 5) };
    }
    pos += 2 + length;
  }
  return null;
}

function readPngSize(buffer) {
  if (buffer.length < 24) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readWebpSize(buffer) {
  if (buffer.length < 30) {
    return null;
  }
  const chunk = buffer.slice(12, 16).toString('ascii');
  if (chunk === 'VP8 ') {
    const bits = buffer.readUInt16BE(26);
    return { width: bits & 0x3fff, height: (buffer.readUInt16BE(26 + 2) || 0) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    if (b0 !== 0x2f) {
      return null;
    }
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height };
  }
  return null;
}

// Best-effort image dimensions from magic bytes. Returns { width, height } or nulls.
function imageSize(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(64);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.slice(0, read);
    if (head[0] === 0xff && head[1] === 0xd8) {
      const full = fs.readFileSync(filePath);
      return readJpegSize(full) || { width: null, height: null };
    }
    if (head[0] === 0x89 && head[1] === 0x50) {
      return readPngSize(head) || { width: null, height: null };
    }
    if (head.slice(0, 4).toString('ascii') === 'RIFF') {
      const full = fs.readFileSync(filePath);
      return readWebpSize(full) || { width: null, height: null };
    }
    return { width: null, height: null };
  } finally {
    fs.closeSync(fd);
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Explicit thumbnailPath wins; else ffmpeg mid-frame extract; else clear error (no silent fallback).
async function ensureVideoThumbnail(options) {
  const opts = options || {};
  if (opts.thumbnailPath) {
    if (!fs.existsSync(opts.thumbnailPath)) {
      throw new Error('@alaminnna/ica-unofficial: thumbnail file not found: ' + opts.thumbnailPath);
    }
    return path.resolve(opts.thumbnailPath);
  }
  const out = opts.outPath || String(opts.videoPath) + '.jpg';
  const at = Math.max(0, (Number(opts.duration) || 1) / 2);
  try {
    await runFfmpeg(['-y', '-ss', String(at), '-i', String(opts.videoPath), '-frames:v', '1', out]);
  } catch (err) {
    throw new Error(
      '@alaminnna/ica-unofficial: could not generate video thumbnail (ffmpeg missing or failed). ' +
      'Pass thumbnailPath explicitly. Detail: ' + ((err && err.message) || err)
    );
  }
  if (opts.crop && typeof opts.crop === 'function') {
    opts.crop(out);
  }
  return out;
}

// Resize photo to maxSide via sharp (user-approved dep). Falls back to original bytes
// with header dimensions when sharp is unavailable — never silent-fails.
async function preparePhoto(options) {
  const opts = options || {};
  const maxSide = opts.maxSide || 1080;
  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    const size = imageSize(opts.src);
    return { buffer: fs.readFileSync(opts.src), width: size.width, height: size.height, resized: false };
  }
  const image = sharp(String(opts.src)).rotate();
  const meta = await image.metadata();
  const longest = Math.max(meta.width || 0, meta.height || 0);
  if (longest > maxSide) {
    image.resize({ width: meta.width >= meta.height ? maxSide : undefined, height: meta.height > meta.width ? maxSide : undefined, fit: 'inside' });
  }
  const buffer = await image.jpeg({ quality: opts.quality || 80, mozjpeg: true }).toBuffer();
  const info = await sharp(buffer).metadata();
  if (opts.dest) {
    fs.writeFileSync(opts.dest, buffer);
  }
  return { buffer, width: info.width, height: info.height, resized: true };
}

module.exports = {
  readMp4Metadata,
  imageSize,
  ensureVideoThumbnail,
  preparePhoto,
};