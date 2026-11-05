/**
 * @alaminnna/ica-unofficial — media/notes
 *
 * RESPONSIBILITY: post-attached media notes only — create/delete.
 *   DIFFERENT from Direct inbox Notes (src/user/notes.js).
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        client.api
 * MUST NOT:       never touch inbox notes here
 *
 * DEBUG: when note create fails, start looking here — audience/style ints
 *   or media_id form (needs full pk_userid)
 */

'use strict';

async function createMediaNote(client, options) {
  const opts = options || {};
  if (!opts.mediaId) {
    throw new Error('@alaminnna/ica-unofficial: createMediaNote needs { mediaId }');
  }
  const data = {
    inventory_source: 'recommended_clips_chaining_model',
    media_client_position: '0',
    media_id: String(opts.mediaId),
    note_style: String(opts.noteStyle !== undefined && opts.noteStyle !== null ? opts.noteStyle : 13),
    carousel_index: '-1',
    text: opts.text || '',
    _uuid: client.uuid,
    audience: String(opts.audience !== undefined && opts.audience !== null ? opts.audience : 7),
    event_source: 'ufi',
    container_module: 'clips_viewer_clips_tab',
    ...(opts.extraData || {}),
  };
  const res = await client.api.request({ endpoint: 'media/create_note/v2/', data, withSignature: false });
  return res;
}

async function deleteMediaNote(client, noteId, extraData) {
  if (!noteId) {
    throw new Error('@alaminnna/ica-unofficial: deleteMediaNote needs { noteId }');
  }
  const res = await client.api.request({
    endpoint: 'media/delete_note/',
    data: {
      inventory_source: 'recommended_clips_chaining_model',
      carousel_index: '-1',
      _uuid: client.uuid,
      event_source: 'ufi',
      container_module: 'clips_viewer_clips_tab',
      note_id: String(noteId),
      ...(extraData || {}),
    },
    withSignature: false,
  });
  return res && res.status === 'ok';
}

module.exports = {
  createMediaNote,
  deleteMediaNote,
};