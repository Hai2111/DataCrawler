const elements = {
  groups: document.querySelector('#groups'),
  groupTarget: document.querySelector('#group-target'),
  minimumPosts: document.querySelector('#minimum-posts'),
  checkpointExportEvery: document.querySelector('#checkpoint-export-every'),
  privacyMode: document.querySelector('#privacy-mode'),
  saveSelectedDirectory: document.querySelector('#save-selected-directory'),
  collectContacts: document.querySelector('#collect-contacts'),
  clickSeeMore: document.querySelector('#click-see-more'),
  collectComments: document.querySelector('#collect-comments'),
  rawSnapshot: document.querySelector('#raw-snapshot'),
  state: document.querySelector('#run-state'),
  status: document.querySelector('#status'),
  debugLog: document.querySelector('#debug-log'),
  logCount: document.querySelector('#log-count')
};

let latestDebugLog = [];

function inputUrls() {
  return [...new Set(elements.groups.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
}

function syncUrlCount() {
  elements.groupTarget.value = inputUrls().length;
}

function setStatus(message, kind = '') {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function formatLogEntry(entry) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('vi-VN', { hour12: false }) : '--:--:--';
  const details = Object.entries(entry)
    .filter(([key, value]) => !['sequence', 'timestamp', 'level', 'event'].includes(key) && value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(' ');
  return `${time} [${String(entry.level || 'info').toUpperCase()}] ${entry.event || 'event'}${details ? ` | ${details}` : ''}`;
}

function renderDebugLog(log = []) {
  latestDebugLog = Array.isArray(log) ? log : [];
  elements.logCount.textContent = `(${latestDebugLog.length})`;
  elements.debugLog.textContent = latestDebugLog.length
    ? latestDebugLog.map(formatLogEntry).join('\n')
    : 'Chưa có log.';
  elements.debugLog.scrollTop = elements.debugLog.scrollHeight;
}

function optionsFromForm() {
  const targetGroups = inputUrls();
  const groupTarget = targetGroups.length;
  return {
    target_groups: targetGroups,
    config: {
      session_group_target: groupTarget,
      discovery_candidate_limit: Math.max(20, groupTarget * 2),
      minimum_unique_posts_per_group: Number(elements.minimumPosts.value) || 100,
      checkpoint_export_every_posts: Math.max(0, Number(elements.checkpointExportEvery.value) || 0),
      export_after_each_group: true,
      saturation_rounds: 25,
      maximum_rounds_per_group: 2500,
      privacy_mode: elements.privacyMode.value,
      collect_public_contacts: elements.collectContacts.checked,
      demand_only_contacts: true,
      save_to_selected_directory: elements.saveSelectedDirectory.checked,
      click_see_more: elements.clickSeeMore.checked,
      collect_visible_comments: elements.collectComments.checked,
      collect_raw_snapshot: elements.rawSnapshot.checked
    }
  };
}

async function activeFacebookTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://www.facebook.com/')) {
    throw new Error('Hãy mở Facebook trong tab hiện tại rồi chạy lại.');
  }
  return tab;
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

async function storeDirectoryHandle(handle) {
  const database = await openDirectoryDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = database.transaction(DIRECTORY_STORE_NAME, 'readwrite')
        .objectStore(DIRECTORY_STORE_NAME).put(handle, DIRECTORY_HANDLE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function deleteDirectoryHandle() {
  const database = await openDirectoryDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = database.transaction(DIRECTORY_STORE_NAME, 'readwrite')
        .objectStore(DIRECTORY_STORE_NAME).delete(DIRECTORY_HANDLE_KEY);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function renderDirectoryName() {
  const { fbCollectorDirectoryName } = await chrome.storage.local.get('fbCollectorDirectoryName');
  const label = document.querySelector('#directory-name');
  label.textContent = fbCollectorDirectoryName
    ? `Đã chọn: ${fbCollectorDirectoryName}`
    : 'Chưa chọn — sẽ lưu vào Downloads/FacebookDemandCollector';
}

function renderState(state) {
  renderDebugLog(state?.debug_log || []);
  if (!state?.running) {
    elements.state.textContent = state?.phase === 'finished' ? 'Đã hoàn tất' : 'Sẵn sàng';
    elements.state.dataset.state = 'idle';
    return;
  }
  if (state.paused) {
    elements.state.textContent = 'Tạm dừng';
    elements.state.dataset.state = 'paused';
  } else {
    const queueTotal = state.mode === 'url_auto' ? state.target_groups?.length || 0 : state.config.session_group_target;
    elements.state.textContent = `Đang quét URL ${Math.min(state.current_index + 1, queueTotal)}/${queueTotal}`;
    elements.state.dataset.state = 'running';
  }
  const url = state.target_groups?.[state.current_index];
  const key = url ? new URL(url).pathname.split('/')[2] : null;
  const partial = key ? state.partial_results?.[key] : null;
  const merged = { ...(state.attempt_results || {}), ...(state.partial_results || {}) };
  const totalPosts = Object.values(merged).reduce((sum, group) => sum + (group.posts?.length || 0), 0);
  const queueTotal = state.mode === 'url_auto' ? state.target_groups?.length || 0 : state.config.session_group_target;
  const processedUrls = Object.keys(state.attempt_results || {}).length;
  const totalTarget = state.config.minimum_unique_posts_per_group * queueTotal;
  setStatus(`Group đang quét: ${url || 'đang hoàn tất'}\nBài group hiện tại: ${partial?.posts?.length || 0}/${state.config.minimum_unique_posts_per_group}\nTổng đã lưu: ${totalPosts}/${totalTarget} bài\nURL đã xử lý: ${processedUrls}/${queueTotal}\nGroup đủ mục tiêu: ${Object.keys(state.group_results || {}).length}/${queueTotal}\nSố lần phục hồi group hiện tại: ${partial?.recovery_count || 0}`);
}

async function loadState() {
  const response = await chrome.runtime.sendMessage({ action: 'getBatchState' });
  const settings = response.settings;
  elements.groups.value = (settings.target_groups || []).join('\n');
  syncUrlCount();
  elements.minimumPosts.value = settings.config?.minimum_unique_posts_per_group || 100;
  elements.checkpointExportEvery.value = settings.config?.checkpoint_export_every_posts ?? 100;
  elements.privacyMode.value = settings.config?.privacy_mode || 'contacts_only';
  elements.saveSelectedDirectory.checked = settings.config?.save_to_selected_directory !== false;
  elements.collectContacts.checked = settings.config?.collect_public_contacts !== false;
  elements.clickSeeMore.checked = settings.config?.click_see_more !== false;
  elements.collectComments.checked = settings.config?.collect_visible_comments !== false;
  elements.rawSnapshot.checked = settings.config?.collect_raw_snapshot === true;
  document.querySelector('#download-last').disabled = !response.has_last_result;
  renderState(response.state);
  await renderDirectoryName();
  if (!response.state?.running && response.last_export?.ok) {
    const destination = response.last_export.destination === 'selected_directory'
      ? `${response.last_export.directory_name}/${response.last_export.filename}`
      : response.last_export.folder;
    setStatus(`Lần xuất gần nhất: ${destination}`, 'success');
  }
}

elements.groups.addEventListener('input', syncUrlCount);

document.querySelector('#select-directory').addEventListener('click', async () => {
  try {
    if (!window.showDirectoryPicker) throw new Error('Chrome hiện tại không hỗ trợ chọn thư mục từ popup extension.');
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'facebook-demand-export' });
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('Chưa được cấp quyền ghi vào thư mục.');
    await storeDirectoryHandle(handle);
    await chrome.storage.local.set({ fbCollectorDirectoryName: handle.name });
    elements.saveSelectedDirectory.checked = true;
    await renderDirectoryName();
    setStatus(`Đã chọn thư mục: ${handle.name}`, 'success');
  } catch (error) {
    if (error.name !== 'AbortError') setStatus(error.message, 'error');
  }
});

document.querySelector('#clear-directory').addEventListener('click', async () => {
  await deleteDirectoryHandle();
  await chrome.storage.local.remove('fbCollectorDirectoryName');
  await renderDirectoryName();
  setStatus('Đã bỏ thư mục riêng; kết quả sẽ lưu trong Downloads/FacebookDemandCollector.', 'success');
});

document.querySelector('#start').addEventListener('click', async () => {
  try {
    const tab = await activeFacebookTab();
    setStatus('Đang khởi tạo phiên tự động…');
    const response = await chrome.runtime.sendMessage({
      action: 'startUrlSession', tab_id: tab.id, options: optionsFromForm()
    });
    if (!response.ok) throw new Error(response.error);
    renderState(response.state);
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

document.querySelector('#pause').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ action: 'pauseBatch' });
  if (!response.ok) return setStatus(response.error, 'error');
  renderState(response.state);
});

document.querySelector('#resume').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ action: 'resumeBatch' });
  if (!response.ok) return setStatus(response.error, 'error');
  renderState(response.state);
});

document.querySelector('#stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'stopBatch' });
  elements.state.textContent = 'Đã dừng';
  elements.state.dataset.state = 'idle';
  setStatus('Đã dừng và xuất dữ liệu đã thu được.', 'success');
});

document.querySelector('#download-last').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ action: 'downloadLastResult' });
  const destination = response.destination === 'selected_directory'
    ? `${response.directory_name}/${response.filename}`
    : response.folder;
  setStatus(response.ok ? `Đã lưu: ${destination}` : response.error, response.ok ? 'success' : 'error');
});

document.querySelector('#export-now').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ action: 'exportRunningCheckpoint' });
  const destination = response.destination === 'selected_directory'
    ? `${response.directory_name}/${response.filename}`
    : response.folder;
  setStatus(
    response.ok
      ? `Đã xuất ${response.unique_post_count} bài vào ${destination}. Tiến trình vẫn tiếp tục.`
      : response.error,
    response.ok ? 'success' : 'error'
  );
});

document.querySelector('#copy-log').addEventListener('click', async () => {
  const text = latestDebugLog.map(formatLogEntry).join('\n');
  if (!text) return setStatus('Chưa có log để sao chép.', 'error');
  await navigator.clipboard.writeText(text);
  setStatus(`Đã sao chép ${latestDebugLog.length} dòng log.`, 'success');
});

document.querySelector('#clear-log').addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ action: 'clearDebugLog' });
  if (!response.ok) return setStatus(response.error, 'error');
  renderState(response.state);
  setStatus('Đã xóa nhật ký debug.', 'success');
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.fbCollectorState) return;
  renderState(changes.fbCollectorState.newValue || null);
});

loadState().catch((error) => setStatus(error.message, 'error'));
