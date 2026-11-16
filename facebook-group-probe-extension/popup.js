const elements = {
  groups: document.querySelector('#groups'),
  groupTarget: document.querySelector('#group-target'),
  minimumPosts: document.querySelector('#minimum-posts'),
  privacyMode: document.querySelector('#privacy-mode'),
  saveSelectedDirectory: document.querySelector('#save-selected-directory'),
  collectContacts: document.querySelector('#collect-contacts'),
  clickSeeMore: document.querySelector('#click-see-more'),
  collectComments: document.querySelector('#collect-comments'),
  rawSnapshot: document.querySelector('#raw-snapshot'),
  state: document.querySelector('#run-state'),
  status: document.querySelector('#status')
};

function setStatus(message, kind = '') {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}

function optionsFromForm() {
  const groupTarget = Number(elements.groupTarget.value) || 10;
  return {
    target_groups: elements.groups.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    config: {
      session_group_target: groupTarget,
      discovery_candidate_limit: Math.max(20, groupTarget * 2),
      minimum_unique_posts_per_group: Number(elements.minimumPosts.value) || 100,
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
  if (!state?.running) {
    elements.state.textContent = state?.phase === 'finished' ? 'Đã hoàn tất' : 'Sẵn sàng';
    elements.state.dataset.state = 'idle';
    return;
  }
  if (state.paused) {
    elements.state.textContent = 'Tạm dừng';
    elements.state.dataset.state = 'paused';
  } else {
    elements.state.textContent = `Đang quét ${Object.keys(state.group_results || {}).length}/${state.config.session_group_target}`;
    elements.state.dataset.state = 'running';
  }
  const url = state.target_groups?.[state.current_index];
  const key = url ? new URL(url).pathname.split('/')[2] : null;
  const partial = key ? state.partial_results?.[key] : null;
  setStatus(`Group đang quét: ${url || 'đang hoàn tất'}\nCheckpoint: ${partial?.posts?.length || 0}/${state.config.minimum_unique_posts_per_group} bài\nGroup đủ dữ liệu: ${Object.keys(state.group_results || {}).length}/${state.config.session_group_target}`);
}

async function loadState() {
  const response = await chrome.runtime.sendMessage({ action: 'getBatchState' });
  const settings = response.settings;
  elements.groups.value = (settings.target_groups || []).join('\n');
  elements.groupTarget.value = settings.config?.session_group_target || 10;
  elements.minimumPosts.value = settings.config?.minimum_unique_posts_per_group || 100;
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

loadState().catch((error) => setStatus(error.message, 'error'));
