(() => {
  if (globalThis.__fbRawCollectorLoaded) return;
  globalThis.__fbRawCollectorLoaded = true;

  const UI_TEXT = /^(Thích|Bình luận|Chia sẻ|Like|Comment|Share|Theo dõi|Follow|Xem thêm|See more)$/i;
  const PHONE_PATTERN = /(?:\+?84|0)(?:[ .-]?\d){8,10}/g;
  const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  let collecting = false;

  function cleanText(value) {
    return (value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  }

  function canonicalUrl(value, keepQuery = false) {
    try {
      const url = new URL(value, location.origin);
      url.hash = '';
      if (!keepQuery) {
        url.search = '';
      } else {
        const safeQuery = new URLSearchParams();
        for (const key of ['fbid', 'set', 'idorvanity', 'comment_id']) {
          if (url.searchParams.has(key)) safeQuery.set(key, url.searchParams.get(key));
        }
        url.search = safeQuery.toString();
      }
      return url.href;
    } catch {
      return null;
    }
  }

  function groupKey() {
    return location.pathname.match(/^\/groups\/([^/]+)/)?.[1] || 'unknown';
  }

  function textHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `text-${(hash >>> 0).toString(16)}`;
  }

  function normalizeForFingerprint(value) {
    return cleanText(value)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(PHONE_PATTERN, ' [phone] ')
      .replace(/\bfacebook\b|\bxem them\b|\bsee more\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
  }

  function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.startsWith('84') && digits.length >= 11 && digits.length <= 12) return `+${digits}`;
    if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 11) return `+84${digits.slice(1)}`;
    return null;
  }

  function extractContacts(value, enabled) {
    if (!enabled) return { phones: [], emails: [] };
    const phones = [...new Set((String(value || '').match(PHONE_PATTERN) || [])
      .map((raw) => ({ raw: cleanText(raw), normalized: normalizePhone(raw) }))
      .filter((item) => item.normalized)
      .map((item) => JSON.stringify(item)))]
      .map((item) => JSON.parse(item));
    const emails = [...new Set((String(value || '').match(EMAIL_PATTERN) || []).map((email) => email.toLowerCase()))];
    return { phones, emails };
  }

  function classifyDemand(value) {
    const text = cleanText(value);
    const rules = [
      { id: 'design_request', category: 'design_service', weight: 4, re: /(?:tôi|mình|em|bên\s+mình|công\s*ty\s+mình|tui)\s+(?:đang\s+)?cần\s+(?:thiết\s*kế|làm\s+mạch|gia\s*công|prototype|phát\s*triển)|tìm\s+(?:người|đơn\s*vị|team)\s+(?:làm|thiết\s*kế|gia\s*công|lập\s*trình)|cần\s+thuê|ai\s+(?:nhận|làm)\s+(?:mạch|pcb|code|firmware)/iu },
      { id: 'buy_request', category: 'purchase', weight: 3, re: /(?:tôi|mình|em|bên\s+mình|tui)\s+(?:đang\s+)?cần\s+(?:mua|tìm)|tìm\s+mua|mua\s+số\s*lượng|ai\s+có\s+(?:hàng|bán)|xin\s+(?:giá|báo\s*giá)|(?:motor|driver|arduino|module|modul|mạch|hàng)\s+giá\s+(?:sao|bao\s*nhiêu)/iu },
      { id: 'repair_request', category: 'repair_support', weight: 3, re: /(?:tôi|mình|em|bên\s+mình|tui)\s+cần\s+(?:sửa|kiểm\s*tra|hỗ\s*trợ)|(?:xin|cần)\s+tư\s*vấn|nhờ\s+(?:mọi\s*người|anh\s*em|các\s*bác)|(?:giúp|hỗ\s*trợ)\s+(?:em|mình|tôi)|(?:bị|báo|gặp)\s+lỗi|không\s+(?:chạy|hoạt\s*động|nạp|kết\s*nối|đọc|nhận|lên)/iu },
      { id: 'pricing_moq', category: 'pricing', weight: 2, re: /giá\s+bao\s*nhiêu|báo\s*giá|xin\s+giá|tối\s*thiểu\s+bao\s*nhiêu|số\s*lượng\s+tối\s*thiểu|\bmoq\b|chi\s*phí\s+(?:thiết\s*kế|làm|gia\s*công)/iu },
      { id: 'deadline_urgency', category: 'urgent_service', weight: 1, re: /cần\s+gấp|làm\s+gấp|hỏa\s*tốc|deadline/iu }
    ];
    const supply = /dịch\s*vụ|nhận\s+(?:thiết\s*kế|làm|gia\s*công|sửa|lập\s*trình)|bên\s+(?:em|mình)\s+(?:cung\s*cấp|chuyên|nhận)|chúng\s+tôi\s+(?:cung\s*cấp|nhận|hỗ\s*trợ)|chuyên\s+(?:cung\s*cấp|sửa\s*chữa|tất\s*cả)|gọi\s+ngay|liên\s+hệ\s+(?:ngay|hotline)|thanh\s*lý|pass\s+lại|giá\s+bán/iu.test(text);
    const matches = rules.filter((rule) => rule.re.test(text));
    const score = matches.reduce((sum, rule) => sum + rule.weight, 0) - (supply ? 3 : 0);
    const strongest = [...matches].sort((a, b) => b.weight - a.weight)[0];
    return {
      is_demand: score >= 2 && !supply,
      score,
      category: strongest?.category || null,
      signals: matches.map((rule) => rule.id),
      supply_language_detected: supply
    };
  }

  function smallestPostAncestor(button) {
    let node = button.parentElement;
    for (let depth = 0; node && depth < 16; depth += 1, node = node.parentElement) {
      const labels = [...node.querySelectorAll('[aria-label], button')]
        .map((item) => cleanText(item.getAttribute('aria-label') || item.textContent));
      const hasComment = labels.some((label) => /bình luận về bài viết|comment on/i.test(label));
      const hasShare = labels.some((label) => /chia sẻ bài viết|share post/i.test(label));
      const hasPermalink = node.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]');
      if (hasComment && (hasShare || hasPermalink) && node.querySelector('a[href*="/groups/"]')) return node;
    }
    return null;
  }

  function postContainers() {
    const commentButtons = [...document.querySelectorAll('[aria-label], button')]
      .filter((item) => /bình luận về bài viết|comment on/i.test(
        cleanText(item.getAttribute('aria-label') || item.textContent)
      ));
    const fromControls = commentButtons.map(smallestPostAncestor).filter(Boolean);
    const fromArticles = [...document.querySelectorAll('[role="article"]')].filter((article) => {
      const hasPermalink = article.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]');
      const labels = [...article.querySelectorAll('[aria-label], button')]
        .map((item) => cleanText(item.getAttribute('aria-label') || item.textContent));
      return hasPermalink && labels.some((label) => /bình luận về bài viết|comment on/i.test(label));
    });
    return [...new Set([...fromControls, ...fromArticles])]
      .filter((candidate, index, all) => !all.some((other, otherIndex) =>
        otherIndex !== index && candidate.contains(other) && other.contains(candidate) === false
      ));
  }

  function redact(value, names = []) {
    let text = value || '';
    for (const name of names.filter(Boolean).sort((a, b) => b.length - a.length)) {
      text = text.replaceAll(name, '[AUTHOR_REDACTED]');
    }
    return text.replace(PHONE_PATTERN, '[PHONE_REDACTED]');
  }

  function protect(value, config, names = []) {
    return config.privacy_mode === 'full' ? value : redact(value, names);
  }

  function primaryPostText(container) {
    const preferred = [...container.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')]
      .map((node) => cleanText(node.innerText || node.textContent))
      .find((value) => value.length >= 10);
    if (preferred) return { text: preferred, source: 'data-ad-preview-message' };
    const outerArticle = container.matches('[role="article"]') ? container : container.closest('[role="article"]');
    const candidates = [...container.querySelectorAll('[dir="auto"]')]
      .filter((node) => {
        const closestArticle = node.closest('[role="article"]');
        if (outerArticle && closestArticle && closestArticle !== outerArticle) return false;
        if (node.closest('form, [aria-label*="Viết bình luận"], [aria-label*="Write a comment"]')) return false;
        return true;
      })
      .map((node) => cleanText(node.textContent))
      .filter((value) => value.length >= 12 && !UI_TEXT.test(value))
      .filter((value) => !/^(\d+\s*(phút|giờ|ngày|tuần)|theo dõi|follow)$/iu.test(value));
    const unique = uniqueStrings(candidates, 30)
      .filter((value, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other.includes(value) && other.length > value.length));
    return { text: unique.join('\n'), source: unique.length ? 'filtered-dir-auto' : 'visible-context-fallback' };
  }

  function postPermalink(container) {
    const links = [...container.querySelectorAll('a[href]')];
    const direct = links.find((anchor) => /\/groups\/[^/]+\/(posts|permalink)\//.test(anchor.getAttribute('href') || ''));
    if (direct) return { url: canonicalUrl(direct.href), source: 'direct-post-link', anchor: direct };
    const story = links.find((anchor) => /[?&]story_fbid=\d+/.test(anchor.getAttribute('href') || ''));
    if (story) {
      const id = new URL(story.href, location.origin).searchParams.get('story_fbid');
      return { url: `https://www.facebook.com/groups/${groupKey()}/posts/${id}/`, source: 'story-fbid', anchor: story };
    }
    return { url: null, source: 'missing', anchor: null };
  }

  function postIdFromMedia(container) {
    for (const link of container.querySelectorAll('a[href]')) {
      const match = (link.getAttribute('href') || '').match(/[?&]set=(?:pcb|gm)\.(\d+)/);
      if (match) return match[1];
    }
    return null;
  }

  function timestampInfo(container, preferredAnchor) {
    const timeElement = container.querySelector('time[datetime], abbr[data-utime]');
    if (timeElement) {
      const iso = timeElement.getAttribute('datetime') ||
        (timeElement.getAttribute('data-utime') ? new Date(Number(timeElement.getAttribute('data-utime')) * 1000).toISOString() : null);
      return {
        text: cleanText(timeElement.textContent || timeElement.getAttribute('aria-label') || timeElement.title) || null,
        iso,
        source: 'time-element'
      };
    }
    const anchors = [preferredAnchor, ...container.querySelectorAll('a[href]')].filter(Boolean);
    const relativePattern = /\b(?:vừa xong|\d+\s*(?:phút|giờ|ngày|tuần|tháng|năm)|just now|\d+\s*(?:m|h|d|w|mo|y))\b/iu;
    const absolutePattern = /\b(?:\d{1,2}\s+tháng\s+\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2})\b/iu;
    for (const anchor of anchors) {
      const candidates = [anchor.textContent, anchor.getAttribute('aria-label'), anchor.title]
        .map(cleanText).filter(Boolean);
      const text = candidates.find((value) => relativePattern.test(value) || absolutePattern.test(value));
      if (text) {
        return { text, iso: null, source: 'time-like-anchor' };
      }
    }
    return { text: null, iso: null, source: 'missing' };
  }

  function authorInfo(container, config) {
    const allLinks = [...container.querySelectorAll('a[href]')];
    const groupUserLinks = allLinks.filter((anchor) =>
      /\/groups\/[^/]+\/user\//.test(anchor.getAttribute('href') || '')
    );
    const profileLinks = allLinks.filter((anchor) => {
      const href = anchor.getAttribute('href') || '';
      return !href.includes('/groups/') && (/^\/profile\.php\?id=/.test(href) || /^\/[\w.]+\/?(?:\?|$)/.test(href));
    });
    const candidates = groupUserLinks.length ? groupUserLinks : profileLinks;
    const anchor = candidates.find((item) => cleanText(item.textContent));
    const name = cleanText(anchor?.textContent);
    if (config.privacy_mode !== 'full') {
      return { author_name: name ? '[AUTHOR_REDACTED]' : null, author_url: null, names_for_redaction: [name] };
    }
    return { author_name: name || null, author_url: anchor ? canonicalUrl(anchor.href) : null, names_for_redaction: [] };
  }

  function parseCompactCount(label) {
    const match = cleanText(label).match(/([\d.,]+)\s*(K|M|N|TR|nghìn|triệu)?/i);
    if (!match) return null;
    let value = Number.parseFloat(match[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    const suffix = (match[2] || '').toLowerCase();
    if (/^(k|n|nghìn)$/.test(suffix)) value *= 1000;
    if (/^(m|tr|triệu)$/.test(suffix)) value *= 1000000;
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  function engagement(container) {
    const labels = [...container.querySelectorAll('[aria-label], button')]
      .map((item) => cleanText(item.getAttribute('aria-label') || item.textContent)).filter(Boolean);
    const commentLabel = labels.find((label) => /bình luận về bài viết|comment on/i.test(label));
    const shareLabel = labels.find((label) => /chia sẻ bài viết|share post/i.test(label));
    const likeControl = labels.find((label) => /bày tỏ cảm xúc thích|like this post|^(thích|like)$/i.test(label));
    const reactionLabels = labels.filter((label) => /^(Thích|Haha|Yêu thích|Love|Like|Buồn|Sad|Phẫn nộ|Angry|Wow):/i.test(label));
    const countFromLabel = (label, patterns) => {
      if (!label) return null;
      for (const pattern of patterns) {
        const match = label.match(pattern);
        if (match) return parseCompactCount(match[1]);
      }
      return null;
    };
    const commentCount = countFromLabel(commentLabel, [
      /([\d.,]+\s*(?:K|M|N|TR|nghìn|triệu)?)\s*bình luận/i,
      /([\d.,]+\s*(?:K|M)?)\s*comments?/i
    ]);
    const shareCount = countFromLabel(shareLabel, [
      /([\d.,]+\s*(?:K|M|N|TR|nghìn|triệu)?)\s*(?:lượt\s*)?chia sẻ/i,
      /([\d.,]+\s*(?:K|M)?)\s*shares?/i
    ]);
    const reactionTotal = reactionLabels.reduce((sum, label) => sum + (parseCompactCount(label) || 0), 0);
    return {
      reaction_count: reactionLabels.length ? reactionTotal : (likeControl ? 0 : null),
      comment_count: commentCount ?? (commentLabel ? 0 : null),
      share_count: shareCount ?? (shareLabel ? 0 : null),
      reaction_count_observed: reactionLabels.length > 0,
      comment_control_observed: Boolean(commentLabel),
      share_control_observed: Boolean(shareLabel),
      raw_comment_label: commentLabel || null,
      raw_share_label: shareLabel || null
    };
  }

  function uniqueStrings(values, limit = 100) {
    return [...new Set(values.filter(Boolean))].slice(0, limit);
  }

  function mediaItems(container) {
    const items = [];
    for (const link of container.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      let type = null;
      if (/\/photo\//.test(href)) type = 'photo';
      else if (/\/reel\//.test(href)) type = 'reel';
      else if (/\/videos?\//.test(href)) type = 'video';
      if (!type) continue;
      items.push({
        type,
        url: canonicalUrl(link.href, /[?&]set=/.test(href)),
        alt: cleanText(link.querySelector('img')?.alt) || null
      });
    }
    return items.filter((item, index, all) => item.url && all.findIndex((entry) => entry.url === item.url) === index).slice(0, 30);
  }

  function extractVisibleComments(container, config, names) {
    if (!config.collect_visible_comments || config.maximum_comments_per_post === 0) return [];
    const articleComments = [...container.querySelectorAll('[role="article"]')]
      .filter((article) => article !== container && !article.contains(container));
    const linkedComments = [...container.querySelectorAll('a[href*="comment_id="]')]
      .map((anchor) => anchor.closest('[role="article"]') || anchor.parentElement?.parentElement)
      .filter(Boolean);
    const comments = [...new Set([...articleComments, ...linkedComments])]
      .filter((article) => cleanText(article.innerText).length >= 2);
    return comments.slice(0, config.maximum_comments_per_post).map((article, index) => {
      const text = cleanText(article.innerText);
      const link = [...article.querySelectorAll('a[href]')].find((anchor) => /comment_id=/.test(anchor.href));
      return {
        ordinal: index + 1,
        text: protect(text, config, names),
        url: link ? canonicalUrl(link.href, true) : null
      };
    });
  }

  function rawSnapshot(container, config, names) {
    if (!config.collect_raw_snapshot) return null;
    const ariaLabels = uniqueStrings([...container.querySelectorAll('[aria-label]')]
      .map((node) => cleanText(node.getAttribute('aria-label'))), 80);
    const links = uniqueStrings([...container.querySelectorAll('a[href]')]
      .map((node) => canonicalUrl(node.href, /comment_id=|[?&]set=/.test(node.href))), 80);
    return {
      inner_text: protect(cleanText(container.innerText), config, names),
      aria_labels: ariaLabels,
      links
    };
  }

  function dataCompleteness(post) {
    const required = {
      post_id: Boolean(post.post_id && !String(post.post_id).startsWith('text-')),
      post_url: Boolean(post.post_url),
      posted_at: Boolean(post.posted_at_text || post.posted_at_iso),
      text: Boolean(cleanText(post.text).length >= 10),
      author: Boolean(post.author_name),
      engagement_controls: Boolean(post.engagement?.comment_control_observed || post.engagement?.share_control_observed)
    };
    return {
      fields: required,
      missing_fields: Object.entries(required).filter(([, present]) => !present).map(([name]) => name),
      media_count: post.media?.length || 0,
      visible_comment_count: post.visible_comments?.length || 0,
      contact_count: (post.contacts?.phones?.length || 0) + (post.contacts?.emails?.length || 0)
    };
  }

  function extractPost(container, index, config) {
    const permalink = postPermalink(container);
    const mediaId = postIdFromMedia(container);
    const postId = permalink.url?.match(/(?:posts|permalink)\/(\d+)/)?.[1] || mediaId;
    const author = authorInfo(container, config);
    const textNodes = uniqueStrings([...container.querySelectorAll('[dir="auto"]')]
      .map((node) => cleanText(node.textContent))
      .filter((value) => value && !UI_TEXT.test(value)), 200);
    const visibleContext = textNodes.join('\n');
    const primary = primaryPostText(container);
    const primaryText = primary.text || visibleContext;
    const time = timestampInfo(container, permalink.anchor);
    const demand = classifyDemand(primaryText);
    const allowContacts = config.collect_public_contacts && config.privacy_mode !== 'redacted';
    const extractedContacts = extractContacts(primaryText, allowContacts);
    const contacts = config.demand_only_contacts && !demand.is_demand
      ? { phones: [], emails: [] }
      : extractedContacts;
    const fallbackId = textHash(`${groupKey()}|${author.author_name || ''}|${primaryText}`);
    const names = author.names_for_redaction;
    const post = {
      ordinal: index + 1,
      post_id: postId || fallbackId,
      post_url: postId ? `https://www.facebook.com/groups/${groupKey()}/posts/${postId}/` : permalink.url,
      posted_at_text: time.text,
      posted_at_iso: time.iso,
      author_name: author.author_name,
      author_url: author.author_url,
      text: protect(primaryText, config, names),
      visible_context_text: protect(visibleContext, config, names),
      content_fingerprint: textHash(normalizeForFingerprint(primaryText)),
      demand,
      contacts,
      engagement: engagement(container),
      media: mediaItems(container),
      visible_comments: extractVisibleComments(container, config, names),
      has_see_more: [...container.querySelectorAll('[role="button"], button')]
        .some((button) => /^(Xem thêm|See more)$/i.test(cleanText(button.textContent))),
      raw_snapshot: rawSnapshot(container, config, names),
      extraction: {
        text_source: primary.source,
        permalink_source: permalink.source,
        timestamp_source: time.source
      }
    };
    post.data_completeness = dataCompleteness(post);
    return post;
  }

  function richerPost(existing, incoming, config = {}) {
    if (!existing) return incoming;
    const chooseText = (left, right) => (cleanText(right).length > cleanText(left).length ? right : left);
    const unionBy = (left = [], right = [], key) => {
      const seen = new Set();
      return [...left, ...right].filter((item) => {
        const value = key(item);
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
    };
    const merged = {
      ...existing,
      post_id: String(existing.post_id || '').startsWith('text-') && !String(incoming.post_id || '').startsWith('text-')
        ? incoming.post_id : existing.post_id,
      post_url: existing.post_url || incoming.post_url,
      posted_at_text: existing.posted_at_text || incoming.posted_at_text,
      posted_at_iso: existing.posted_at_iso || incoming.posted_at_iso,
      author_name: existing.author_name || incoming.author_name,
      author_url: existing.author_url || incoming.author_url,
      text: chooseText(existing.text, incoming.text),
      visible_context_text: chooseText(existing.visible_context_text, incoming.visible_context_text),
      media: unionBy(existing.media, incoming.media, (item) => item.url),
      visible_comments: unionBy(existing.visible_comments, incoming.visible_comments, (item) => item.url || item.text),
      contacts: {
        phones: unionBy(existing.contacts?.phones, incoming.contacts?.phones, (item) => item.normalized),
        emails: [...new Set([...(existing.contacts?.emails || []), ...(incoming.contacts?.emails || [])])]
      },
      engagement: {
        ...existing.engagement,
        ...incoming.engagement,
        reaction_count: Math.max(existing.engagement?.reaction_count ?? -1, incoming.engagement?.reaction_count ?? -1),
        comment_count: Math.max(existing.engagement?.comment_count ?? -1, incoming.engagement?.comment_count ?? -1),
        share_count: Math.max(existing.engagement?.share_count ?? -1, incoming.engagement?.share_count ?? -1)
      },
      raw_snapshot: (incoming.raw_snapshot?.inner_text?.length || 0) > (existing.raw_snapshot?.inner_text?.length || 0)
        ? incoming.raw_snapshot : existing.raw_snapshot,
      extraction: {
        text_source: cleanText(incoming.text).length > cleanText(existing.text).length
          ? incoming.extraction?.text_source : existing.extraction?.text_source,
        permalink_source: existing.post_url ? existing.extraction?.permalink_source : incoming.extraction?.permalink_source,
        timestamp_source: existing.posted_at_text || existing.posted_at_iso
          ? existing.extraction?.timestamp_source : incoming.extraction?.timestamp_source
      },
      ordinal: existing.ordinal
    };
    for (const field of ['reaction_count', 'comment_count', 'share_count']) {
      if (merged.engagement[field] < 0) merged.engagement[field] = null;
    }
    merged.content_fingerprint = textHash(normalizeForFingerprint(merged.text));
    merged.demand = classifyDemand(merged.text);
    if (!merged.demand.is_demand && config?.demand_only_contacts) merged.contacts = { phones: [], emails: [] };
    merged.data_completeness = dataCompleteness(merged);
    return merged;
  }

  function upsertPost(posts, incoming, config) {
    let existingKey = posts.has(incoming.post_id) ? incoming.post_id : null;
    if (!existingKey) {
      for (const [key, value] of posts.entries()) {
        if (value.content_fingerprint && value.content_fingerprint === incoming.content_fingerprint) {
          existingKey = key;
          break;
        }
      }
    }
    const merged = richerPost(existingKey ? posts.get(existingKey) : null, incoming, config);
    if (existingKey && existingKey !== merged.post_id) posts.delete(existingKey);
    posts.set(merged.post_id, merged);
  }

  async function expandSeeMore(containers) {
    let clicks = 0;
    for (const container of containers) {
      const buttons = [...container.querySelectorAll('[role="button"], button')]
        .filter((button) => /^(Xem thêm|See more)$/i.test(cleanText(button.textContent)));
      for (const button of buttons.slice(0, 3)) {
        button.click();
        clicks += 1;
      }
    }
    if (clicks) await wait(250);
  }

  function groupMetadata() {
    const main = document.querySelector('[role="main"], main') || document.body;
    const heading = [...main.querySelectorAll('h1, h2, [role="heading"]')]
      .map((node) => cleanText(node.textContent)).find(Boolean);
    const bodyText = cleanText(main.innerText).slice(0, 3000);
    const memberMatch = bodyText.match(/([\d.,]+\s*(?:K|M|N|TR|nghìn|triệu)?)\s+thành viên/i);
    return {
      group_key: groupKey(),
      group_url: `https://www.facebook.com/groups/${groupKey()}/`,
      group_title: heading || document.title.replace(/\s*\|\s*Facebook.*$/i, ''),
      visibility: /Nhóm riêng tư|Private group/i.test(bodyText) ? 'private' : (/Nhóm công khai|Public group/i.test(bodyText) ? 'public' : 'unknown'),
      member_count_text: memberMatch?.[1] || null
    };
  }

  function statusBadge(message) {
    let badge = document.getElementById('fb-research-collector-status');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'fb-research-collector-status';
      Object.assign(badge.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
        padding: '9px 12px', maxWidth: '420px', borderRadius: '8px',
        background: '#17202a', color: '#fff', font: '12px system-ui',
        boxShadow: '0 2px 10px #0005'
      });
      document.documentElement.appendChild(badge);
    }
    badge.textContent = message;
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeCandidateGroupUrl(value) {
    try {
      const url = new URL(value, location.origin);
      const match = url.pathname.match(/^\/groups\/([^/]+)/);
      const reserved = new Set(['feed', 'discover', 'search', 'joins', 'create']);
      if (url.hostname !== 'www.facebook.com' || !match || reserved.has(match[1].toLowerCase())) return null;
      return `https://www.facebook.com/groups/${match[1]}/`;
    } catch {
      return null;
    }
  }

  function visibleGroupCandidates() {
    const found = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/groups/"]')) {
      const url = normalizeCandidateGroupUrl(anchor.href);
      if (!url || found.has(url)) continue;
      const card = anchor.closest('[role="article"], [role="listitem"]') || anchor.parentElement;
      const title = cleanText(anchor.textContent) || cleanText(card?.querySelector('[role="heading"]')?.textContent);
      const cardText = cleanText(card?.innerText).slice(0, 500);
      const memberMatch = cardText.match(/([\d.,]+\s*(?:K|M|N|TR|nghìn|triệu)?)\s+(?:thành viên|members)/i);
      if (!title || title.length > 180) continue;
      found.set(url, { url, title, member_count_text: memberMatch?.[1] || null });
    }
    return [...found.values()];
  }

  async function discoverGroups(initialState) {
    const candidates = new Map();
    let noNewRounds = 0;
    let round = 0;
    const limit = initialState.config.discovery_results_per_keyword;
    while (candidates.size < limit && noNewRounds < 8 && round < 60) {
      const state = await waitWhilePaused();
      if (!state?.running || state.phase !== 'discovering') return;
      const before = candidates.size;
      for (const candidate of visibleGroupCandidates()) candidates.set(candidate.url, candidate);
      noNewRounds = candidates.size === before ? noNewRounds + 1 : 0;
      round += 1;
      statusBadge(`Tìm group: ${state.keywords[state.current_keyword_index]} — ${candidates.size} kết quả`);
      window.scrollBy({ top: Math.max(window.innerHeight * 0.9, 700), behavior: 'smooth' });
      await wait(1200 + Math.random() * 900);
    }
    statusBadge(`Tìm group: gửi ${candidates.size} kết quả`);
    await chrome.runtime.sendMessage({ action: 'submitDiscoveryResult', candidates: [...candidates.values()] });
  }

  async function currentState() {
    return (await chrome.runtime.sendMessage({ action: 'getBatchState' }))?.state || null;
  }

  async function waitWhilePaused() {
    let state = await currentState();
    while (state?.running && state.paused) {
      statusBadge(`Collector: ${groupKey()} — đang tạm dừng`);
      await wait(1200);
      state = await currentState();
    }
    return state;
  }

  async function checkpoint(posts, round, noNewRounds, recoveryCount) {
    return chrome.runtime.sendMessage({
      action: 'checkpointGroupProgress',
      progress: {
        ...groupMetadata(),
        checkpoint_at: new Date().toISOString(),
        round,
        no_new_rounds: noNewRounds,
        recovery_count: recoveryCount,
        posts: [...posts.values()]
      }
    });
  }

  async function collectCurrentGroup(initialState) {
    if (collecting) return;
    collecting = true;
    try {
      const config = initialState.config;
      const saved = initialState.partial_results?.[groupKey()];
      const posts = new Map((saved?.posts || []).map((post) => [post.post_id, post]));
      let noNewRounds = saved?.no_new_rounds || 0;
      let round = saved?.round || 0;
      let recoveryCount = saved?.recovery_count || 0;
      statusBadge(`Collector raw: ${groupKey()} — tiếp tục từ ${posts.size} bài`);

      while (posts.size < config.minimum_unique_posts_per_group) {
        const state = await waitWhilePaused();
        if (!state?.running) return;
        const before = posts.size;
        const containers = postContainers();
        if (config.click_see_more) await expandSeeMore(containers);
        containers.map((container, index) => extractPost(container, index, config))
          .forEach((post) => upsertPost(posts, post, config));
        noNewRounds = posts.size === before ? noNewRounds + 1 : 0;
        round += 1;
        statusBadge(`Collector raw: ${groupKey()} — ${posts.size}/${config.minimum_unique_posts_per_group} bài, vòng ${round}, chờ mới ${noNewRounds}/${config.saturation_rounds}`);
        if (round % config.checkpoint_every_rounds === 0) await checkpoint(posts, round, noNewRounds, recoveryCount);

        if (noNewRounds >= config.saturation_rounds) {
          recoveryCount += 1;
          noNewRounds = 0;
          await checkpoint(posts, round, noNewRounds, recoveryCount);
          const joinButton = [...document.querySelectorAll('button, [role="button"]')]
            .some((button) => /^(Tham gia nhóm|Join group|Yêu cầu tham gia|Request to join)$/i.test(cleanText(button.textContent)));
          if (posts.size === 0 && joinButton && recoveryCount >= 2) {
            const result = {
              ...groupMetadata(),
              collected_at: new Date().toISOString(),
              stop_reason: 'inaccessible_group_skipped',
              rounds: round,
              recovery_count: recoveryCount,
              join_required: true,
              posts: []
            };
            statusBadge(`Collector raw: ${groupKey()} — không truy cập được, chuyển group`);
            await chrome.runtime.sendMessage({ action: 'submitGroupResult', result });
            return;
          }
          statusBadge(`Collector raw: ${groupKey()} — phục hồi lần ${recoveryCount}, vẫn tiếp tục quét`);
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
          await wait(Math.max(config.maximum_wait_ms, 3000));
          if (recoveryCount % 3 === 0) {
            await checkpoint(posts, round, noNewRounds, recoveryCount);
            location.reload();
            return;
          }
          continue;
        }

        window.scrollBy({ top: Math.max(window.innerHeight * 0.9, 680), behavior: 'smooth' });
        const delay = config.minimum_wait_ms + Math.random() * (config.maximum_wait_ms - config.minimum_wait_ms);
        await wait(delay);
      }

      await checkpoint(posts, round, noNewRounds, recoveryCount);
      const result = {
        ...groupMetadata(),
        collected_at: new Date().toISOString(),
        stop_reason: 'target_reached',
        rounds: round,
        recovery_count: recoveryCount,
        join_required: false,
        posts: [...posts.values()]
      };
      statusBadge(`Collector raw: ${groupKey()} — hoàn tất ${posts.size} bài`);
      await chrome.runtime.sendMessage({ action: 'submitGroupResult', result });
    } finally {
      collecting = false;
    }
  }

  function exportVisiblePosts(config = {
    privacy_mode: 'redacted', collect_visible_comments: true,
    maximum_comments_per_post: 10, collect_raw_snapshot: true
  }) {
    return {
      schema_version: '0.6',
      collected_at: new Date().toISOString(),
      ...groupMetadata(),
      scope: 'visible_posts_only',
      posts: postContainers().map((container, index) => extractPost(container, index, config))
    };
  }

  async function resumeIfNeeded() {
    const state = await currentState();
    if (!state?.running) return;
    if (state.phase === 'discovering') {
      if (!location.pathname.startsWith('/groups/search')) return;
      await wait(1800);
      await discoverGroups(state);
      return;
    }
    if (state.phase !== 'collecting') return;
    const expected = new URL(state.target_groups[state.current_index]).pathname.replace(/\/$/, '');
    if (location.pathname.replace(/\/$/, '') !== expected) return;
    await wait(1800);
    await collectCurrentGroup(state);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'probe') {
      const containers = postContainers();
      sendResponse({
        url: canonicalUrl(location.href),
        locale: document.documentElement.lang || null,
        primary_selector: 'ancestor of localized comment/share controls',
        article_count: containers.length,
        group: groupMetadata()
      });
      return;
    }
    if (message.action === 'exportVisiblePosts') {
      sendResponse(exportVisiblePosts(message.config));
    }
  });

  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'y')) return;
    event.preventDefault();
    chrome.runtime.sendMessage({ action: 'startUrlSession' });
  }, true);

  resumeIfNeeded().catch((error) => statusBadge(`Collector lỗi: ${error.message}`));
})();
