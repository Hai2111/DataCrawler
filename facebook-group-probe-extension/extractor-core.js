(function exposeExtractorCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FacebookExtractorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TRUSTED_IDENTITY_SOURCES = new Set(['direct-post-link', 'story-fbid', 'media-set']);

  function cleanText(value) {
    return String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  }

  function canonicalPostIdentity(value, fallbackGroupKey = null) {
    try {
      const url = new URL(String(value || ''), 'https://www.facebook.com');
      if (!/(^|\.)facebook\.com$/i.test(url.hostname)) {
        return { post_id: null, group_key: fallbackGroupKey, post_url: null, source: 'missing', confidence: 0 };
      }
      const direct = url.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)/i);
      if (direct) {
        return {
          post_id: direct[2], group_key: direct[1],
          post_url: `https://www.facebook.com/groups/${direct[1]}/posts/${direct[2]}/`,
          source: 'direct-post-link', confidence: 1
        };
      }
      const storyId = url.searchParams.get('story_fbid');
      const storyGroup = fallbackGroupKey || url.searchParams.get('id');
      if (/^\d+$/.test(storyId || '') && storyGroup) {
        return {
          post_id: storyId, group_key: storyGroup,
          post_url: `https://www.facebook.com/groups/${storyGroup}/posts/${storyId}/`,
          source: 'story-fbid', confidence: 0.95
        };
      }
      const mediaSet = (url.searchParams.get('set') || '').match(/^(?:pcb|gm)\.(\d+)$/i);
      if (mediaSet && fallbackGroupKey) {
        return {
          post_id: mediaSet[1], group_key: fallbackGroupKey,
          post_url: `https://www.facebook.com/groups/${fallbackGroupKey}/posts/${mediaSet[1]}/`,
          source: 'media-set', confidence: 0.85
        };
      }
    } catch {
      // Invalid URLs are intentionally returned as missing identities.
    }
    return { post_id: null, group_key: fallbackGroupKey, post_url: null, source: 'missing', confidence: 0 };
  }

  function parseVietnameseAbsoluteDate(value) {
    const original = cleanText(value);
    const normalized = original.normalize('NFC');
    const patterns = [
      /(?:thứ\s+\S+,\s*)?(\d{1,2})\s+tháng\s+(\d{1,2}),?\s+(\d{4})\s+lúc\s+(\d{1,2}):(\d{2})/iu,
      /(?:thứ\s+\S+,\s*)?(\d{1,2})\s+tháng\s+(\d{1,2}),?\s+(\d{4})/iu,
      /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(?:lúc\s+)?(\d{1,2}):(\d{2}))?/iu
    ];
    let match = null;
    let patternIndex = -1;
    for (let index = 0; index < patterns.length; index += 1) {
      match = normalized.match(patterns[index]);
      if (match) { patternIndex = index; break; }
    }
    if (!match) return { original_text: original || null, iso: null, confidence: 0, source: 'unparsed' };
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const valid = year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59;
    const check = new Date(Date.UTC(year, month - 1, day));
    if (!valid || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      return { original_text: original, iso: null, confidence: 0, source: 'invalid-absolute-date' };
    }
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`;
    return {
      original_text: original,
      iso,
      confidence: patternIndex === 0 ? 0.99 : 0.96,
      source: 'absolute-vietnamese-date'
    };
  }

  function parseVietnameseNumber(value) {
    const text = cleanText(value).toLowerCase();
    const match = text.match(/([\d.,]+)\s*(k|m|n|tr|nghìn|ngàn|triệu)?/iu);
    if (!match) return null;
    const suffix = match[2] || '';
    let numberText = match[1];
    let numeric;
    if (suffix) {
      const lastComma = numberText.lastIndexOf(',');
      const lastDot = numberText.lastIndexOf('.');
      const decimalIndex = Math.max(lastComma, lastDot);
      if (decimalIndex >= 0) {
        numberText = `${numberText.slice(0, decimalIndex).replace(/[.,]/g, '')}.${numberText.slice(decimalIndex + 1)}`;
      }
      numeric = Number.parseFloat(numberText);
    } else if (/^\d{1,3}([.,]\d{3})+$/.test(numberText)) {
      numeric = Number(numberText.replace(/[.,]/g, ''));
    } else {
      numeric = Number.parseFloat(numberText.replace(',', '.'));
    }
    if (!Number.isFinite(numeric)) return null;
    if (/^(k|n|nghìn|ngàn)$/u.test(suffix)) numeric *= 1000;
    if (/^(m|tr|triệu)$/u.test(suffix)) numeric *= 1000000;
    return Math.round(numeric);
  }

  function validatePost(post) {
    const bodyText = cleanText(post?.body?.text ?? post?.text);
    const originalBody = post?.body?.is_original === true && post?.body?.source === 'top-level-message';
    const canonicalId = /^\d+$/.test(String(post?.post_id || ''));
    const canonicalUrl = /^https:\/\/www\.facebook\.com\/groups\/[^/]+\/posts\/\d+\/$/.test(String(post?.post_url || ''));
    const urlId = canonicalUrl ? String(post.post_url).match(/\/posts\/(\d+)\/$/)?.[1] : null;
    const identityMismatch = canonicalId && canonicalUrl && urlId !== String(post.post_id);
    const source = post?.provenance?.identity_source || post?.extraction?.permalink_source || 'missing';
    const verifiedContainer = post?.provenance?.verified_top_level_container === true;
    const trustworthy = verifiedContainer && TRUSTED_IDENTITY_SOURCES.has(source) && (post?.provenance?.identity_confidence ?? 0) >= 0.8;
    const reasons = [];
    if (!verifiedContainer) reasons.push('unverified_top_level_container');
    if (!originalBody) reasons.push('missing_original_post_body');
    if (!bodyText) reasons.push('empty_post_body');
    if (!canonicalId) reasons.push('missing_canonical_post_id');
    if (!canonicalUrl) reasons.push('missing_canonical_post_url');
    if (!trustworthy || post?.provenance?.identity_evidence_scope === 'nested-comment-permalink') reasons.push('untrustworthy_provenance');
    if (identityMismatch) reasons.push('identity_url_mismatch');
    let status = 'VALID';
    if (identityMismatch || !verifiedContainer || post?.body?.source === 'comment' || post?.body?.substituted_from_comment) status = 'INVALID';
    else if (reasons.length) status = 'PARTIAL';
    return {
      status,
      is_valid: status === 'VALID',
      reasons,
      required: {
        original_post_body: originalBody && Boolean(bodyText),
        canonical_post_id: canonicalId,
        canonical_post_url: canonicalUrl,
        trustworthy_provenance: trustworthy
      }
    };
  }

  function selectOriginalPostBody(candidates = []) {
    const accepted = candidates
      .filter((candidate) => candidate?.scope === 'top-level')
      .filter((candidate) => candidate?.source === 'message')
      .filter((candidate) => candidate?.inside_comment !== true && candidate?.inside_shared_post !== true)
      .map((candidate) => ({ ...candidate, text: cleanText(candidate.text) }))
      .filter((candidate) => candidate.text.length > 0)
      .sort((left, right) => right.text.length - left.text.length);
    const best = accepted[0];
    return best
      ? { text: best.text, source: 'top-level-message', is_original: true, substituted_from_comment: false }
      : { text: null, source: 'missing', is_original: false, substituted_from_comment: false };
  }

  function canClassifyDemand(post) {
    return validatePost(post).is_valid;
  }

  function canMergePostObservations(left, right) {
    if (!left || !right || validatePost(left).status === 'INVALID' || validatePost(right).status === 'INVALID') return false;
    if (!/^\d+$/.test(String(left.post_id || '')) || String(left.post_id) !== String(right.post_id || '')) return false;
    if (!left.post_url || left.post_url !== right.post_url) return false;
    for (const post of [left, right]) {
      const p = post.provenance || {};
      if (!p.verified_top_level_container || !TRUSTED_IDENTITY_SOURCES.has(p.identity_source) ||
          !(p.identity_confidence >= 0.8) || p.identity_evidence_scope === 'nested-comment-permalink') return false;
    }
    return true;
  }

  function observationQuality(post) {
    if (!post) return 0;
    let score = 0;
    if (post.body?.is_original && cleanText(post.body.text)) score += 4;
    if (/^\d+$/.test(String(post.post_id || ''))) score += 3;
    if (post.post_url) score += 2;
    if (post.posted_at_iso) score += 2;
    else if (post.posted_at_text) score += 0.5;
    if (post.provenance?.verified_top_level_container) score += 2;
    if (post.author_name) score += 0.5;
    if (post.media?.length) score += 0.5;
    return score;
  }

  return {
    TRUSTED_IDENTITY_SOURCES,
    cleanText,
    canonicalPostIdentity,
    parseVietnameseAbsoluteDate,
    parseVietnameseNumber,
    selectOriginalPostBody,
    validatePost,
    canClassifyDemand,
    canMergePostObservations,
    observationQuality
  };
});
