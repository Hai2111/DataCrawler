const $ = (selector) => document.querySelector(selector);
const DIRECTORY_DB_NAME = 'linkedin-demand-collector-files';
const DIRECTORY_STORE_NAME = 'handles';
const DIRECTORY_HANDLE_KEY = 'export-directory';
let pollTimer = null;

function inputUrls() { return [...new Set($('#urls').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))]; }
function syncCount() { $('#url-count').value = inputUrls().length; }
function setMessage(message) { $('#status').textContent = message; }

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

async function storeHandle(handle) {
  const database = await openDirectoryDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = database.transaction(DIRECTORY_STORE_NAME, 'readwrite').objectStore(DIRECTORY_STORE_NAME).put(handle, DIRECTORY_HANDLE_KEY);
      request.onsuccess = resolve; request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

async function deleteHandle() {
  const database = await openDirectoryDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = database.transaction(DIRECTORY_STORE_NAME, 'readwrite').objectStore(DIRECTORY_STORE_NAME).delete(DIRECTORY_HANDLE_KEY);
      request.onsuccess = resolve; request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

function options() {
  return {
    target_urls: inputUrls(),
    config: {
      minimum_valid_posts_per_source: Number($('#post-target').value) || 100,
      checkpoint_export_every_posts: Math.max(0, Number($('#checkpoint-every').value) || 0),
      privacy_mode: $('#privacy').value,
      collect_public_contacts: $('#contacts').checked,
      demand_only_contacts: true,
      save_to_selected_directory: $('#selected-dir').checked,
      developer_mode: $('#developer-mode').checked
    }
  };
}

function renderLogs(logs = []) {
  $('#log-count').textContent = `(${logs.length})`;
  $('#logs').textContent = logs.length ? logs.map((entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString('vi-VN', { hour12: false });
    const detail = Object.entries(entry).filter(([key]) => !['timestamp', 'sequence', 'level', 'event'].includes(key)).map(([key, value]) => `${key}=${value}`).join(' ');
    return `${time} [${entry.level}] ${entry.event}${detail ? ` | ${detail}` : ''}`;
  }).join('\n') : 'Chưa có log.';
}

function renderState(state) {
  renderLogs(state?.debug_log || []);
  if (!state?.running) { $('#run-state').textContent = state?.finished_at ? 'Đã hoàn tất' : 'Sẵn sàng'; return; }
  $('#run-state').textContent = state.paused ? 'Tạm dừng' : `Đang quét ${state.current_index + 1}/${state.target_urls.length}`;
  const sourceUrl = state.target_urls[state.current_index];
  const partial = Object.values(state.partial_results || {}).find((item) => item.source_url === sourceUrl);
  const totalValid = Object.values({ ...state.results, ...state.partial_results }).reduce((sum, item) => sum + (item.posts || []).filter((post) => post.validation?.is_valid).length, 0);
  setMessage(`URL: ${sourceUrl || 'đang hoàn tất'}\nVALID nguồn hiện tại: ${partial?.valid_post_count || 0}/${state.config.minimum_valid_posts_per_source}\nPARTIAL đang ghép: ${partial?.partial_candidate_count || 0}\nLỗi ổn định: ${partial?.invalid_observation_count || 0}\nTổng VALID: ${totalValid}\nPhục hồi: ${partial?.recovery_count || 0}`);
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ action: 'getState' });
  renderState(response.state);
  $('#download-last').disabled = !response.has_last_result;
  if (!$('#urls').dataset.loaded) {
    $('#urls').value = (response.settings?.target_urls || []).join('\n');
    $('#post-target').value = response.settings?.config?.minimum_valid_posts_per_source || 100;
    $('#checkpoint-every').value = response.settings?.config?.checkpoint_export_every_posts ?? 100;
    $('#privacy').value = response.settings?.config?.privacy_mode || 'contacts_only';
    $('#urls').dataset.loaded = '1'; syncCount();
  }
}

$('#urls').addEventListener('input', syncCount);
$('#choose-dir').addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'linkedin-demand-export' });
    if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Chưa có quyền ghi thư mục.');
    await storeHandle(handle); await chrome.storage.local.set({ linkedinCollectorDirectoryName: handle.name });
    $('#dir-status').textContent = `Đã chọn: ${handle.name}`; $('#selected-dir').checked = true;
  } catch (error) { if (error.name !== 'AbortError') setMessage(error.message); }
});
$('#clear-dir').addEventListener('click', async () => { await deleteHandle(); await chrome.storage.local.remove('linkedinCollectorDirectoryName'); $('#dir-status').textContent = 'Sẽ dùng Downloads/LinkedInDemandCollector'; });
$('#start').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.startsWith('https://www.linkedin.com/')) throw new Error('Hãy mở LinkedIn trong tab hiện tại.');
    const settings = options(); await chrome.runtime.sendMessage({ action: 'saveSettings', settings });
    const response = await chrome.runtime.sendMessage({ action: 'startSession', tab_id: tab.id, options: settings });
    if (!response.ok) throw new Error(response.error); renderState(response.state);
  } catch (error) { setMessage(error.message); }
});
$('#pause').addEventListener('click', async () => renderState((await chrome.runtime.sendMessage({ action: 'pause' })).state));
$('#resume').addEventListener('click', async () => renderState((await chrome.runtime.sendMessage({ action: 'resume' })).state));
$('#stop').addEventListener('click', async () => { const response = await chrome.runtime.sendMessage({ action: 'stop' }); setMessage(response.ok ? `Đã dừng và xuất: ${response.export_result?.filename || response.export_result?.folder}` : response.error); await refresh(); });
$('#checkpoint').addEventListener('click', async () => { const response = await chrome.runtime.sendMessage({ action: 'exportCheckpoint' }); setMessage(response.ok ? `Đã xuất checkpoint: ${response.filename || response.folder}` : response.error); });
$('#download-last').addEventListener('click', async () => { const response = await chrome.runtime.sendMessage({ action: 'downloadLast' }); setMessage(response.ok ? `Đã tải: ${response.filename || response.folder}` : response.error); });

chrome.storage.local.get('linkedinCollectorDirectoryName').then(({ linkedinCollectorDirectoryName: name }) => { $('#dir-status').textContent = name ? `Đã chọn: ${name}` : 'Chưa chọn — dùng Downloads/LinkedInDemandCollector'; });
chrome.runtime.sendMessage({ action: 'checkDevBridge' }).then((response) => { $('#bridge-status').textContent = response.ok ? 'Dev log bridge: đã kết nối' : 'Dev log bridge: chưa kết nối'; });
refresh(); pollTimer = setInterval(refresh, 1200); window.addEventListener('unload', () => clearInterval(pollTimer));
