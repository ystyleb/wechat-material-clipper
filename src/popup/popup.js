// 微信公众号素材上传助手 - 弹出页面

let accounts = [];
let currentAccountId = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // 显示版本号
  const manifest = chrome.runtime.getManifest();
  document.getElementById('versionText').textContent = `v${manifest.version}`;

  // 加载账号列表
  await loadAccounts();

  // 加载上传状态
  loadUploadStatus();

  // 绑定事件
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('goSettingsBtn').addEventListener('click', openSettings);
  document.getElementById('batchModeBtn').addEventListener('click', toggleBatchMode);
  document.getElementById('switchAccountBtn').addEventListener('click', toggleAccountDropdown);

  // 点击其他地方关闭下拉菜单
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.current-account') && !e.target.closest('.account-dropdown')) {
      document.getElementById('accountDropdown').classList.add('hidden');
    }
  });

  // 监听状态更新
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'UPLOAD_STATUS_UPDATED') {
      renderUploadStatus(message.queue, message.history);
    }
  });
}

async function loadAccounts() {
  const settings = await chrome.storage.sync.get(['accounts', 'defaultAccountId']);
  accounts = settings.accounts || [];
  currentAccountId = settings.defaultAccountId;

  if (accounts.length === 0) {
    document.getElementById('notConfigured').classList.remove('hidden');
    document.getElementById('mainContent').classList.add('hidden');
    return;
  }

  // 找到当前账号
  let currentAccount = accounts.find(acc => acc.id === currentAccountId);
  if (!currentAccount) {
    currentAccount = accounts.find(acc => acc.isDefault) || accounts[0];
    currentAccountId = currentAccount.id;
  }

  // 更新显示
  document.getElementById('accountNameText').textContent = currentAccount.name;

  // 如果只有一个账号，隐藏切换按钮的箭头
  if (accounts.length === 1) {
    document.getElementById('switchAccountBtn').querySelector('svg').style.display = 'none';
  }

  // 渲染下拉菜单
  renderAccountDropdown();
}

function renderAccountDropdown() {
  const container = document.getElementById('accountDropdownList');

  container.innerHTML = accounts.map(account => `
    <div class="account-dropdown-item ${account.id === currentAccountId ? 'active' : ''}" data-id="${account.id}">
      <span class="account-dropdown-name">${account.name}</span>
      ${account.isDefault ? '<span class="account-dropdown-badge">默认</span>' : ''}
      ${account.id === currentAccountId ? `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="#07c160">
          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
        </svg>
      ` : ''}
    </div>
  `).join('');

  // 绑定点击事件
  container.querySelectorAll('.account-dropdown-item').forEach(item => {
    item.addEventListener('click', () => selectAccount(item.dataset.id));
  });
}

function toggleAccountDropdown() {
  if (accounts.length <= 1) return;

  const dropdown = document.getElementById('accountDropdown');
  dropdown.classList.toggle('hidden');
}

async function selectAccount(accountId) {
  if (accountId === currentAccountId) {
    document.getElementById('accountDropdown').classList.add('hidden');
    return;
  }

  currentAccountId = accountId;
  const account = accounts.find(acc => acc.id === accountId);

  // 更新显示
  document.getElementById('accountNameText').textContent = account.name;

  // 保存选择
  await chrome.storage.sync.set({ defaultAccountId: accountId });

  // 更新下拉菜单
  renderAccountDropdown();

  // 关闭下拉菜单
  document.getElementById('accountDropdown').classList.add('hidden');
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

async function toggleBatchMode() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_BATCH_MODE' });
      window.close();
    }
  } catch (error) {
    console.error('Failed to toggle batch mode:', error);
  }
}

async function loadUploadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_UPLOAD_STATUS' });
    renderUploadStatus(response.queue, response.history);
  } catch (error) {
    console.error('Failed to load upload status:', error);
  }
}

function renderUploadStatus(queue, history) {
  renderQueue(queue);
  renderHistory(history);
}

function renderQueue(queue) {
  const container = document.getElementById('uploadQueue');

  if (!queue || queue.length === 0) {
    container.innerHTML = '<p class="empty-text">暂无上传任务</p>';
    return;
  }

  container.innerHTML = queue.map(item => `
    <div class="list-item">
      <img class="list-item-thumb" src="${item.url}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><rect fill=%22%23f0f0f0%22 width=%2240%22 height=%2240%22/></svg>'">
      <div class="list-item-info">
        <div class="list-item-name">${getFileName(item.url)}</div>
        <div class="list-item-meta">
          <span class="list-item-account">${item.accountName || '未知公众号'}</span>
          <span class="list-item-status ${item.status}">${getStatusText(item.status)}</span>
        </div>
        ${['uploading', 'downloading', 'processing'].includes(item.status) ? `
          <div class="progress-bar">
            <div class="progress-bar-fill" style="width: ${item.progress}%"></div>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

function renderHistory(history) {
  const container = document.getElementById('uploadHistory');

  if (!history || history.length === 0) {
    container.innerHTML = '<p class="empty-text">暂无上传记录</p>';
    return;
  }

  // 只显示最近 5 条
  const recentHistory = history.slice(0, 5);
  const placeholderImg = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><rect fill=%22%23f0f0f0%22 width=%2240%22 height=%2240%22/></svg>';

  container.innerHTML = recentHistory.map(item => `
    <div class="list-item">
      <img class="list-item-thumb" src="${item.url || placeholderImg}" alt="" onerror="this.src='${placeholderImg}'">
      <div class="list-item-info">
        <div class="list-item-name">${getFileName(item.url) || '图片'}</div>
        <div class="list-item-meta">
          <span class="list-item-account">${item.accountName || '未知公众号'}</span>
          <span class="list-item-status ${item.status}">
            ${item.status === 'success' ? '成功' : '失败'}
          </span>
          ${item.status === 'error' && item.error ? `
            <span class="list-item-error-icon" title="${escapeHtml(item.error)}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
            </span>
          ` : ''}
        </div>
      </div>
      ${item.status === 'success' && item.mediaId ? `
        <button class="list-item-action" onclick="copyMediaId('${item.mediaId}')">复制ID</button>
      ` : ''}
    </div>
  `).join('');
}

function getFileName(url) {
  if (!url) return null;

  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    if (filename && filename.length > 20) {
      return filename.slice(0, 17) + '...';
    }
    return filename || '图片';
  } catch {
    return '图片';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getStatusText(status) {
  const statusMap = {
    pending: '等待中',
    processing: '处理中',
    downloading: '下载中',
    uploading: '上传中',
    success: '上传成功',
    error: '上传失败'
  };
  return statusMap[status] || status;
}

// 复制 media_id
window.copyMediaId = async function(mediaId) {
  try {
    await navigator.clipboard.writeText(mediaId);
    // 简单提示
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1500);
  } catch (error) {
    console.error('Failed to copy:', error);
  }
};
