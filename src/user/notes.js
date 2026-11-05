/**
 * @alaminnna/ica-unofficial — user/notes
 * 
 * RESPONSIBILITY: notes (audience enum, create/delete/list).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api
 * MUST NOT:       never use GraphQL transport here (unported)
 * 
 * DEBUG: when notes calls throw transport errors, start looking here — audience mapping
 */

'use strict';

const AUDIENCES = { followers: 0, best_friends: 1 };

function audienceValue(audience) {
  if (audience === 0 || audience === 1) {
    return audience;
  }
  if (typeof audience === 'string' && AUDIENCES[audience] !== undefined) {
    return AUDIENCES[audience];
  }
  return 0;
}

function normalizeNote(raw) {
  const data = raw || {};
  const author = data.author || {};
  return {
    id: data.note_id === undefined || data.note_id === null ? (data.id === undefined || data.id === null ? null : String(data.id)) : String(data.note_id),
    text: data.text || '',
    userId: String(data.author_id || author.pk || author.id || ''),
    username: author.username || null,
    audience: data.audience === undefined ? 0 : Number(data.audience),
    createdAt: data.created_at === undefined ? null : data.created_at,
    expiresAt: data.expires_at === undefined ? null : data.expires_at,
  };
}

async function createNote(client, options) {
  const opts = options || {};
  if (!opts.text) {
    throw new Error('@alaminnna/ica-unofficial: createNote needs { text }');
  }
  const res = await client.api.request({
    endpoint: 'notes/create_note',
    data: { note_style: 0, text: String(opts.text), _uuid: client.uuid, audience: audienceValue(opts.audience) },
  });
  if ((res || {}).status !== 'ok') {
    throw new Error('@alaminnna/ica-unofficial: create note failed');
  }
  const out = { ...res };
  delete out.status;
  return normalizeNote(out);
}

async function deleteNote(client, noteId) {
  const res = await client.api.request({
    endpoint: 'notes/delete_note/',
    data: { id: noteId, _uuid: client.uuid },
  });
  return ((res || {}).status || '') === 'ok';
}

async function notesMusicBrowser(client) {
  const res = await client.api.request({
    endpoint: 'music/notes_audio_browser/',
    method: 'POST',
    data: { product: 'music_notes', _uuid: client.uuid },
  });
  if (((res || {}).status || '') !== 'ok') {
    throw new Error('@alaminnna/ica-unofficial: notes music browser failed');
  }
  return res;
}

function trackValue(track, key) {
  if (!track || typeof track !== 'object') {
    return null;
  }
  return track[key] === undefined ? null : track[key];
}

async function createMusicNote(client, options) {
  const opts = options || {};
  const track = opts.track || {};
  const audioAssetId = trackValue(track, 'audio_asset_id') || trackValue(track, 'id');
  const audioClusterId = trackValue(track, 'audio_cluster_id');
  if (!audioAssetId) {
    throw new Error('@alaminnna/ica-unofficial: createMusicNote needs track.audio_asset_id (or track.id)');
  }
  if (!audioClusterId) {
    throw new Error('@alaminnna/ica-unofficial: createMusicNote needs track.audio_cluster_id');
  }
  const { uuid4 } = require('../core/utils');
  const highlights = trackValue(track, 'highlight_start_times_in_ms') || [];
  const startTime = opts.startTime !== undefined ? opts.startTime : (highlights.length > 0 ? highlights[0] : 0);
  const browseSessionId = opts.browseSessionId || uuid4();
  let alacornSessionId = opts.alacornSessionId || trackValue(track, 'alacorn_session_id') || null;
  if (!alacornSessionId) {
    const browser = await notesMusicBrowser(client);
    alacornSessionId = browser.alacorn_session_id || null;
  }
  if (!alacornSessionId) {
    throw new Error('@alaminnna/ica-unofficial: createMusicNote needs alacorn_session_id (pass track or browse first)');
  }
  const { privateGraphqlQuery } = require('./lookup');
  const result = await privateGraphqlQuery(client, {
    friendlyName: 'CreateInboxTrayItemRequest',
    clientDocId: '3510400299951610199199089856',
    variables: {
      should_fetch_content_note_stack_video_info: false,
      request: {
        inbox_tray_item_type: 'note',
        audience: audienceValue(opts.audience),
        additional_params: {
          note_create_params: {
            text: String(opts.text || ''),
            note_style: 1,
            note_create_info: {
              music_note_create_info: {
                start_time: Number(startTime),
                is_reshare_eligible: false,
                selected_lyrics: null,
                audio_asset_id: String(audioAssetId),
                duration: Number(opts.duration === undefined ? 30000 : opts.duration),
                original_note_id: null,
                original_author_id: null,
                audio_cluster_id: String(audioClusterId),
                browse_session_id: browseSessionId,
                alacorn_session_id: alacornSessionId,
              },
            },
          },
        },
      },
    },
  });
  const data = (result && result.data) || result || {};
  const payloads = data.data || data;
  const found = Object.keys(payloads || {})
    .map((k) => payloads[k])
    .find((p) => p && p.success && ((p.inbox_tray_item || {}).note_dict || null));
  if (!found) {
    throw new Error('@alaminnna/ica-unofficial: music note create failed');
  }
  return normalizeNote(found.inbox_tray_item.note_dict);
}

async function getNotes() {
  throw new Error('@alaminnna/ica-unofficial: getNotes needs the GraphQL transport (not ported); use createNote/deleteNote, see docs/SHARES_NOTES.md');
}

module.exports = { createNote, deleteNote, getNotes, normalizeNote, audienceValue, notesMusicBrowser, createMusicNote };