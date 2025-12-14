// 微信公众号素材上传助手 - 设置页面

let accounts = [];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadSettings();
  bindEvents();
}

function bindEvents() {
  // 添加公众号按钮
  document.getElementById('addAccountBtn').addEventListener('click', () => openModal());

  // 关闭弹窗
  document.getElementById('closeModalBtn').addEventListener('click', closeModal);
  document.getElementById('accountModal').addEventListener('click', (e) => {
    if (e.target.id === 'accountModal') closeModal();
  });

  // 表单提交
  document.getElementById('accountForm').addEventListener('submit', saveAccount);

  // 测试连接
  document.getElementById('testBtn').addEventListener('click', testConnection);

  // 保存通用设置
  document.getElementById('saveGeneralBtn').addEventListener('click', saveGeneralSettings);
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    'accounts',
    'defaultAccountId',
    'showHoverButton',
    'askBeforeUpload'
  ]);

  accounts = settings.accounts || [];

  // 兼容旧版本配置（单公众号迁移到多公众号）
  if (accounts.length === 0) {
    const oldSettings = await chrome.storage.sync.get(['appId', 'appSecret']);
    if (oldSettings.appId && oldSettings.appSecret) {
      const migratedAccount = {
        id: Date.now().toString(),
        name: '我的公众号',
        appId: oldSettings.appId,
        appSecret: oldSettings.appSecret,
        isDefault: true
      };
      accounts.push(migratedAccount);
      await chrome.storage.sync.set({
        accounts,
        defaultAccountId: migratedAccount.id
      });
      // 清除旧配置
      await chrome.storage.sync.remove(['appId', 'appSecret']);
    }
  }

  renderAccountList();

  // 通用设置
  document.getElementById('showHoverButton').checked = settings.showHoverButton !== false;
  document.getElementById('askBeforeUpload').checked = settings.askBeforeUpload !== false;
}

function renderAccountList() {
  const container = document.getElementById('accountList');

  if (accounts.length === 0) {
    container.innerHTML = '<p class="empty-text">暂未添加公众号，点击上方按钮添加</p>';
    return;
  }

  container.innerHTML = accounts.map(account => `
    <div class="account-item ${account.isDefault ? 'is-default' : ''}" data-id="${account.id}">
      <div class="account-info">
        <div class="account-name">
          ${account.name}
          ${account.isDefault ? '<span class="badge">默认</span>' : ''}
        </div>
        <div class="account-appid">AppID: ${maskAppId(account.appId)}</div>
      </div>
      <div class="account-actions">
        <button class="edit-btn" data-id="${account.id}">编辑</button>
        <button class="delete-btn" data-id="${account.id}">删除</button>
      </div>
    </div>
  `).join('');

  // 绑定编辑按钮事件
  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => editAccount(btn.dataset.id));
  });

  // 绑定删除按钮事件
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteAccount(btn.dataset.id));
  });
}

function maskAppId(appId) {
  if (appId.length <= 8) return appId;
  return appId.slice(0, 4) + '****' + appId.slice(-4);
}

function openModal(account = null) {
  const modal = document.getElementById('accountModal');
  const title = document.getElementById('modalTitle');
  const form = document.getElementById('accountForm');

  if (account) {
    title.textContent = '编辑公众号';
    document.getElementById('accountId').value = account.id;
    document.getElementById('accountName').value = account.name;
    document.getElementById('appId').value = account.appId;
    document.getElementById('appSecret').value = account.appSecret;
    document.getElementById('isDefault').checked = account.isDefault;
  } else {
    title.textContent = '添加公众号';
    form.reset();
    document.getElementById('accountId').value = '';
    // 如果没有任何公众号，默认勾选"设为默认"
    document.getElementById('isDefault').checked = accounts.length === 0;
  }

  hideModalMessage();
  modal.classList.remove('hidden');
}

function closeModal() {
  document.getElementById('accountModal').classList.add('hidden');
}

async function saveAccount(e) {
  e.preventDefault();

  const id = document.getElementById('accountId').value;
  const name = document.getElementById('accountName').value.trim();
  const appId = document.getElementById('appId').value.trim();
  const appSecret = document.getElementById('appSecret').value.trim();
  const isDefault = document.getElementById('isDefault').checked;

  if (!name || !appId || !appSecret) {
    showModalMessage('请填写所有必填项', 'error');
    return;
  }

  const account = {
    id: id || Date.now().toString(),
    name,
    appId,
    appSecret,
    isDefault
  };

  // 如果设为默认，取消其他账号的默认状态
  if (isDefault) {
    accounts.forEach(acc => acc.isDefault = false);
  }

  if (id) {
    // 编辑现有账号
    const index = accounts.findIndex(acc => acc.id === id);
    if (index !== -1) {
      accounts[index] = account;
    }
  } else {
    // 添加新账号
    accounts.push(account);
  }

  // 确保至少有一个默认账号
  if (!accounts.some(acc => acc.isDefault) && accounts.length > 0) {
    accounts[0].isDefault = true;
  }

  const defaultAccount = accounts.find(acc => acc.isDefault);

  await chrome.storage.sync.set({
    accounts,
    defaultAccountId: defaultAccount?.id || null
  });

  renderAccountList();
  closeModal();
  showMessage('公众号配置已保存', 'success');

  // 通知其他脚本
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
}

function editAccount(id) {
  const account = accounts.find(acc => acc.id === id);
  if (account) {
    openModal(account);
  }
}

async function deleteAccount(id) {
  if (!confirm('确定要删除这个公众号配置吗？')) return;

  accounts = accounts.filter(acc => acc.id !== id);

  // 如果删除的是默认账号，将第一个设为默认
  if (accounts.length > 0 && !accounts.some(acc => acc.isDefault)) {
    accounts[0].isDefault = true;
  }

  const defaultAccount = accounts.find(acc => acc.isDefault);

  await chrome.storage.sync.set({
    accounts,
    defaultAccountId: defaultAccount?.id || null
  });

  renderAccountList();
  showMessage('公众号已删除', 'success');

  // 通知其他脚本
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
}

async function testConnection() {
  const appId = document.getElementById('appId').value.trim();
  const appSecret = document.getElementById('appSecret').value.trim();

  if (!appId || !appSecret) {
    showModalMessage('请先填写 AppID 和 AppSecret', 'error');
    return;
  }

  showModalMessage('正在测试连接...', 'success');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'TEST_CONNECTION',
      appId,
      appSecret
    });

    if (response.success) {
      showModalMessage('连接成功！', 'success');
    } else {
      showModalMessage('连接失败：' + response.error, 'error');
    }
  } catch (error) {
    showModalMessage('测试失败：' + error.message, 'error');
  }
}

async function saveGeneralSettings() {
  const showHoverButton = document.getElementById('showHoverButton').checked;
  const askBeforeUpload = document.getElementById('askBeforeUpload').checked;

  await chrome.storage.sync.set({
    showHoverButton,
    askBeforeUpload
  });

  showMessage('通用设置已保存', 'success');

  // 通知其他脚本
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
}

function showMessage(text, type) {
  const messageEl = document.getElementById('message');
  messageEl.textContent = text;
  messageEl.className = 'message ' + type;

  setTimeout(() => {
    messageEl.className = 'message hidden';
  }, 3000);
}

function showModalMessage(text, type) {
  const messageEl = document.getElementById('modalMessage');
  messageEl.textContent = text;
  messageEl.className = 'message ' + type;
}

function hideModalMessage() {
  const messageEl = document.getElementById('modalMessage');
  messageEl.className = 'message hidden';
}
