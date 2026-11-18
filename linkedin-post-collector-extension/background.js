const SCHEMA_VERSION = '0.1.0';
const DEFAULT_CONFIG = {
  minimum_valid_posts_per_source: 100,
  saturation_rounds: 20,
  maximum_recoveries_per_source: 8,
  minimum_wait_ms: 1600,
  maximum_wait_ms: 3000,
  observation_passes_per_viewport: 2,
  viewport_settle_ms: 800,
  viewport_scroll_ratio: 0.65,
  click_see_more: true,
  collect_public_contacts: true,
  demand_only_contacts: true,
  privacy_mode: 'contacts_only',
  checkpoint_every_rounds: 3,
  checkpoint_export_every_posts: 100,
  save_to_selected_directory: true,
  developer_mode: true
};
const MAX_LOGS = 500;
const DEV_LOG_ENDPOINT = 'http://127.0.0.1:32145/log';
const DIRECTORY_DB_NAME = 'linkedin-demand-collector-files';
const DIRECTORY_STORE_NAME = 'handles';
const DIRECTORY_HANDLE_KEY = 'export-directory';

function normalizeSourceUrl(value) {
  try {
    const url = new URL(String(value || '').trim(), 'https://www.linkedin.com');
    if (url.hostname !== 'www.linkedin.com' && url.hostname !== 'linkedin.com') return null;
    if (!/^\/(feed|search\/results\/content|company\/[^/]+\/posts|in\/[^/]+\/recent-activity|hashtag\/[^/]+|posts\/)/i.test(url.pathname)) return null;
    url.protocol = 'https:';
    url.hostname = 'www.linkedin.com';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (!['keywords', 'sortBy', 'datePosted', 'origin'].includes(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function sourceKey(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `source-${(hash >>> 0).toString(16)}`;
}

function clamp(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeConfig(input = {}) {
  const minWait = clamp(input.minimum_wait_ms, 1600, 800, 30000);
  const maxWait = clamp(input.maximum_wait_ms, 3000, 1000, 60000);
  return {
    ...DEFAULT_CONFIG,
    minimum_valid_posts_per_source: clamp(input.minimum_valid_posts_per_source, 100, 1, 1000),
    saturation_rounds: clamp(input.saturation_rounds, 20, 5, 100),
    maximum_recoveries_per_source: clamp(input.maximum_recoveries_per_source, 8, 1, 50),
    minimum_wait_ms: Math.min(minWait, maxWait),
    maximum_wait_ms: Math.max(minWait, maxWait),
    observation_passes_per_viewport: clamp(input.observation_passes_per_viewport, 2, 1, 5),
    viewport_settle_ms: clamp(input.viewport_settle_ms, 800, 250, 5000),
    viewport_scroll_ratio: Math.min(0.95, Math.max(0.35, Number(input.viewport_scroll_ratio) || 0.65)),
    click_see_more: input.click_see_more !== false,
    collect_public_contacts: input.collect_public_contacts !== false,
    demand_only_contacts: input.demand_only_contacts !== false,
    privacy_mode: ['redacted', 'contacts_only', 'full'].includes(input.privacy_mode) ? input.privacy_mode : 'contacts_only',
    checkpoint_every_rounds: clamp(input.checkpoint_every_rounds, 3, 1, 50),
    checkpoint_export_every_posts: clamp(input.checkpoint_export_every_posts, 100, 0, 5000),
    save_to_selected_directory: input.save_to_selected_directory !== false,
    developer_mode: input.developer_mode !== false
  };
}

async function forwardLog(state, entry) {
  if (!state?.config?.developer_mode) return;
  try {
    await fetch(DEV_LOG_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'linkedin-demand-collector', schema_version: SCHEMA_VERSION, session_started_at: state.started_at, ...entry })
    });
  } catch (error) {
    console.warn('[LinkedIn Collector] Dev bridge unavailable.', error.message);
  }
}

function addLog(state, event, details = {}, level = 'info') {
  const entry = { sequence: (state.log_sequence || 0) + 1, timestamp: new Date().toISOString(), level, event, ...details };
  state.log_sequence = entry.sequence;
  state.debug_log = [...(state.debug_log || []), entry].slice(-MAX_LOGS);
  void forwardLog(state, entry);
  return entry;
}

function openDirectoryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DIRECTORY_STORE_NAME)) request.result.createObjectStore(DIRECTORY_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function selectedDirectory() {
  const database = await openDirectoryDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(DIRECTORY_STORE_NAME, 'readonly').objectStore(DIRECTORY_STORE_NAME).get(DIRECTORY_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

function exportFilename(prefix) {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

async function savePayload(payload, prefix = 'linkedin-demand-leads', preferDirectory = true) {
  const filename = exportFilename(prefix);
  if (preferDirectory) {
    try {
      const directory = await selectedDirectory();
      if (directory && await directory.queryPermission({ mode: 'readwrite' }) === 'granted') {
        const handle = await directory.getFileHandle(filename, { create: true });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(payload, null, 2));
        await writable.close();
        return { ok: true, destination: 'selected_directory', directory_name: directory.name, filename };
      }
    } catch (error) { console.warn('[LinkedIn Collector] Directory export failed.', error); }
  }
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(payload, null, 2))}`;
  return new Promise((resolve) => chrome.downloads.download({
    url: dataUrl, filename: `LinkedInDemandCollector/${filename}`, saveAs: false
  }, (downloadId) => resolve(chrome.runtime.lastError
    ? { ok: false, error: chrome.runtime.lastError.message }
    : { ok: true, downloadId, destination: 'downloads_subfolder', folder: 'Downloads/LinkedInDemandCollector', filename })));
}

function validPosts(result) {
  return (result?.posts || []).filter((post) => post.validation?.status === 'VALID' && post.validation?.is_valid);
}

function makePayload(state) {
  const sources = Object.values({ ...(state.partial_results || {}), ...(state.results || {}) });
  const unique = new Map();
  const duplicates = [];
  for (const source of sources) {
    for (const post of validPosts(source)) {
      const key = post.activity_id || post.content_fingerprint;
      if (!key) continue;
      if (unique.has(key)) duplicates.push({ duplicate_activity_id: post.activity_id, canonical_activity_id: unique.get(key).activity_id, source_url: source.source_url });
      else unique.set(key, { ...post, source_key: source.source_key, source_url: source.source_url });
    }
  }
  const posts = [...unique.values()];
  const demandPosts = posts.filter((post) => post.demand?.is_demand);
  return {
    schema_version: SCHEMA_VERSION,
    platform: 'linkedin',
    generated_at: new Date().toISOString(),
    session: { started_at: state.started_at, finished_at: state.finished_at || null, supplied_urls: state.target_urls, attempted_urls: Object.keys(state.results || {}).length },
    config: state.config,
    source_results: sources,
    unique_post_count: posts.length,
    unique_posts: posts,
    duplicate_count: duplicates.length,
    duplicates,
    demand_post_count: demandPosts.length,
    demand_posts: demandPosts,
    contact_leads: demandPosts.filter((post) => post.contacts?.phones?.length || post.contacts?.emails?.length),
    debug_log: state.debug_log || []
  };
}

async function persistAndNavigate(state) {
  await chrome.storage.local.set({ linkedinCollectorState: state });
  const url = state.target_urls[state.current_index];
  if (url) await chrome.tabs.update(state.tab_id, { url });
}

async function startSession(tabId, options = {}) {
  const targetUrls = [...new Set((options.target_urls || []).map(normalizeSourceUrl).filter(Boolean))].slice(0, 50);
  if (!targetUrls.length) throw new Error('Không có URL LinkedIn hợp lệ.');
  const state = {
    schema_version: SCHEMA_VERSION, platform: 'linkedin', running: true, paused: false,
    started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    tab_id: tabId, target_urls: targetUrls, current_index: 0,
    config: normalizeConfig(options.config), partial_results: {}, results: {}, errors: [], debug_log: [], log_sequence: 0,
    last_checkpoint_export_post_total: 0
  };
  addLog(state, 'session_started', { url_count: targetUrls.length, post_target: state.config.minimum_valid_posts_per_source });
  await persistAndNavigate(state);
  return state;
}

async function checkpoint(progress) {
  const { linkedinCollectorState: state } = await chrome.storage.local.get('linkedinCollectorState');
  if (!state?.running) return { ok: false, error: 'Phiên không chạy.' };
  const previous = state.partial_results[progress.source_key];
  state.partial_results[progress.source_key] = progress;
  state.updated_at = new Date().toISOString();
  if ((previous?.valid_post_count || 0) !== progress.valid_post_count
    || (previous?.partial_candidate_count || 0) !== progress.partial_candidate_count
    || (previous?.recovery_count || 0) !== progress.recovery_count) {
    addLog(state, 'scan_progress', {
      source_index: state.current_index + 1, source_key: progress.source_key,
      valid_posts: progress.valid_post_count, partial_candidates: progress.partial_candidate_count,
      stable_failures: progress.invalid_observation_count, round: progress.round, recovery_count: progress.recovery_count
    });
  }
  const total = Object.values({ ...state.results, ...state.partial_results }).reduce((sum, item) => sum + validPosts(item).length, 0);
  let exportResult = null;
  const interval = state.config.checkpoint_export_every_posts;
  if (interval && total >= state.last_checkpoint_export_post_total + interval) {
    state.last_checkpoint_export_post_total = total;
    exportResult = await savePayload(makePayload(state), 'linkedin-demand-checkpoint', state.config.save_to_selected_directory);
    addLog(state, 'checkpoint_exported', { total_valid_posts: total, destination: exportResult.destination, filename: exportResult.filename });
  }
  await chrome.storage.local.set({ linkedinCollectorState: state });
  return { ok: true, total_valid_posts: total, checkpoint_export: exportResult };
}

async function submitResult(result) {
  const { linkedinCollectorState: state } = await chrome.storage.local.get('linkedinCollectorState');
  if (!state?.running) return { ok: false, error: 'Phiên không chạy.' };
  result.posts = validPosts(result);
  state.results[result.source_key] = result;
  delete state.partial_results[result.source_key];
  addLog(state, result.stop_reason === 'target_reached' ? 'source_completed' : 'source_incomplete', {
    source_index: state.current_index + 1, source_url: result.source_url, valid_posts: result.posts.length, stop_reason: result.stop_reason
  }, result.stop_reason === 'target_reached' ? 'info' : 'warning');
  state.current_index += 1;
  if (state.current_index < state.target_urls.length) {
    await persistAndNavigate(state);
    return { ok: true, finished: false };
  }
  state.running = false;
  state.finished_at = new Date().toISOString();
  addLog(state, 'session_completed', { attempted_urls: state.target_urls.length });
  const payload = makePayload(state);
  const exportResult = await savePayload(payload, 'linkedin-demand-leads', state.config.save_to_selected_directory);
  payload.export_result = exportResult;
  await chrome.storage.local.set({ linkedinCollectorState: state, linkedinCollectorLastResult: payload, linkedinCollectorLastExport: exportResult });
  return { ok: true, finished: true, export_result: exportResult };
}

async function stopSession() {
  const { linkedinCollectorState: state } = await chrome.storage.local.get('linkedinCollectorState');
  if (!state) return { ok: false, error: 'Chưa có phiên.' };
  state.running = false;
  state.finished_at = new Date().toISOString();
  addLog(state, 'session_stopped');
  const payload = makePayload(state);
  const exportResult = await savePayload(payload, 'linkedin-demand-leads', state.config.save_to_selected_directory);
  payload.export_result = exportResult;
  await chrome.storage.local.set({ linkedinCollectorState: state, linkedinCollectorLastResult: payload, linkedinCollectorLastExport: exportResult });
  return { ok: true, export_result: exportResult };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startSession') {
    startSession(message.tab_id || sender.tab?.id, message.options).then((state) => sendResponse({ ok: true, state })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.action === 'getState') {
    chrome.storage.local.get(['linkedinCollectorState', 'linkedinCollectorSettings', 'linkedinCollectorLastResult', 'linkedinCollectorLastExport']).then((data) => sendResponse({
      state: data.linkedinCollectorState || null,
      is_session_tab: Boolean(data.linkedinCollectorState?.tab_id && data.linkedinCollectorState.tab_id === sender.tab?.id),
      settings: data.linkedinCollectorSettings || { target_urls: [], config: DEFAULT_CONFIG },
      has_last_result: Boolean(data.linkedinCollectorLastResult), last_export: data.linkedinCollectorLastExport || null
    }));
    return true;
  }
  if (message.action === 'saveSettings') {
    chrome.storage.local.set({ linkedinCollectorSettings: message.settings }).then(() => sendResponse({ ok: true })); return true;
  }
  if (message.action === 'checkpoint') { checkpoint(message.progress).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message })); return true; }
  if (message.action === 'submitResult') { submitResult(message.result).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message })); return true; }
  if (message.action === 'pause' || message.action === 'resume') {
    chrome.storage.local.get('linkedinCollectorState').then(async ({ linkedinCollectorState: state }) => {
      if (!state?.running) return sendResponse({ ok: false, error: 'Phiên không chạy.' });
      state.paused = message.action === 'pause';
      addLog(state, state.paused ? 'session_paused' : 'session_resumed');
      await chrome.storage.local.set({ linkedinCollectorState: state });
      if (!state.paused) await chrome.tabs.update(state.tab_id, { url: state.target_urls[state.current_index] });
      sendResponse({ ok: true, state });
    }); return true;
  }
  if (message.action === 'stop') { stopSession().then(sendResponse); return true; }
  if (message.action === 'exportCheckpoint') {
    chrome.storage.local.get('linkedinCollectorState').then(async ({ linkedinCollectorState: state }) => {
      if (!state) return sendResponse({ ok: false, error: 'Chưa có phiên.' });
      sendResponse(await savePayload(makePayload(state), 'linkedin-demand-checkpoint', state.config.save_to_selected_directory));
    }); return true;
  }
  if (message.action === 'downloadLast') {
    chrome.storage.local.get('linkedinCollectorLastResult').then(async ({ linkedinCollectorLastResult: payload }) => {
      sendResponse(payload ? await savePayload(payload, 'linkedin-demand-leads', true) : { ok: false, error: 'Chưa có kết quả.' });
    }); return true;
  }
  if (message.action === 'checkDevBridge') {
    fetch('http://127.0.0.1:32145/health').then(async (response) => sendResponse({ ok: response.ok, ...(await response.json()) })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
