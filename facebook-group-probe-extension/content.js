(() => {
  if (globalThis.__fbRawCollectorLoaded) return;
  globalThis.__fbRawCollectorLoaded = true;

  const UI_TEXT = /^(Thích|Bình luận|Chia sẻ|Like|Comment|Share|Theo dõi|Follow|Xem thêm|See more)$/i;
  const PHONE_PATTERN = /(?:\+?84|0)(?:[ .-]?\d){8,10}/g;
  const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const Core = globalThis.FacebookExtractorCore;
  if (!Core) throw new Error('FacebookExtractorCore was not loaded before content.js.');
  let collecting = false;
  const reportedExtractionFailures = new Set();

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

  function isTopLevelPostNode(node, container) {
    const article = node?.closest?.('[role="article"]');
    if (!article) return true;
    const containerArticle = container.matches('[role="article"]')
      ? container
      : container.closest('[role="article"]');
    return Boolean(containerArticle && article === containerArticle);
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
    const messageNodes = [...container.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')];
    // Facebook no longer consistently emits data-ad-preview on group posts. A
    // conservative dir=auto fallback is safe only when it is outside nested
    // role=article regions (comments and most shared-post cards) and outside
    // interactive/header elements. It is still tagged as a message candidate,
    // so the core validator never substitutes a comment or visible context.
    const fallbackNodes = [...container.querySelectorAll('[dir="auto"]')]
      .filter((node) => isTopLevelPostNode(node, container))
      .filter((node) => !node.closest('a, button, form, [role="button"], [role="link"], [role="textbox"]'))
      .filter((node) => !node.querySelector('[dir="auto"]'))
      .filter((node) => {
        const text = cleanText(node.innerText || node.textContent);
        return text.length >= 2 && !UI_TEXT.test(text) && !/^(Công khai|Public)$/iu.test(text);
      });
    const candidates = [...new Set([...messageNodes, ...fallbackNodes])]
      .map((node) => {
        const closestArticle = node.closest('[role="article"]');
        return {
          text: node.innerText || node.textContent,
          source: 'message',
          scope: isTopLevelPostNode(node, container) ? 'top-level' : 'nested',
          inside_comment: Boolean(node.closest('form, [aria-label*="Viết bình luận" i], [aria-label*="Write a comment" i]')),
          inside_shared_post: Boolean(closestArticle && closestArticle !== container)
        };
      });
    return Core.selectOriginalPostBody(candidates);
  }

  function postPermalink(container) {
    const anchors = [...container.querySelectorAll('a[href]')];
    const candidates = anchors
      .filter((anchor) => isTopLevelPostNode(anchor, container))
      .map((anchor) => ({ anchor, identity: Core.canonicalPostIdentity(anchor.href, groupKey()), evidence_scope: 'top-level' }))
      .filter((item) => item.identity.post_id)
      .sort((left, right) => right.identity.confidence - left.identity.confidence);
    // Some feed cards expose the canonical parent post ID only through a
    // visible comment permalink. The comment body is never used; only the
    // /groups/<group>/posts/<post_id>/ path is used as identity evidence.
    const commentIdentityCandidates = anchors
      .filter((anchor) => !isTopLevelPostNode(anchor, container) && /[?&]comment_id=/.test(anchor.href))
      .map((anchor) => ({ anchor, identity: Core.canonicalPostIdentity(anchor.href, groupKey()), evidence_scope: 'nested-comment-permalink' }))
      .filter((item) => item.identity.post_id)
      .sort((left, right) => right.identity.confidence - left.identity.confidence);
    const best = candidates[0] || commentIdentityCandidates[0];
    return best
      ? {
          ...best.identity,
          anchor: best.anchor,
          timestamp_anchor: best.evidence_scope === 'top-level' ? best.anchor : null,
          evidence_scope: best.evidence_scope
        }
      : { ...Core.canonicalPostIdentity(null, groupKey()), anchor: null, timestamp_anchor: null, evidence_scope: 'missing' };
  }

  function timestampInfo(container, preferredAnchor) {
    const timeElement = [...container.querySelectorAll('time[datetime], abbr[data-utime]')]
      .find((node) => isTopLevelPostNode(node, container));
    if (timeElement) {
      const iso = timeElement.getAttribute('datetime') ||
        (timeElement.getAttribute('data-utime') ? new Date(Number(timeElement.getAttribute('data-utime')) * 1000).toISOString() : null);
      const text = cleanText(timeElement.textContent || timeElement.getAttribute('aria-label') || timeElement.title) || null;
      return { text, iso, source: 'time-element', confidence: iso ? 1 : 0.7 };
    }
    const anchors = [preferredAnchor, ...container.querySelectorAll('a[href]')]
      .filter(Boolean)
      .filter((anchor, index, all) => all.indexOf(anchor) === index)
      .filter((anchor) => isTopLevelPostNode(anchor, container));
    const relativePattern = /\b(?:vừa xong|\d+\s*(?:phút|giờ|ngày|tuần|tháng|năm)|just now|\d+\s*(?:m|h|d|w|mo|y))\b/iu;
    const absolutePattern = /\b(?:\d{1,2}\s+tháng\s+\d{1,2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2})\b/iu;
    for (const anchor of anchors) {
      const candidates = [anchor.textContent, anchor.getAttribute('aria-label'), anchor.title]
        .map(cleanText).filter(Boolean);
      const absolute = candidates
        .map((value) => Core.parseVietnameseAbsoluteDate(value))
        .find((parsed) => parsed.iso);
      if (absolute) {
        return {
          text: absolute.original_text,
          iso: absolute.iso,
          source: absolute.source,
          confidence: absolute.confidence
        };
      }
      const text = candidates.find((value) => relativePattern.test(value) || absolutePattern.test(value));
      if (text) {
        const parsed = Core.parseVietnameseAbsoluteDate(text);
        return {
          text,
          iso: parsed.iso,
          source: parsed.iso ? parsed.source : 'time-like-anchor',
          confidence: parsed.iso ? parsed.confidence : 0.45
        };
      }
    }
    return { text: null, iso: null, source: 'missing', confidence: 0 };
  }

  function authorInfo(container, config) {
    const allLinks = [...container.querySelectorAll('a[href]')]
      .filter((anchor) => isTopLevelPostNode(anchor, container));
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
    const correlationAuthorHash = anchor ? textHash(canonicalUrl(anchor.href, true) || anchor.getAttribute('href') || '') : null;
    if (config.privacy_mode !== 'full') {
      return {
        author_name: name ? '[AUTHOR_REDACTED]' : null,
        author_url: null,
        names_for_redaction: [name],
        correlation_author_hash: correlationAuthorHash
      };
    }
    return {
      author_name: name || null,
      author_url: anchor ? canonicalUrl(anchor.href) : null,
      names_for_redaction: [],
      correlation_author_hash: correlationAuthorHash
    };
  }

  function parseCompactCount(label) {
    return Core.parseVietnameseNumber(label);
  }

  function engagement(container) {
    const labels = [...container.querySelectorAll('[aria-label], button')]
      .filter((item) => isTopLevelPostNode(item, container))
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
      if (!isTopLevelPostNode(link, container)) continue;
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
      .filter((article) => article !== container && !article.contains(container))
      .filter((article) => {
        const hasCommentPermalink = article.querySelector('a[href*="comment_id="]');
        const labels = [...article.querySelectorAll('[aria-label], button')]
          .map((node) => cleanText(node.getAttribute('aria-label') || node.textContent));
        const hasReplyControl = labels.some((label) => /^(trả lời|reply)$/iu.test(label));
        const hasNestedPostBody = article.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
        return Boolean(hasCommentPermalink || (hasReplyControl && !hasNestedPostBody));
      });
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

  function verifiedContainerProvenance(container, identity) {
    const labels = [...container.querySelectorAll('[aria-label], button')]
      .filter((item) => isTopLevelPostNode(item, container))
      .map((item) => cleanText(item.getAttribute('aria-label') || item.textContent));
    const hasCommentControl = labels.some((label) => /bình luận về bài viết|comment on/i.test(label));
    const hasShareControl = labels.some((label) => /chia sẻ bài viết|share post/i.test(label));
    const hasPostControl = hasCommentControl && hasShareControl;
    const identityInsideContainer = Boolean(identity?.anchor && container.contains(identity.anchor));
    return {
      verified_top_level_container: Boolean(hasPostControl && identityInsideContainer),
      identity_source: identity?.source || 'missing',
      identity_confidence: identity?.confidence || 0,
      identity_evidence_scope: identity?.evidence_scope || 'missing',
      post_controls_observed: hasPostControl,
      identity_inside_container: identityInsideContainer
    };
  }

  function sanitizedDomSnapshot(container) {
    const elements = [...container.querySelectorAll('*')].slice(0, 60).map((node) => {
      const href = node.getAttribute('href');
      let hrefKind = null;
      if (href) {
        try {
          const url = new URL(href, location.origin);
          if (/\/groups\/[^/]+\/(?:posts|permalink)\//i.test(url.pathname)) hrefKind = 'group-post';
          else if (url.searchParams.has('comment_id')) hrefKind = 'comment';
          else if (/\/photo\//i.test(url.pathname)) hrefKind = 'photo';
          else if (/\/groups\/[^/]+\/user\//i.test(url.pathname)) hrefKind = 'group-user';
          else if (/^\/groups\//i.test(url.pathname)) hrefKind = 'group';
          else hrefKind = 'other-facebook-link';
        } catch { hrefKind = 'invalid-link'; }
      }
      const text = cleanText(node.childNodes.length === 1 && node.firstChild?.nodeType === Node.TEXT_NODE ? node.textContent : '');
      return {
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute('role') || null,
        href_kind: hrefKind,
        data_ad_preview: node.getAttribute('data-ad-preview') || node.getAttribute('data-ad-comet-preview') || null,
        aria_label_hash: node.getAttribute('aria-label') ? textHash(cleanText(node.getAttribute('aria-label'))) : null,
        text_hash: text ? textHash(text) : null,
        text_length: text.length
      };
    });
    return {
      container_tag: container.tagName.toLowerCase(),
      container_role: container.getAttribute('role') || null,
      descendant_count: container.querySelectorAll('*').length,
      elements
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
      validation_status: post.validation?.status || 'UNKNOWN',
      media_count: post.media?.length || 0,
      visible_comment_count: post.visible_comments?.length || 0,
      contact_count: (post.contacts?.phones?.length || 0) + (post.contacts?.emails?.length || 0)
    };
  }

  function extractPost(container, index, config) {
    const permalink = postPermalink(container);
    const postId = permalink.post_id;
    const author = authorInfo(container, config);
    const textNodes = uniqueStrings([...container.querySelectorAll('[dir="auto"]')]
      .filter((node) => isTopLevelPostNode(node, container))
      .map((node) => cleanText(node.textContent))
      .filter((value) => value && !UI_TEXT.test(value)), 200);
    const visibleContext = textNodes.join('\n');
    const primary = primaryPostText(container);
    const primaryText = primary.text;
    const time = timestampInfo(container, permalink.timestamp_anchor);
    const names = author.names_for_redaction;
    const contentFingerprint = primaryText ? textHash(normalizeForFingerprint(primaryText)) : null;
    const correlationEvidence = [
      groupKey(),
      author.correlation_author_hash || '',
      time.iso || time.text || ''
    ].join('|');
    const correlationKey = author.correlation_author_hash && (time.iso || time.text)
      ? textHash(correlationEvidence)
      : (contentFingerprint ? `body-${contentFingerprint}` : null);
    const post = {
      ordinal: index + 1,
      post_id: postId,
      post_url: permalink.post_url,
      posted_at_text: time.text,
      posted_at_iso: time.iso,
      posted_at_confidence: time.confidence,
      author_name: author.author_name,
      author_url: author.author_url,
      text: protect(primaryText || '', config, names) || null,
      body: {
        text: protect(primaryText || '', config, names) || null,
        source: primary.source,
        is_original: primary.is_original,
        substituted_from_comment: false
      },
      correlation_key: correlationKey,
      visible_context_text: protect(visibleContext, config, names),
      content_fingerprint: contentFingerprint,
      demand: { status: 'not_classified_extraction_invalid', is_demand: false, score: null, category: null, signals: [] },
      contacts: { phones: [], emails: [] },
      engagement: engagement(container),
      media: mediaItems(container),
      visible_comments: extractVisibleComments(container, config, names),
      has_see_more: [...container.querySelectorAll('[role="button"], button')]
        .filter((button) => isTopLevelPostNode(button, container))
        .some((button) => /^(Xem thêm|See more)$/i.test(cleanText(button.textContent))),
      raw_snapshot: rawSnapshot(container, config, names),
      extraction: {
        text_source: primary.source,
        permalink_source: permalink.source,
        timestamp_source: time.source,
        timestamp_confidence: time.confidence
      },
      provenance: verifiedContainerProvenance(container, permalink)
    };
    // Keep the unprotected original body in memory only so a later identity-only
    // observation can complete validation and contact extraction. Non-enumerable
    // data is never serialized into checkpoints, logs or exports.
    if (primary.is_original && primaryText) {
      Object.defineProperty(post, '_raw_original_text', {
        value: primaryText,
        enumerable: false,
        configurable: true
      });
    }
    post.observation_quality = Core.observationQuality(post);
    post.validation = Core.validatePost(post);
    if (post.validation.is_valid) {
      post.demand = classifyDemand(primaryText);
      const allowContacts = config.collect_public_contacts && config.privacy_mode !== 'redacted';
      const extractedContacts = extractContacts(primaryText, allowContacts);
      post.contacts = config.demand_only_contacts && !post.demand.is_demand
        ? { phones: [], emails: [] }
        : extractedContacts;
    } else {
      post.extraction_failure = {
        reasons: post.validation.reasons,
        diagnostics: {
          body_source: primary.source,
          identity_source: permalink.source,
          post_controls_observed: post.provenance.post_controls_observed,
          visible_comment_count: post.visible_comments.length
        },
        sanitized_dom_snapshot: sanitizedDomSnapshot(container)
      };
    }
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
    const incomingTextIsRicher = cleanText(incoming.text).length > cleanText(existing.text).length;
    const incomingTimeIsStronger = (incoming.posted_at_confidence || 0) > (existing.posted_at_confidence || 0);
    const rawOriginalText = incomingTextIsRicher
      ? (incoming._raw_original_text || existing._raw_original_text)
      : (existing._raw_original_text || incoming._raw_original_text);
    const merged = {
      ...existing,
      post_id: existing.post_id || incoming.post_id,
      post_url: existing.post_url || incoming.post_url,
      posted_at_text: incomingTimeIsStronger ? incoming.posted_at_text : (existing.posted_at_text || incoming.posted_at_text),
      posted_at_iso: incomingTimeIsStronger ? incoming.posted_at_iso : (existing.posted_at_iso || incoming.posted_at_iso),
      posted_at_confidence: Math.max(existing.posted_at_confidence || 0, incoming.posted_at_confidence || 0),
      author_name: existing.author_name || incoming.author_name,
      author_url: existing.author_url || incoming.author_url,
      text: chooseText(existing.text, incoming.text),
      correlation_key: existing.correlation_key || incoming.correlation_key,
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
        text_source: incomingTextIsRicher
          ? incoming.extraction?.text_source : existing.extraction?.text_source,
        permalink_source: existing.post_url ? existing.extraction?.permalink_source : incoming.extraction?.permalink_source,
        timestamp_source: existing.posted_at_text || existing.posted_at_iso
          ? existing.extraction?.timestamp_source : incoming.extraction?.timestamp_source
      },
      body: incomingTextIsRicher && incoming.body?.is_original
        ? incoming.body
        : (existing.body?.is_original ? existing.body : incoming.body),
      provenance: (existing.provenance?.identity_confidence || 0) >= (incoming.provenance?.identity_confidence || 0)
        ? existing.provenance : incoming.provenance,
      ordinal: existing.ordinal
    };
    if (rawOriginalText) {
      Object.defineProperty(merged, '_raw_original_text', {
        value: rawOriginalText,
        enumerable: false,
        configurable: true
      });
    }
    for (const field of ['reaction_count', 'comment_count', 'share_count']) {
      if (merged.engagement[field] < 0) merged.engagement[field] = null;
    }
    merged.content_fingerprint = merged.text ? textHash(normalizeForFingerprint(merged.text)) : null;
    merged.observation_quality = Core.observationQuality(merged);
    merged.validation = Core.validatePost(merged);
    const validatedText = rawOriginalText || merged.text;
    merged.demand = merged.validation.is_valid
      ? classifyDemand(validatedText)
      : { status: 'not_classified_extraction_invalid', is_demand: false, score: null, category: null, signals: [] };
    if (merged.validation.is_valid) {
      const allowContacts = config.collect_public_contacts && config.privacy_mode !== 'redacted';
      const extractedContacts = extractContacts(validatedText, allowContacts);
      merged.contacts = config.demand_only_contacts && !merged.demand.is_demand
        ? { phones: [], emails: [] }
        : extractedContacts;
    } else {
      merged.contacts = { phones: [], emails: [] };
    }
    merged.data_completeness = dataCompleteness(merged);
    return merged;
  }

  function upsertPost(posts, incoming, config) {
    if (!incoming.validation?.is_valid) return false;
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
    return true;
  }

  function candidateStorageKey(post) {
    if (post.post_id) return `id:${post.post_id}`;
    if (post.correlation_key) return `corr:${post.correlation_key}`;
    if (post.content_fingerprint) return `body:${post.content_fingerprint}`;
    return null;
  }

  function upsertCandidate(candidates, incoming, config, round) {
    let existingKey = null;
    for (const [key, candidate] of candidates.entries()) {
      if (Core.canMergePostObservations(candidate, incoming)) {
        existingKey = key;
        break;
      }
    }
    const existing = existingKey ? candidates.get(existingKey) : null;
    const merged = richerPost(existing, incoming, config);
    merged.observation_count = (existing?.observation_count || 0) + 1;
    merged.first_observed_round = existing?.first_observed_round ?? round;
    merged.last_observed_round = round;
    merged.validation = Core.validatePost(merged);
    merged.data_completeness = dataCompleteness(merged);
    if (merged.validation.is_valid) delete merged.extraction_failure;
    const nextKey = candidateStorageKey(merged);
    if (!nextKey) return merged;
    if (existingKey && existingKey !== nextKey) candidates.delete(existingKey);
    candidates.set(nextKey, merged);
    return merged;
  }

  function pruneCandidates(candidates, round) {
    for (const [key, candidate] of candidates.entries()) {
      if (candidate.validation?.is_valid || round - (candidate.last_observed_round || 0) > 120) candidates.delete(key);
    }
    if (candidates.size <= 250) return;
    const oldest = [...candidates.entries()]
      .sort((left, right) => (left[1].last_observed_round || 0) - (right[1].last_observed_round || 0));
    for (const [key] of oldest.slice(0, candidates.size - 250)) candidates.delete(key);
  }

  async function reportExtractionFailures(failures) {
    const fresh = failures.filter((failure) => {
      const identity = failure.post_id || failure.correlation_key || failure.content_fingerprint || 'missing';
      const signature = `${groupKey()}|${identity}|${failure.validation?.status}|${failure.validation?.reasons?.join(',')}`;
      if (reportedExtractionFailures.has(signature)) return false;
      reportedExtractionFailures.add(signature);
      return true;
    }).slice(0, 20);
    if (!fresh.length) return;
    await chrome.runtime.sendMessage({
      action: 'reportExtractionFailures',
      failures: fresh.map((post) => ({
        group_key: groupKey(),
        post_id: post.post_id,
        post_url: post.post_url,
        validation: post.validation,
        diagnostics: post.extraction_failure?.diagnostics,
        sanitized_dom_snapshot: post.extraction_failure?.sanitized_dom_snapshot
      }))
    });
  }

  async function expandSeeMore(containers) {
    let clicks = 0;
    for (const container of containers) {
      const buttons = [...container.querySelectorAll('[role="button"], button')]
        .filter((button) => isTopLevelPostNode(button, container))
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

  function checkpointCandidate(candidate) {
    return {
      ...candidate,
      visible_context_text: null,
      visible_comments: [],
      raw_snapshot: null,
      extraction_failure: candidate.extraction_failure ? {
        reasons: candidate.extraction_failure.reasons,
        diagnostics: candidate.extraction_failure.diagnostics
      } : null
    };
  }

  async function checkpoint(posts, round, noNewRounds, recoveryCount, extractionFailures = [], candidates = new Map()) {
    return chrome.runtime.sendMessage({
      action: 'checkpointGroupProgress',
      progress: {
        ...groupMetadata(),
        checkpoint_at: new Date().toISOString(),
        round,
        no_new_rounds: noNewRounds,
        recovery_count: recoveryCount,
        valid_post_count: posts.size,
        invalid_observation_count: extractionFailures.length,
        extraction_failures: extractionFailures.slice(-100),
        partial_candidate_count: candidates.size,
        partial_candidates: [...candidates.values()].map(checkpointCandidate).slice(-250),
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
      const posts = new Map((saved?.posts || [])
        .filter((post) => post.validation?.is_valid && Core.validatePost(post).is_valid)
        .map((post) => [post.post_id, post]));
      const candidates = new Map((saved?.partial_candidates || [])
        .map((post) => [candidateStorageKey(post), post])
        .filter(([key]) => key));
      const extractionFailures = [...(saved?.extraction_failures || [])].slice(-100);
      let noNewRounds = saved?.no_new_rounds || 0;
      let round = saved?.round || 0;
      let recoveryCount = saved?.recovery_count || 0;
      statusBadge(`Collector raw: ${groupKey()} — tiếp tục từ ${posts.size} bài`);

      while (posts.size < config.minimum_unique_posts_per_group) {
        const state = await waitWhilePaused();
        if (!state?.running) return;
        const beforeScore = posts.size * 100 + [...candidates.values()]
          .reduce((sum, candidate) => sum + Core.observationQuality(candidate), 0);
        const viewportObservations = [];
        for (let pass = 0; pass < config.observation_passes_per_viewport; pass += 1) {
          const containers = postContainers();
          if (config.click_see_more && pass === 0) await expandSeeMore(containers);
          if (pass > 0 || config.click_see_more) await wait(config.viewport_settle_ms);
          viewportObservations.push(...containers.map((container, index) => extractPost(container, index, config)));
        }
        const stableFailures = [];
        for (const observation of viewportObservations) {
          const candidate = upsertCandidate(candidates, observation, config, round);
          if (candidate.validation?.is_valid) {
            upsertPost(posts, candidate, config);
            for (const [key, stored] of candidates.entries()) {
              if (stored === candidate || Core.canMergePostObservations(stored, candidate)) candidates.delete(key);
            }
          } else if ((candidate.observation_count || 0) >= 2) {
            stableFailures.push(candidate);
          }
        }
        pruneCandidates(candidates, round);
        for (const failure of stableFailures) {
          const record = {
            observed_at: new Date().toISOString(),
            post_id: failure.post_id,
            post_url: failure.post_url,
            validation: failure.validation,
            diagnostics: failure.extraction_failure?.diagnostics,
            sanitized_dom_snapshot: failure.extraction_failure?.sanitized_dom_snapshot
          };
          const identity = failure.post_id || failure.correlation_key || failure.content_fingerprint || 'missing';
          const signature = `${identity}|${record.validation.status}|${record.validation.reasons.join(',')}`;
          if (!extractionFailures.some((item) => item.signature === signature)) {
            extractionFailures.push({ signature, ...record });
          }
        }
        if (extractionFailures.length > 100) extractionFailures.splice(0, extractionFailures.length - 100);
        await reportExtractionFailures(stableFailures);
        const afterScore = posts.size * 100 + [...candidates.values()]
          .reduce((sum, candidate) => sum + Core.observationQuality(candidate), 0);
        noNewRounds = afterScore <= beforeScore ? noNewRounds + 1 : 0;
        round += 1;
        statusBadge(`Collector VALID: ${groupKey()} — ${posts.size}/${config.minimum_unique_posts_per_group} bài, PARTIAL đang ghép ${candidates.size}, lỗi ổn định ${extractionFailures.length}, vòng ${round}, chờ mới ${noNewRounds}/${config.saturation_rounds}`);
        if (round % config.checkpoint_every_rounds === 0) await checkpoint(posts, round, noNewRounds, recoveryCount, extractionFailures, candidates);

        if (noNewRounds >= config.saturation_rounds) {
          recoveryCount += 1;
          noNewRounds = 0;
          await checkpoint(posts, round, noNewRounds, recoveryCount, extractionFailures, candidates);
          const joinButton = [...document.querySelectorAll('button, [role="button"]')]
            .some((button) => /^(Tham gia nhóm|Join group|Yêu cầu tham gia|Request to join)$/i.test(cleanText(button.textContent)));
          if (posts.size === 0 && joinButton && recoveryCount >= 2) {
            const result = {
              ...groupMetadata(),
              collected_at: new Date().toISOString(),
              stop_reason: 'inaccessible_group_skipped',
              rounds: round,
              recovery_count: recoveryCount,
              extraction_failures: extractionFailures,
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
            await checkpoint(posts, round, noNewRounds, recoveryCount, extractionFailures, candidates);
            location.reload();
            return;
          }
          continue;
        }

        window.scrollBy({ top: Math.max(window.innerHeight * config.viewport_scroll_ratio, 520), behavior: 'smooth' });
        const delay = config.minimum_wait_ms + Math.random() * (config.maximum_wait_ms - config.minimum_wait_ms);
        await wait(delay);
      }

      await checkpoint(posts, round, noNewRounds, recoveryCount, extractionFailures, candidates);
      const result = {
        ...groupMetadata(),
        collected_at: new Date().toISOString(),
        stop_reason: 'target_reached',
        rounds: round,
        recovery_count: recoveryCount,
        extraction_failures: extractionFailures,
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
      schema_version: '0.7.3',
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

  resumeIfNeeded().catch(async (error) => {
    statusBadge(`Collector lỗi: ${error.message}`);
    try {
      await chrome.runtime.sendMessage({
        action: 'reportCollectorError',
        stage: 'resume_or_collect',
        group_key: groupKey(),
        page_url: location.href,
        error: error.message || String(error)
      });
    } catch (reportError) {
      console.error('[Facebook Demand Collector] Could not report collector error.', reportError);
    }
  });
})();
