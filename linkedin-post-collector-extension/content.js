(() => {
  const Core = globalThis.LinkedInExtractorCore;
  if (!Core) return;
  let collecting = false;
  const reportedFailures = new Set();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function hashText(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
  }

  function sourceKey(value) { return `source-${hashText(value)}`; }
  function normalizeFingerprint(value) { return Core.cleanText(value).toLowerCase().replace(/https?:\/\/\S+/g, '[url]').replace(/\d+/g, '#'); }
  function protect(value, config, names = []) {
    let text = Core.cleanText(value);
    if (!text) return null;
    if (config.privacy_mode !== 'full') {
      for (const name of names.filter(Boolean)) text = text.replaceAll(name, '[AUTHOR_REDACTED]');
      text = text.replace(/(?:\+?84|0)(?:[ .-]?\d){8,10}/g, '[PHONE_REDACTED]');
      text = text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[EMAIL_REDACTED]');
    }
    return text;
  }

  function containers() {
    const selector = 'div.feed-shared-update-v2[data-urn], div.feed-shared-update-v2[data-id], div[data-id^="urn:li:activity:"], article[data-urn]';
    const all = [...document.querySelectorAll(selector)].filter((node) => node.offsetParent !== null);
    return all.filter((node) => !all.some((other) => other !== node && other.contains(node)));
  }

  function ownedNodes(container, selector) {
    return [...container.querySelectorAll(selector)].filter((node) => {
      const owner = node.closest('div.feed-shared-update-v2[data-urn], div.feed-shared-update-v2[data-id], div[data-id^="urn:li:activity:"], article[data-urn]');
      return !owner || owner === container;
    });
  }

  function bodyInfo(container) {
    const selectors = [
      '.update-components-text',
      '.feed-shared-update-v2__description',
      '[data-test-id="main-feed-activity-card"] .break-words',
      '.feed-shared-text'
    ];
    for (const selector of selectors) {
      const candidates = ownedNodes(container, selector)
        .map((node) => ({ node, text: Core.cleanText(node.innerText || node.textContent) }))
        .filter((item) => item.text && !item.node.closest('.comments-comment-item, .feed-shared-inline-show-more-text--is-comment'));
      const best = candidates.sort((a, b) => b.text.length - a.text.length)[0];
      if (best) return { text: best.text, source: selector, is_original: true };
    }
    return { text: null, source: 'missing', is_original: false };
  }

  function identityInfo(container) {
    const values = [
      `data-urn:${container.getAttribute('data-urn') || ''}`,
      container.getAttribute('data-id') || '',
      ...ownedNodes(container, 'a[href*="/feed/update/"], a[href*="activity-"], a[href*="activityId="]').map((anchor) => anchor.href)
    ];
    return Core.canonicalIdentity(values);
  }

  function authorInfo(container, config) {
    const anchor = ownedNodes(container, [
      '.update-components-actor__meta-link',
      '.feed-shared-actor__container-link',
      'a[href*="/in/"]',
      'a[href*="/company/"]'
    ].join(',')).find((node) => Core.cleanText(node.textContent));
    const nameNode = container.querySelector('.update-components-actor__name, .feed-shared-actor__name') || anchor;
    const name = Core.cleanText(nameNode?.textContent);
    const href = anchor?.href || null;
    return {
      author_name: config.privacy_mode === 'full' ? (name || null) : (name ? '[AUTHOR_REDACTED]' : null),
      author_url: config.privacy_mode === 'full' ? href : null,
      raw_name: name,
      correlation_author_hash: href ? hashText(href.split('?')[0]) : (name ? hashText(name) : null)
    };
  }

  function timestampInfo(container) {
    const time = ownedNodes(container, 'time')[0];
    if (time) return Core.parseTimestamp(time.textContent, time.getAttribute('datetime'));
    const candidate = ownedNodes(container, '.update-components-actor__sub-description, .feed-shared-actor__sub-description')
      .map((node) => Core.cleanText(node.textContent)).find(Boolean);
    return Core.parseTimestamp(candidate, null);
  }

  function extractContacts(text, allowed) {
    if (!allowed || !text) return { phones: [], emails: [] };
    const phones = [...new Set((text.match(/(?:\+?84|0)(?:[ .-]?\d){8,10}/g) || []).map((phone) => phone.replace(/[^\d+]/g, '').replace(/^\+84/, '0')))]
      .filter((phone) => /^0\d{9,10}$/.test(phone)).map((normalized) => ({ normalized }));
    const emails = [...new Set((text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []).map((email) => email.toLowerCase()))];
    return { phones, emails };
  }

  function classifyDemand(text) {
    const normalized = Core.cleanText(text).toLowerCase();
    const patterns = {
      design: /(?:cần|tìm|thuê|looking for|need|seeking).{0,60}(?:thiết kế|design|pcb|mạch|firmware|iot|automation|prototype)/i,
      hiring: /(?:tuyển|hiring|recruit|vacancy|job opening).{0,80}(?:engineer|kỹ sư|designer|developer|embedded|hardware|pcb)/i,
      purchase: /(?:cần mua|tìm mua|báo giá|quotation|rfq|supplier|vendor|looking for.{0,30}(?:supplier|vendor))/i,
      support: /(?:cần sửa|cần hỗ trợ|troubleshoot|repair|consultant|tư vấn)/i
    };
    const signals = Object.entries(patterns).filter(([, pattern]) => pattern.test(normalized)).map(([name]) => name);
    return { status: 'classified', is_demand: signals.length > 0, score: Math.min(1, signals.length * 0.35), category: signals[0] || null, signals };
  }

  function engagement(container) {
    const labels = ownedNodes(container, 'button[aria-label], span[aria-label]').map((node) => node.getAttribute('aria-label')).filter(Boolean);
    const find = (pattern) => {
      const label = labels.find((value) => pattern.test(value));
      return label ? Core.parseCompactNumber(label) : null;
    };
    return {
      reaction_count: find(/reaction|lượt bày tỏ|cảm xúc/i),
      comment_count: find(/comment|bình luận/i),
      repost_count: find(/repost|chia sẻ|share/i)
    };
  }

  function media(container) {
    const items = [];
    for (const image of ownedNodes(container, 'img[src]')) {
      if (/profile|ghost|emoji/i.test(image.src)) continue;
      items.push({ type: 'image', url: image.src.split('?')[0], alt: Core.cleanText(image.alt) || null });
    }
    for (const video of ownedNodes(container, 'video')) items.push({ type: 'video', url: video.currentSrc || video.src || null });
    return items.filter((item, index, all) => item.url && all.findIndex((other) => other.url === item.url) === index);
  }

  function sanitizedSnapshot(container) {
    const walk = (node, depth = 0) => {
      if (!node || depth > 4) return null;
      const result = { tag: node.tagName?.toLowerCase() || null, role: node.getAttribute?.('role') || null, classes: [...(node.classList || [])].slice(0, 5) };
      result.children = [...(node.children || [])].slice(0, 12).map((child) => walk(child, depth + 1)).filter(Boolean);
      return result;
    };
    return walk(container);
  }

  function extractPost(container, index, config) {
    const identity = identityInfo(container);
    const body = bodyInfo(container);
    const author = authorInfo(container, config);
    const time = timestampInfo(container);
    const fingerprint = body.text ? hashText(normalizeFingerprint(body.text)) : null;
    const correlationKey = author.correlation_author_hash && (time.iso || time.text)
      ? hashText(`${author.correlation_author_hash}|${time.iso || time.text}`)
      : fingerprint ? `body-${fingerprint}` : null;
    const post = {
      ordinal: index + 1,
      activity_id: identity.activity_id,
      post_url: identity.post_url,
      posted_at_text: time.text,
      posted_at_iso: time.iso,
      posted_at_confidence: time.confidence,
      author_name: author.author_name,
      author_url: author.author_url,
      text: protect(body.text, config, [author.raw_name]),
      body: { text: protect(body.text, config, [author.raw_name]), source: body.source, is_original: body.is_original, substituted_from_comment: false },
      correlation_key: correlationKey,
      content_fingerprint: fingerprint,
      engagement: engagement(container),
      media: media(container),
      demand: { status: 'not_classified_extraction_invalid', is_demand: false, score: null, category: null, signals: [] },
      contacts: { phones: [], emails: [] },
      provenance: {
        verified_top_level_container: container.matches('div.feed-shared-update-v2[data-urn], div.feed-shared-update-v2[data-id], div[data-id^="urn:li:activity:"], article[data-urn]'),
        container_selector: container.classList.contains('feed-shared-update-v2') ? 'feed-shared-update-v2' : container.tagName.toLowerCase(),
        identity_source: identity.source,
        identity_confidence: identity.confidence
      }
    };
    if (body.is_original && body.text) Object.defineProperty(post, '_raw_original_text', { value: body.text, enumerable: false, configurable: true });
    post.validation = Core.validatePost(post);
    post.observation_quality = Core.quality(post);
    if (post.validation.is_valid) {
      post.demand = classifyDemand(body.text);
      post.contacts = config.demand_only_contacts && !post.demand.is_demand
        ? { phones: [], emails: [] }
        : extractContacts(body.text, config.collect_public_contacts && config.privacy_mode !== 'redacted');
    } else {
      post.extraction_failure = {
        reasons: post.validation.reasons,
        diagnostics: { body_source: body.source, identity_source: identity.source, container_selector: post.provenance.container_selector },
        sanitized_dom_snapshot: sanitizedSnapshot(container)
      };
    }
    return post;
  }

  function union(left = [], right = [], key) {
    const values = new Map();
    for (const item of [...left, ...right]) if (key(item)) values.set(key(item), item);
    return [...values.values()];
  }

  function mergePost(existing, incoming, config) {
    if (!existing) return incoming;
    const incomingRicher = Core.cleanText(incoming.text).length > Core.cleanText(existing.text).length;
    const rawText = incomingRicher ? (incoming._raw_original_text || existing._raw_original_text) : (existing._raw_original_text || incoming._raw_original_text);
    const merged = {
      ...existing,
      activity_id: existing.activity_id || incoming.activity_id,
      post_url: existing.post_url || incoming.post_url,
      posted_at_text: (incoming.posted_at_confidence || 0) > (existing.posted_at_confidence || 0) ? incoming.posted_at_text : (existing.posted_at_text || incoming.posted_at_text),
      posted_at_iso: (incoming.posted_at_confidence || 0) > (existing.posted_at_confidence || 0) ? incoming.posted_at_iso : (existing.posted_at_iso || incoming.posted_at_iso),
      posted_at_confidence: Math.max(existing.posted_at_confidence || 0, incoming.posted_at_confidence || 0),
      author_name: existing.author_name || incoming.author_name,
      author_url: existing.author_url || incoming.author_url,
      text: incomingRicher ? incoming.text : existing.text,
      body: incomingRicher && incoming.body?.is_original ? incoming.body : (existing.body?.is_original ? existing.body : incoming.body),
      correlation_key: existing.correlation_key || incoming.correlation_key,
      media: union(existing.media, incoming.media, (item) => item.url),
      engagement: {
        reaction_count: Math.max(existing.engagement?.reaction_count ?? -1, incoming.engagement?.reaction_count ?? -1),
        comment_count: Math.max(existing.engagement?.comment_count ?? -1, incoming.engagement?.comment_count ?? -1),
        repost_count: Math.max(existing.engagement?.repost_count ?? -1, incoming.engagement?.repost_count ?? -1)
      },
      provenance: (existing.provenance?.identity_confidence || 0) >= (incoming.provenance?.identity_confidence || 0) ? existing.provenance : incoming.provenance
    };
    if (rawText) Object.defineProperty(merged, '_raw_original_text', { value: rawText, enumerable: false, configurable: true });
    for (const key of Object.keys(merged.engagement)) if (merged.engagement[key] < 0) merged.engagement[key] = null;
    merged.content_fingerprint = merged.text ? hashText(normalizeFingerprint(merged.text)) : null;
    merged.validation = Core.validatePost(merged);
    const validatedText = rawText || merged.text;
    merged.demand = merged.validation.is_valid ? classifyDemand(validatedText) : { status: 'not_classified_extraction_invalid', is_demand: false, score: null, category: null, signals: [] };
    merged.contacts = merged.validation.is_valid && (!config.demand_only_contacts || merged.demand.is_demand)
      ? extractContacts(validatedText, config.collect_public_contacts && config.privacy_mode !== 'redacted')
      : { phones: [], emails: [] };
    merged.observation_quality = Core.quality(merged);
    return merged;
  }

  function candidateKey(post) { return post.activity_id ? `id:${post.activity_id}` : post.correlation_key ? `corr:${post.correlation_key}` : post.content_fingerprint ? `body:${post.content_fingerprint}` : null; }

  function upsertCandidate(candidates, incoming, config, round) {
    const entry = [...candidates.entries()].find(([, candidate]) => Core.canMerge(candidate, incoming));
    const merged = mergePost(entry?.[1] || null, incoming, config);
    merged.observation_count = (entry?.[1]?.observation_count || 0) + 1;
    merged.first_observed_round = entry?.[1]?.first_observed_round ?? round;
    merged.last_observed_round = round;
    if (entry) candidates.delete(entry[0]);
    const key = candidateKey(merged);
    if (key) candidates.set(key, merged);
    return merged;
  }

  function checkpointCandidate(post) {
    return { ...post, extraction_failure: post.extraction_failure ? { reasons: post.extraction_failure.reasons, diagnostics: post.extraction_failure.diagnostics } : null };
  }

  function status(message) {
    let badge = document.querySelector('#linkedin-demand-collector-status');
    if (!badge) {
      badge = document.createElement('div'); badge.id = 'linkedin-demand-collector-status';
      Object.assign(badge.style, { position: 'fixed', right: '18px', bottom: '18px', zIndex: 2147483647, background: '#0a66c2', color: 'white', padding: '10px 13px', borderRadius: '8px', font: '12px system-ui', maxWidth: '440px', boxShadow: '0 3px 15px #0005' });
      document.documentElement.appendChild(badge);
    }
    badge.textContent = message;
  }

  async function expandSeeMore(list) {
    let clicks = 0;
    for (const container of list) {
      for (const button of ownedNodes(container, 'button, [role="button"]')) {
        const text = Core.cleanText(button.textContent || button.getAttribute('aria-label'));
        if (/^(…?more|see more|xem thêm)$/i.test(text)) { button.click(); clicks += 1; }
      }
    }
    if (clicks) await wait(300);
  }

  async function stateResponse() { return chrome.runtime.sendMessage({ action: 'getState' }); }
  async function waitWhilePaused() {
    let response = await stateResponse();
    while (response.state?.running && response.state.paused) { status('LinkedIn Collector — đang tạm dừng'); await wait(1200); response = await stateResponse(); }
    return response;
  }

  async function reportFailures(failures, source) {
    for (const failure of failures) {
      const identity = failure.activity_id || failure.correlation_key || failure.content_fingerprint || 'missing';
      const signature = `${source}|${identity}|${failure.validation.reasons.join(',')}`;
      if (reportedFailures.has(signature)) continue;
      reportedFailures.add(signature);
      console.warn('[LinkedIn Collector] Stable extraction failure', {
        source_key: source, identity, validation: failure.validation,
        diagnostics: failure.extraction_failure?.diagnostics,
        sanitized_dom_snapshot: failure.extraction_failure?.sanitized_dom_snapshot
      });
    }
  }

  async function collect(initialResponse) {
    if (collecting) return;
    collecting = true;
    try {
      const state = initialResponse.state;
      const config = state.config;
      const sourceUrl = state.target_urls[state.current_index];
      const key = sourceKey(sourceUrl);
      const saved = state.partial_results?.[key];
      const posts = new Map((saved?.posts || []).filter((post) => Core.validatePost(post).is_valid).map((post) => [post.activity_id, post]));
      const candidates = new Map((saved?.partial_candidates || []).map((post) => [candidateKey(post), post]).filter(([candidate]) => candidate));
      const failures = [...(saved?.extraction_failures || [])].slice(-100);
      let round = saved?.round || 0;
      let noNewRounds = saved?.no_new_rounds || 0;
      let recoveryCount = saved?.recovery_count || 0;

      while (posts.size < config.minimum_valid_posts_per_source) {
        const response = await waitWhilePaused();
        if (!response.state?.running || !response.is_session_tab) return;
        const beforeScore = posts.size * 100 + [...candidates.values()].reduce((sum, candidate) => sum + Core.quality(candidate), 0);
        const observations = [];
        for (let pass = 0; pass < config.observation_passes_per_viewport; pass += 1) {
          const list = containers();
          if (pass === 0 && config.click_see_more) await expandSeeMore(list);
          if (pass > 0 || config.click_see_more) await wait(config.viewport_settle_ms);
          observations.push(...list.map((container, index) => extractPost(container, index, config)));
        }
        const stableFailures = [];
        for (const observation of observations) {
          const candidate = upsertCandidate(candidates, observation, config, round);
          if (candidate.validation.is_valid) {
            posts.set(candidate.activity_id, mergePost(posts.get(candidate.activity_id), candidate, config));
            for (const [candidateId, stored] of candidates) if (stored === candidate || Core.canMerge(stored, candidate)) candidates.delete(candidateId);
          } else if (candidate.observation_count >= 2) stableFailures.push(candidate);
        }
        for (const failure of stableFailures) {
          const identity = failure.activity_id || failure.correlation_key || failure.content_fingerprint || 'missing';
          const signature = `${identity}|${failure.validation.reasons.join(',')}`;
          if (!failures.some((item) => item.signature === signature)) failures.push({
            signature, observed_at: new Date().toISOString(), activity_id: failure.activity_id,
            validation: failure.validation, diagnostics: failure.extraction_failure?.diagnostics,
            sanitized_dom_snapshot: failure.extraction_failure?.sanitized_dom_snapshot
          });
        }
        if (failures.length > 100) failures.splice(0, failures.length - 100);
        await reportFailures(stableFailures, key);
        const afterScore = posts.size * 100 + [...candidates.values()].reduce((sum, candidate) => sum + Core.quality(candidate), 0);
        noNewRounds = afterScore <= beforeScore ? noNewRounds + 1 : 0;
        round += 1;
        status(`LinkedIn VALID ${posts.size}/${config.minimum_valid_posts_per_source} · PARTIAL ${candidates.size} · vòng ${round} · phục hồi ${recoveryCount}`);
        const progress = {
          source_key: key, source_url: sourceUrl, source_title: document.title,
          checkpoint_at: new Date().toISOString(), round, no_new_rounds: noNewRounds, recovery_count: recoveryCount,
          valid_post_count: posts.size, partial_candidate_count: candidates.size,
          invalid_observation_count: failures.length, extraction_failures: failures,
          partial_candidates: [...candidates.values()].slice(-250).map(checkpointCandidate), posts: [...posts.values()]
        };
        if (round % config.checkpoint_every_rounds === 0) await chrome.runtime.sendMessage({ action: 'checkpoint', progress });

        if (noNewRounds >= config.saturation_rounds) {
          recoveryCount += 1; noNewRounds = 0;
          progress.recovery_count = recoveryCount; progress.no_new_rounds = 0;
          await chrome.runtime.sendMessage({ action: 'checkpoint', progress });
          if (recoveryCount >= config.maximum_recoveries_per_source) {
            await chrome.runtime.sendMessage({ action: 'submitResult', result: { ...progress, collected_at: new Date().toISOString(), stop_reason: 'recovery_limit_reached', posts: [...posts.values()] } });
            return;
          }
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
          await wait(Math.max(config.maximum_wait_ms, 3500));
          if (recoveryCount % 2 === 0) { location.reload(); return; }
          continue;
        }
        window.scrollBy({ top: Math.max(window.innerHeight * config.viewport_scroll_ratio, 520), behavior: 'smooth' });
        await wait(config.minimum_wait_ms + Math.random() * (config.maximum_wait_ms - config.minimum_wait_ms));
      }
      await chrome.runtime.sendMessage({ action: 'submitResult', result: {
        source_key: key, source_url: sourceUrl, source_title: document.title, collected_at: new Date().toISOString(),
        stop_reason: 'target_reached', round, recovery_count: recoveryCount, extraction_failures: failures, posts: [...posts.values()]
      } });
    } finally { collecting = false; }
  }

  async function resume() {
    const response = await stateResponse();
    if (!response.state?.running || !response.is_session_tab) return;
    await wait(1800);
    await collect(response);
  }

  resume().catch((error) => { status(`LinkedIn Collector lỗi: ${error.message}`); console.error('[LinkedIn Collector]', error); });
})();
