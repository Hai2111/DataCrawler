const DEFAULT_KEYWORDS = [
  'thiết kế PCB', 'gia công PCB', 'ESP32 Việt Nam',
  'Arduino Việt Nam', 'tự động hóa công nghiệp'
];

const DEFAULT_TARGET_GROUPS = [
  'https://www.facebook.com/groups/750569458475765/',
  'https://www.facebook.com/groups/535899796577274/',
  'https://www.facebook.com/groups/congdongarduinovn/',
  'https://www.facebook.com/groups/congdongesp32vietnamplus/',
  'https://www.facebook.com/groups/thietkesanxuatgiacongbomachdientu/',
  'https://www.facebook.com/groups/323593134070081/',
  'https://www.facebook.com/groups/373638566378972/'
];

const DEFAULT_CONFIG = {
  session_group_target: 10,
  discovery_candidate_limit: 24,
  discovery_results_per_keyword: 16,
  minimum_unique_posts_per_group: 100,
  saturation_rounds: 25,
  maximum_rounds_per_group: 2500,
  minimum_wait_ms: 1600,
  maximum_wait_ms: 3000,
  click_see_more: true,
  collect_visible_comments: true,
  maximum_comments_per_post: 10,
  collect_raw_snapshot: false,
  collect_public_contacts: true,
  demand_only_contacts: true,
  save_to_selected_directory: true,
  checkpoint_export_every_posts: 100,
  export_after_each_group: true,
  privacy_mode: 'contacts_only',
  checkpoint_every_rounds: 3
};

function normalizeGroupUrl(value) {
  try {
    const url = new URL(String(value || '').trim(), 'https://www.facebook.com');
    const match = url.pathname.match(/^\/groups\/([^/]+)/);
    const reserved = new Set(['feed', 'discover', 'search', 'joins', 'create']);
    if (url.hostname !== 'www.facebook.com' || !match || reserved.has(match[1].toLowerCase())) return null;
    return `https://www.facebook.com/groups/${match[1]}/`;
  } catch {
    return null;
  }
}

function normalizeKeywords(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(/\r?\n|,/);
  return [...new Set(source.map((value) => String(value).trim()).filter(Boolean))].slice(0, 20);
}

function normalizeTargets(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(/\r?\n|,/);
  return [...new Set(source.map(normalizeGroupUrl).filter(Boolean))].slice(0, 50);
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeConfig(input = {}) {
  const minimumWait = clampInteger(input.minimum_wait_ms, DEFAULT_CONFIG.minimum_wait_ms, 800, 30000);
  const maximumWait = clampInteger(input.maximum_wait_ms, DEFAULT_CONFIG.maximum_wait_ms, 1000, 60000);
  const groupTarget = clampInteger(input.session_group_target, 10, 1, 10);
  return {
    ...DEFAULT_CONFIG,
    session_group_target: groupTarget,
    discovery_candidate_limit: clampInteger(input.discovery_candidate_limit, Math.max(20, groupTarget * 2), groupTarget, 50),
    discovery_results_per_keyword: clampInteger(input.discovery_results_per_keyword, 16, 5, 30),
    minimum_unique_posts_per_group: clampInteger(input.minimum_unique_posts_per_group, 100, 1, 1000),
    saturation_rounds: clampInteger(input.saturation_rounds, 25, 5, 100),
    maximum_rounds_per_group: clampInteger(input.maximum_rounds_per_group, 2500, 100, 10000),
    minimum_wait_ms: Math.min(minimumWait, maximumWait),
    maximum_wait_ms: Math.max(minimumWait, maximumWait),
    click_see_more: input.click_see_more !== false,
    collect_visible_comments: input.collect_visible_comments !== false,
    maximum_comments_per_post: clampInteger(input.maximum_comments_per_post, 10, 0, 100),
    collect_raw_snapshot: input.collect_raw_snapshot === true,
    collect_public_contacts: input.collect_public_contacts !== false,
    demand_only_contacts: input.demand_only_contacts !== false,
    save_to_selected_directory: input.save_to_selected_directory !== false,
    checkpoint_export_every_posts: clampInteger(input.checkpoint_export_every_posts, 100, 0, 5000),
    export_after_each_group: input.export_after_each_group !== false,
    privacy_mode: ['redacted', 'contacts_only', 'full'].includes(input.privacy_mode) ? input.privacy_mode : 'contacts_only',
    checkpoint_every_rounds: clampInteger(input.checkpoint_every_rounds, 3, 1, 50)
  };
}

const MAX_DEBUG_LOG_ENTRIES = 500;

function addDebugLog(state, event, details = {}, level = 'info') {
  if (!state) return null;
  const entry = {
    sequence: (state.debug_log_sequence || 0) + 1,
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  };
  state.debug_log_sequence = entry.sequence;
  state.debug_log = [...(state.debug_log || []), entry].slice(-MAX_DEBUG_LOG_ENTRIES);
  console[level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info']('[Facebook Demand Collector]', entry);
  return entry;
}

function searchUrl(keyword) {
  return `https://www.facebook.com/groups/search/groups_home/?q=${encodeURIComponent(keyword)}`;
}

function downloadPayload(payload, filenamePrefix = 'facebook-demand-leads', sendResponse = () => {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const json = JSON.stringify(payload, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  chrome.downloads.download({ url, filename: `FacebookDemandCollector/${filenamePrefix}-${stamp}.json`, saveAs: false }, (downloadId) => {
    if (chrome.runtime.lastError) return sendResponse({ ok: false, error: chrome.runtime.lastError.message });
    sendResponse({ ok: true, downloadId });
  });
}

const DIRECTORY_DB_NAME = 'facebook-demand-collector-files';
const DIRECTORY_STORE_NAME = 'handles';
const DIRECTORY_HANDLE_KEY = 'export-directory';

function openDirectoryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DIRECTORY_STORE_NAME)) {
        request.result.createObjectStore(DIRECTORY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getSelectedDirectoryHandle() {
  const database = await openDirectoryDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(DIRECTORY_STORE_NAME, 'readonly')
        .objectStore(DIRECTORY_STORE_NAME).get(DIRECTORY_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function exportFilename(prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}-${stamp}.json`;
}

async function writePayloadToSelectedDirectory(payload, filenamePrefix) {
  const directory = await getSelectedDirectoryHandle();
  if (!directory) return { ok: false, reason: 'no_directory_selected' };
  const permission = await directory.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') return { ok: false, reason: 'directory_permission_required' };
  const filename = exportFilename(filenamePrefix);
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();
  return { ok: true, destination: 'selected_directory', directory_name: directory.name, filename };
}

async function savePayload(payload, filenamePrefix = 'facebook-demand-leads', preferDirectory = true) {
  if (preferDirectory) {
    try {
      const direct = await writePayloadToSelectedDirectory(payload, filenamePrefix);
      if (direct.ok) return direct;
    } catch (error) {
      console.warn('Selected-directory write failed; falling back to Downloads.', error);
    }
  }
  return new Promise((resolve) => {
    downloadPayload(payload, filenamePrefix, (result) => resolve({
      ...result,
      destination: result.ok ? 'downloads_subfolder' : 'failed',
      folder: result.ok ? 'Downloads/FacebookDemandCollector' : null
    }));
  });
}

function normalizeForDedupe(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(?:\+?84|0)(?:[ .-]?\d){8,10}/g, ' [phone] ')
    .replace(/\bfacebook\b/g, ' ')
    .replace(/\b(xem them|see more|author_redacted|phone_redacted)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp-${(hash >>> 0).toString(16)}`;
}

function deduplicatePosts(groups) {
  const fingerprints = new Map();
  const uniquePosts = [];
  const duplicates = [];
  for (const group of groups) {
    for (const post of group.posts || []) {
      const normalized = normalizeForDedupe(post.text || post.visible_context_text);
      const fingerprint = post.content_fingerprint || hashText(normalized);
      const record = { ...post, source_group_key: group.group_key, source_group_url: group.group_url, content_fingerprint: fingerprint };
      if (normalized.length >= 40 && fingerprints.has(fingerprint)) {
        duplicates.push({ post_id: post.post_id, post_url: post.post_url, source_group_key: group.group_key, duplicate_of: fingerprints.get(fingerprint) });
        continue;
      }
      uniquePosts.push(record);
      if (normalized.length >= 40) fingerprints.set(fingerprint, { post_id: post.post_id, post_url: post.post_url, source_group_key: group.group_key });
    }
  }
  return { uniquePosts, duplicates };
}

function makePayload(state) {
  const mergedGroups = { ...(state.attempt_results || {}) };
  for (const [key, partial] of Object.entries(state.partial_results || {})) {
    if (!mergedGroups[key]) mergedGroups[key] = {
      ...partial,
      collected_at: partial.checkpoint_at,
      stop_reason: state.stopped ? 'stopped_by_user' : 'checkpoint_only',
      partial: true
    };
  }
  const groups = Object.values(mergedGroups);
  const { uniquePosts, duplicates } = deduplicatePosts(groups);
  const demandPosts = uniquePosts.filter((post) => post.demand?.is_demand);
  const contactLeads = demandPosts.filter((post) => (post.contacts?.phones?.length || 0) + (post.contacts?.emails?.length || 0) > 0);
  return {
    schema_version: '0.6.1',
    scope: state.mode === 'url_auto'
      ? 'url_provided_accessible_facebook_group_demand_leads'
      : 'keyword_discovered_accessible_facebook_group_demand_leads',
    started_at: state.started_at,
    finished_at: state.finished_at,
    snapshot_at: new Date().toISOString(),
    run_status: state.running ? 'running_checkpoint' : (state.stopped ? 'stopped_by_user' : 'completed'),
    stopped_by_user: Boolean(state.stopped),
    discovery: {
      mode: state.mode,
      keywords: state.keywords || [],
      candidates_found: state.discovered_groups?.length || state.target_groups?.length || 0,
      candidate_groups: state.discovered_groups?.length
        ? state.discovered_groups
        : (state.target_groups || []).map((url) => ({ url, source: 'user_provided' }))
    },
    privacy: {
      mode: state.config.privacy_mode,
      public_contact_fields_collected: state.config.collect_public_contacts,
      contacts_limited_to_demand_posts: state.config.demand_only_contacts,
      authentication_data_collected: false
    },
    config: state.config,
    attempted_group_count: groups.length,
    complete_group_count: groups.filter((group) => group.posts?.length >= state.config.minimum_unique_posts_per_group).length,
    incomplete_group_count: groups.filter((group) => group.posts?.length < state.config.minimum_unique_posts_per_group).length,
    unique_post_count: uniquePosts.length,
    duplicate_post_count: duplicates.length,
    demand_post_count: demandPosts.length,
    contact_lead_count: contactLeads.length,
    groups,
    unique_posts: uniquePosts,
    duplicates,
    demand_posts: demandPosts,
    contact_leads: contactLeads,
    debug_log: state.debug_log || [],
    errors: state.errors || []
  };
}

async function startAutomatedSession(tabId, options = {}) {
  if (!tabId) throw new Error('Không xác định được tab Chrome để chạy phiên.');
  const keywords = normalizeKeywords(options.keywords);
  if (!keywords.length) throw new Error('Hãy nhập ít nhất một keyword tìm group.');
  const config = normalizeConfig(options.config);
  const state = {
    schema_version: '0.6.1', mode: 'keyword_auto', phase: 'discovering', running: true,
    paused: false, stopped: false, tab_id: tabId,
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    keywords, current_keyword_index: 0, discovered_groups: [], target_groups: [], current_index: 0,
    config, group_results: {}, attempt_results: {}, partial_results: {}, errors: [], debug_log: [], debug_log_sequence: 0,
    last_checkpoint_export_post_total: 0
  };
  addDebugLog(state, 'session_started', { mode: state.mode, group_target: config.session_group_target, posts_per_group: config.minimum_unique_posts_per_group });
  await chrome.storage.local.set({ fbCollectorState: state, fbCollectorSettings: { keywords, config } });
  await chrome.tabs.update(tabId, { url: searchUrl(keywords[0]) });
  return state;
}

async function startUrlSession(tabId, options = {}) {
  if (!tabId) throw new Error('Không xác định được tab Chrome để chạy phiên.');
  const targetGroups = normalizeTargets(options.target_groups);
  if (!targetGroups.length) throw new Error('Hãy nhập ít nhất một URL Facebook Group hợp lệ.');
  const config = normalizeConfig(options.config);
  config.session_group_target = Math.min(config.session_group_target, targetGroups.length);
  const state = {
    schema_version: '0.6.1', mode: 'url_auto', phase: 'collecting', running: true,
    paused: false, stopped: false, tab_id: tabId,
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    keywords: [], current_keyword_index: 0, discovered_groups: [],
    target_groups: targetGroups, current_index: 0,
    config, group_results: {}, attempt_results: {}, partial_results: {}, errors: [], debug_log: [], debug_log_sequence: 0,
    last_checkpoint_export_post_total: 0
  };
  addDebugLog(state, 'session_started', { mode: state.mode, queued_groups: targetGroups.length, group_target: config.session_group_target, posts_per_group: config.minimum_unique_posts_per_group });
  await chrome.storage.local.set({
    fbCollectorState: state,
    fbCollectorSettings: { target_groups: targetGroups, keywords: DEFAULT_KEYWORDS, config }
  });
  await chrome.tabs.update(tabId, { url: targetGroups[0] });
  return state;
}

async function finishBatch(state, stopped = false) {
  state.running = false;
  state.paused = false;
  state.stopped = stopped;
  state.phase = 'finished';
  state.finished_at = new Date().toISOString();
  state.updated_at = state.finished_at;
  const completedGroups = Object.keys(state.group_results || {}).length;
  const retainedPosts = Object.values({ ...(state.attempt_results || {}), ...(state.partial_results || {}) })
    .reduce((sum, group) => sum + (group.posts?.length || 0), 0);
  addDebugLog(state, stopped ? 'session_stopped_by_user' : 'session_completed', {
    completed_groups: completedGroups,
    attempted_groups: Object.keys(state.attempt_results || {}).length,
    retained_posts: retainedPosts
  });
  const payload = makePayload(state);
  const exportResult = await savePayload(payload, 'facebook-demand-leads', state.config.save_to_selected_directory);
  payload.export_result = exportResult;
  await chrome.storage.local.set({ fbCollectorState: state, fbCollectorLastResult: payload, fbCollectorLastExport: exportResult });
  return payload;
}

async function submitDiscoveryResult(message) {
  const { fbCollectorState: state } = await chrome.storage.local.get('fbCollectorState');
  if (!state?.running || state.phase !== 'discovering') return { ok: false, error: 'Phiên tìm group không còn chạy.' };
  const known = new Map((state.discovered_groups || []).map((item) => [item.url, item]));
  for (const candidate of message.candidates || []) {
    const url = normalizeGroupUrl(candidate.url);
    if (!url || known.has(url)) continue;
    known.set(url, {
      url, title: String(candidate.title || '').trim() || null,
      member_count_text: candidate.member_count_text || null,
      discovered_from_keyword: state.keywords[state.current_keyword_index]
    });
  }
  state.discovered_groups = [...known.values()].slice(0, state.config.discovery_candidate_limit);
  state.current_keyword_index += 1;
  state.updated_at = new Date().toISOString();
  const done = state.discovered_groups.length >= state.config.discovery_candidate_limit || state.current_keyword_index >= state.keywords.length;
  if (!done) {
    await chrome.storage.local.set({ fbCollectorState: state });
    await chrome.tabs.update(state.tab_id, { url: searchUrl(state.keywords[state.current_keyword_index]) });
    return { ok: true, phase: state.phase, candidates: state.discovered_groups.length };
  }
  state.target_groups = state.discovered_groups.map((item) => item.url);
  if (!state.target_groups.length) {
    state.errors.push({ stage: 'discovery', message: 'Không tìm thấy group hợp lệ từ các keyword.' });
    await finishBatch(state);
    return { ok: false, finished: true, error: 'Không tìm thấy group hợp lệ.' };
  }
  state.phase = 'collecting';
  state.current_index = 0;
  await chrome.storage.local.set({ fbCollectorState: state });
  await chrome.tabs.update(state.tab_id, { url: state.target_groups[0] });
  return { ok: true, phase: state.phase, candidates: state.target_groups.length };
}

async function checkpointProgress(message) {
  const { fbCollectorState: state } = await chrome.storage.local.get('fbCollectorState');
  if (!state?.running || state.phase !== 'collecting') return { ok: false, error: 'Collector is not collecting.' };
  const previous = state.partial_results[message.progress.group_key];
  const previousPostCount = previous?.posts?.length || 0;
  const previousRecoveryCount = previous?.recovery_count || 0;
  state.partial_results[message.progress.group_key] = message.progress;
  state.updated_at = new Date().toISOString();
  const merged = { ...(state.attempt_results || {}), ...(state.partial_results || {}) };
  const totalPosts = Object.values(merged).reduce((sum, group) => sum + (group.posts?.length || 0), 0);
  const interval = state.config.checkpoint_export_every_posts || 0;
  const currentPostCount = message.progress.posts?.length || 0;
  const currentRecoveryCount = message.progress.recovery_count || 0;
  if (currentPostCount !== previousPostCount || currentRecoveryCount !== previousRecoveryCount) {
    addDebugLog(state, currentRecoveryCount > previousRecoveryCount ? 'group_recovery' : 'scan_progress', {
      group_key: message.progress.group_key,
      group_index: state.current_index + 1,
      group_posts: currentPostCount,
      group_target: state.config.minimum_unique_posts_per_group,
      total_posts: totalPosts,
      completed_groups: Object.keys(state.group_results || {}).length,
      recovery_count: currentRecoveryCount,
      round: message.progress.round || 0
    }, currentRecoveryCount > previousRecoveryCount ? 'warning' : 'info');
  }
  let exportResult = null;
  if (interval > 0 && totalPosts >= (state.last_checkpoint_export_post_total || 0) + interval) {
    state.last_checkpoint_export_post_total = totalPosts;
    const snapshot = makePayload(state);
    exportResult = await savePayload(snapshot, 'facebook-demand-checkpoint', state.config.save_to_selected_directory);
    addDebugLog(state, 'checkpoint_exported', {
      total_posts: totalPosts,
      destination: exportResult.destination,
      filename: exportResult.filename || null,
      folder: exportResult.folder || null
    });
    snapshot.export_result = exportResult;
    await chrome.storage.local.set({
      fbCollectorState: state,
      fbCollectorLastResult: snapshot,
      fbCollectorLastExport: exportResult
    });
  } else {
    await chrome.storage.local.set({ fbCollectorState: state });
  }
  return { ok: true, total_posts: totalPosts, checkpoint_export: exportResult };
}

async function submitGroupResult(message) {
  const { fbCollectorState: state } = await chrome.storage.local.get('fbCollectorState');
  if (!state?.running || state.phase !== 'collecting') return { ok: false, error: 'Collector is not collecting.' };
  const result = message.result;
  state.attempt_results[result.group_key] = result;
  delete state.partial_results[result.group_key];
  const complete = (result.posts?.length || 0) >= state.config.minimum_unique_posts_per_group;
  if (complete) state.group_results[result.group_key] = result;
  addDebugLog(state, complete ? 'group_completed' : 'group_skipped', {
    group_key: result.group_key,
    group_url: result.group_url,
    posts: result.posts?.length || 0,
    target: state.config.minimum_unique_posts_per_group,
    stop_reason: result.stop_reason || null,
    completed_groups: Object.keys(state.group_results).length
  }, complete ? 'info' : 'warning');
  state.current_index += 1;
  state.updated_at = new Date().toISOString();
  const completeCount = Object.keys(state.group_results).length;
  if (completeCount >= state.config.session_group_target || state.current_index >= state.target_groups.length) {
    const payload = await finishBatch(state);
    return { ok: true, finished: true, complete_count: completeCount, leads: payload.contact_lead_count };
  }
  if (complete && state.config.export_after_each_group) {
    const snapshot = makePayload(state);
    const exportResult = await savePayload(snapshot, 'facebook-demand-checkpoint', state.config.save_to_selected_directory);
    addDebugLog(state, 'group_checkpoint_exported', {
      group_key: result.group_key,
      completed_groups: completeCount,
      destination: exportResult.destination,
      filename: exportResult.filename || null,
      folder: exportResult.folder || null
    });
    snapshot.export_result = exportResult;
    await chrome.storage.local.set({ fbCollectorLastResult: snapshot, fbCollectorLastExport: exportResult });
  }
  await chrome.storage.local.set({ fbCollectorState: state });
  await chrome.tabs.update(state.tab_id, { url: state.target_groups[state.current_index] });
  return { ok: true, finished: false, complete_count: completeCount };
}

async function setPaused(paused) {
  const { fbCollectorState: state } = await chrome.storage.local.get('fbCollectorState');
  if (!state?.running) return { ok: false, error: 'Không có phiên đang chạy.' };
  state.paused = paused;
  state.updated_at = new Date().toISOString();
  addDebugLog(state, paused ? 'session_paused' : 'session_resumed', {
    current_group_index: state.current_index + 1,
    completed_groups: Object.keys(state.group_results || {}).length
  });
  await chrome.storage.local.set({ fbCollectorState: state });
  if (!paused) {
    const url = state.phase === 'discovering' ? searchUrl(state.keywords[state.current_keyword_index]) : state.target_groups[state.current_index];
    if (url) await chrome.tabs.update(state.tab_id, { url });
  }
  return { ok: true, state };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tab_id || sender.tab?.id;
  if (message.action === 'downloadJson') {
    savePayload(message.payload, message.filename_prefix || 'facebook-demand-leads', true).then(sendResponse);
    return true;
  }
  if (message.action === 'downloadLastResult') {
    chrome.storage.local.get('fbCollectorLastResult').then(({ fbCollectorLastResult }) => {
      if (!fbCollectorLastResult) return sendResponse({ ok: false, error: 'Chưa có kết quả trước đó.' });
      savePayload(fbCollectorLastResult, 'facebook-demand-leads', true).then(sendResponse);
    });
    return true;
  }
  if (message.action === 'exportRunningCheckpoint') {
    chrome.storage.local.get('fbCollectorState').then(async ({ fbCollectorState: state }) => {
      if (!state?.running) return sendResponse({ ok: false, error: 'Không có tiến trình đang chạy.' });
      addDebugLog(state, 'manual_checkpoint_requested', {
        completed_groups: Object.keys(state.group_results || {}).length
      });
      const snapshot = makePayload(state);
      const exportResult = await savePayload(snapshot, 'facebook-demand-checkpoint', state.config.save_to_selected_directory);
      addDebugLog(state, 'manual_checkpoint_exported', {
        destination: exportResult.destination,
        filename: exportResult.filename || null,
        folder: exportResult.folder || null,
        unique_posts: snapshot.unique_post_count
      });
      snapshot.export_result = exportResult;
      await chrome.storage.local.set({ fbCollectorState: state, fbCollectorLastResult: snapshot, fbCollectorLastExport: exportResult });
      sendResponse({ ...exportResult, running: true, unique_post_count: snapshot.unique_post_count });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'startAutomatedSession') {
    (async () => {
      if (message.options) return startAutomatedSession(tabId, message.options);
      const { fbCollectorSettings } = await chrome.storage.local.get('fbCollectorSettings');
      return startAutomatedSession(tabId, fbCollectorSettings || { keywords: DEFAULT_KEYWORDS, config: DEFAULT_CONFIG });
    })().then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'startUrlSession') {
    (async () => {
      if (message.options) return startUrlSession(tabId, message.options);
      const { fbCollectorSettings } = await chrome.storage.local.get('fbCollectorSettings');
      return startUrlSession(tabId, fbCollectorSettings || { target_groups: DEFAULT_TARGET_GROUPS, config: DEFAULT_CONFIG });
    })()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'getBatchState') {
    chrome.storage.local.get(['fbCollectorState', 'fbCollectorSettings', 'fbCollectorLastResult', 'fbCollectorLastExport']).then(async (result) => {
      const saved = result.fbCollectorSettings || {};
      const state = result.fbCollectorState || null;
      if (state) {
        state.config = normalizeConfig(state.config || {});
        state.schema_version = '0.6.1';
        state.debug_log = Array.isArray(state.debug_log) ? state.debug_log.slice(-MAX_DEBUG_LOG_ENTRIES) : [];
        state.debug_log_sequence = Number.isFinite(state.debug_log_sequence)
          ? state.debug_log_sequence
          : (state.debug_log.at(-1)?.sequence || 0);
        if (!Number.isFinite(state.last_checkpoint_export_post_total)) state.last_checkpoint_export_post_total = 0;
        await chrome.storage.local.set({ fbCollectorState: state });
      }
      sendResponse({
        state,
        settings: {
          ...saved,
          target_groups: saved.target_groups?.length ? saved.target_groups : DEFAULT_TARGET_GROUPS,
          keywords: saved.keywords?.length ? saved.keywords : DEFAULT_KEYWORDS,
          config: { ...DEFAULT_CONFIG, ...(saved.config || {}) }
        },
        has_last_result: Boolean(result.fbCollectorLastResult),
        last_export: result.fbCollectorLastExport || null
      });
    });
    return true;
  }
  if (message.action === 'submitDiscoveryResult') {
    submitDiscoveryResult(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'checkpointGroupProgress') {
    checkpointProgress(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'submitGroupResult') {
    submitGroupResult(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'pauseBatch' || message.action === 'resumeBatch') {
    setPaused(message.action === 'pauseBatch').then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'clearDebugLog') {
    chrome.storage.local.get('fbCollectorState').then(async ({ fbCollectorState: state }) => {
      if (!state) return sendResponse({ ok: false, error: 'Chưa có phiên để xóa log.' });
      state.debug_log = [];
      state.debug_log_sequence = 0;
      addDebugLog(state, 'debug_log_cleared');
      await chrome.storage.local.set({ fbCollectorState: state });
      sendResponse({ ok: true, state });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'reportCollectorError') {
    chrome.storage.local.get('fbCollectorState').then(async ({ fbCollectorState: state }) => {
      if (!state) return sendResponse({ ok: false, error: 'Collector state is unavailable.' });
      const errorRecord = {
        timestamp: new Date().toISOString(),
        stage: message.stage || 'content_script',
        group_key: message.group_key || null,
        page_url: message.page_url || null,
        message: String(message.error || 'Unknown collector error').slice(0, 1000)
      };
      state.errors = [...(state.errors || []), errorRecord].slice(-200);
      addDebugLog(state, 'collector_error', errorRecord, 'error');
      await chrome.storage.local.set({ fbCollectorState: state });
      sendResponse({ ok: true });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'stopBatch') {
    chrome.storage.local.get('fbCollectorState').then(async ({ fbCollectorState: state }) => {
      if (state?.running) await finishBatch(state, true);
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'export-visible-posts') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.facebook.com/')) return;
  const { fbCollectorSettings } = await chrome.storage.local.get('fbCollectorSettings');
  await startUrlSession(tab.id, fbCollectorSettings || { target_groups: DEFAULT_TARGET_GROUPS, config: DEFAULT_CONFIG });
});
