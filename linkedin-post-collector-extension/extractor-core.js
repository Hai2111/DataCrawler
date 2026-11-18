(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LinkedInExtractorCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  function activityId(value) {
    const text = String(value || '');
    const match = text.match(/urn:li:(?:activity|ugcPost|share):(\d{8,})/i)
      || text.match(/activity[-_:](\d{8,})/i)
      || text.match(/[?&](?:activityId|updateEntityUrn)=(?:urn%3Ali%3Aactivity%3A)?(\d{8,})/i);
    return match?.[1] || null;
  }

  function canonicalIdentity(values) {
    for (const value of Array.isArray(values) ? values : [values]) {
      const id = activityId(value);
      if (!id) continue;
      return {
        activity_id: id,
        post_url: `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`,
        source: String(value).includes('data-urn') ? 'container-urn' : 'activity-reference',
        confidence: 1
      };
    }
    return { activity_id: null, post_url: null, source: 'missing', confidence: 0 };
  }

  function parseCompactNumber(value) {
    let text = cleanText(value).toLowerCase().replace(/\s/g, '');
    const match = text.match(/(\d+(?:[.,]\d+)?)\s*(k|m|nghìn|triệu)?/i);
    if (!match) return null;
    const suffix = match[2] || '';
    if (suffix) {
      const number = Number.parseFloat(match[1].replace(',', '.'));
      if (!Number.isFinite(number)) return null;
      return Math.round(number * (/^(m|triệu)$/i.test(suffix) ? 1_000_000 : 1_000));
    }
    text = match[1];
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(text)) return Number.parseInt(text.replace(/[.,]/g, ''), 10);
    const number = Number.parseFloat(text.replace(',', '.'));
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  function parseTimestamp(text, datetime) {
    const original = cleanText(datetime || text);
    if (datetime) {
      const date = new Date(datetime);
      if (!Number.isNaN(date.getTime())) {
        return { text: cleanText(text) || original, iso: date.toISOString(), confidence: 1, source: 'time-datetime' };
      }
    }
    const absolute = original.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[, ]+(\d{1,2}):(\d{2}))?$/);
    if (absolute) {
      const [, day, month, year, hour = '00', minute = '00'] = absolute;
      const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00+07:00`;
      return { text: original, iso, confidence: 0.9, source: 'absolute-visible-text' };
    }
    return { text: original || null, iso: null, confidence: original ? 0.35 : 0, source: original ? 'relative-visible-text' : 'missing' };
  }

  function validatePost(post) {
    const reasons = [];
    if (!post?.body?.is_original || !cleanText(post.body.text)) reasons.push('missing_original_body');
    if (!/^\d{8,}$/.test(String(post?.activity_id || ''))) reasons.push('missing_canonical_activity_id');
    if (!post?.post_url || !/\/feed\/update\/urn:li:activity:\d+\/?$/i.test(post.post_url)) reasons.push('missing_canonical_post_url');
    if (!post?.provenance?.verified_top_level_container) reasons.push('unverified_top_level_container');
    const status = reasons.length === 0 ? 'VALID' : reasons.length >= 3 ? 'INVALID' : 'PARTIAL';
    return { status, is_valid: status === 'VALID', reasons };
  }

  function canMerge(left, right) {
    if (!left || !right) return false;
    if (left.activity_id && right.activity_id) return left.activity_id === right.activity_id;
    if (left.correlation_key && right.correlation_key) return left.correlation_key === right.correlation_key;
    return Boolean(left.content_fingerprint && right.content_fingerprint
      && left.body?.is_original && right.body?.is_original
      && left.content_fingerprint === right.content_fingerprint);
  }

  function quality(post) {
    return (post?.body?.is_original && cleanText(post.body.text) ? 4 : 0)
      + (post?.activity_id ? 3 : 0)
      + (post?.post_url ? 2 : 0)
      + (post?.posted_at_iso ? 2 : post?.posted_at_text ? 0.5 : 0)
      + (post?.provenance?.verified_top_level_container ? 2 : 0)
      + (post?.author_name ? 0.5 : 0);
  }

  return { cleanText, activityId, canonicalIdentity, parseCompactNumber, parseTimestamp, validatePost, canMerge, quality };
});
