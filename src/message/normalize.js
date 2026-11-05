/**
 * @alaminnna/ica-unofficial — message/normalize
 * 
 * RESPONSIBILITY: ALL inbound item → event normalization lives here and only here.
 * AUTHOR:         Al A Min (Alaminnna) — https://alaminnna.ami.bd
 * MAY USE:        nothing — must stay dependency-free
 * MUST NOT:       never import client/api here
 * 
 * DEBUG: when event fields are missing/wrong or ghost events fire, start looking here — bad shape mapping
 */

'use strict';

function first(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}

function xmaItem(xma, type) {
  if (!xma || !xma.target_url) {
    return null;
  }
  return {
    type,
    mediaId: xma.preview_media_fbid || null,
    url: xma.target_url,
    userId: null,
    title: xma.title_text || '',
    thumbnailUrl: xma.preview_url || null,
  };
}

function extractSharedItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  if (item.media_share && typeof item.media_share === 'object') {
    const ms = item.media_share;
    const code = ms.code || ms.shortcode || null;
    return {
      type: 'media',
      mediaId: ms.id ? String(ms.id) : null,
      url: code ? 'https://www.instagram.com/p/' + code + '/' : null,
      userId: ms.user && (ms.user.pk || ms.user.id) ? String(ms.user.pk || ms.user.id) : null,
      title: ((ms.caption || {}).text) || '',
      thumbnailUrl: null,
    };
  }
  const clip = first(item.xma_clip);
  if (clip) {
    const out = xmaItem(clip, 'clip');
    if (out) {
      return out;
    }
  }
  const xmaShare = first(item.xma_media_share);
  if (xmaShare) {
    const out = xmaItem(xmaShare, 'media');
    if (out) {
      return out;
    }
  }
  if (item.xma_story_share && typeof item.xma_story_share === 'object') {
    const out = xmaItem(item.xma_story_share, 'story');
    if (out) {
      return out;
    }
  }
  if (item.xma_profile && typeof item.xma_profile === 'object') {
    const profile = item.xma_profile;
    return {
      type: 'profile',
      mediaId: null,
      url: profile.target_url || null,
      userId: profile.target_user_id || profile.profile_id || null,
      title: profile.title_text || '',
      thumbnailUrl: profile.preview_url || null,
    };
  }
  if (item.story_share && typeof item.story_share === 'object') {
    return {
      type: 'story',
      mediaId: item.story_share.media_id ? String(item.story_share.media_id) : null,
      url: null,
      userId: null,
      title: '',
      thumbnailUrl: item.story_share.thumbnail_url || null,
    };
  }
  if (item.reel_share && typeof item.reel_share === 'object') {
    return {
      type: 'media',
      mediaId: item.reel_share.media_id ? String(item.reel_share.media_id) : null,
      url: null,
      userId: item.reel_share.user ? String(item.reel_share.user.pk || item.reel_share.user.id || '') || null : null,
      title: '',
      thumbnailUrl: item.reel_share.thumbnail_url || null,
    };
  }
  const generic = first(item.generic_xma);
  if (generic) {
    const out = xmaItem(generic, 'media');
    if (out) {
      return out;
    }
  }
  if (item.clip && typeof item.clip === 'object') {
    const code = item.clip.code || item.clip.shortcode || null;
    return {
      type: 'clip',
      mediaId: item.clip.id ? String(item.clip.id) : null,
      url: code ? 'https://www.instagram.com/reel/' + code + '/' : null,
      userId: item.clip.user ? String(item.clip.user.pk || item.clip.user.id || '') || null : null,
      title: ((item.clip.caption || {}).text) || '',
      thumbnailUrl: null,
    };
  }
  return null;
}

function bestImageUrl(imageVersions) {
  const candidates = ((imageVersions || {}).candidates) || [];
  if (candidates.length === 0) {
    return null;
  }
  let best = candidates[0];
  let bestArea = -1;
  candidates.forEach((candidate) => {
    const area = (candidate.height || 0) * (candidate.width || 0);
    if (area > bestArea) {
      bestArea = area;
      best = candidate;
    }
  });
  return best.url || null;
}

function bestVideoUrl(videoVersions) {
  const versions = videoVersions || [];
  if (versions.length === 0) {
    return null;
  }
  let best = versions[0];
  let bestArea = -1;
  versions.forEach((version) => {
    const area = (version.height || 0) * (version.width || 0);
    if (area > bestArea) {
      bestArea = area;
      best = version;
    }
  });
  return best.url || null;
}

function mediaOwnerId(media) {
  if (media && media.user && (media.user.pk || media.user.id)) {
    return String(media.user.pk || media.user.id);
  }
  return null;
}

function captionOf(media) {
  if (!media) {
    return null;
  }
  if (typeof media.caption === 'string') {
    return media.caption;
  }
  if (media.caption && typeof media.caption.text === 'string') {
    return media.caption.text;
  }
  return null;
}

function extractAttachments(item) {
  if (!item || typeof item !== 'object') {
    return [];
  }
  if (item.item_type === 'raven_media' && item.visual_media && item.visual_media.media) {
    const media = item.visual_media.media;
    const isVideo = media.media_type === 2;
    const url = isVideo ? bestVideoUrl(media.video_versions) : bestImageUrl(media.image_versions2);
    return [{
      type: 'disappearing',
      mediaId: media.id ? String(media.id) : null,
      url,
      thumbnailUrl: bestImageUrl(media.image_versions2),
      caption: null,
      mediaOwnerUserId: mediaOwnerId(media),
      disappearing: true,
      expiryNote: url ? null : 'URL expires / view-once',
    }];
  }
  if (item.item_type === 'media' && item.media && typeof item.media === 'object') {
    const media = item.media;
    const isVideo = media.media_type === 2;
    return [{
      type: isVideo ? 'video' : 'photo',
      mediaId: media.id ? String(media.id) : null,
      url: isVideo ? bestVideoUrl(media.video_versions) : bestImageUrl(media.image_versions2),
      thumbnailUrl: bestImageUrl(media.image_versions2),
      caption: captionOf(media),
      mediaOwnerUserId: mediaOwnerId(media),
      disappearing: false,
      expiryNote: null,
    }];
  }
  if (item.voice_media && item.voice_media.media) {
    const media = item.voice_media.media;
    return [{
      type: 'voice',
      mediaId: media.id ? String(media.id) : null,
      url: bestVideoUrl(media.video_versions) || bestImageUrl(media.image_versions2),
      thumbnailUrl: null,
      caption: null,
      mediaOwnerUserId: mediaOwnerId(media),
      disappearing: false,
      expiryNote: null,
    }];
  }
  const shared = extractSharedItem(item);
  if (shared) {
    const typeMap = { media: 'media_share', story: 'story_share', profile: 'profile', clip: 'reel' };
    return [{
      type: typeMap[shared.type] || shared.type,
      mediaId: shared.mediaId,
      url: shared.url,
      thumbnailUrl: shared.thumbnailUrl,
      caption: shared.title || null,
      mediaOwnerUserId: shared.userId,
      disappearing: false,
      expiryNote: null,
    }];
  }
  return [];
}

module.exports = { extractSharedItem, extractAttachments, bestImageUrl, bestVideoUrl };