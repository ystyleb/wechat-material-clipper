// 微信公众号素材上传助手 - 内容脚本

(function() {
  'use strict';

  // 状态变量
  let showHoverButton = true;
  let askBeforeUpload = true;
  let batchMode = false;
  let selectedImages = new Map(); // URL -> img element

  // DOM 元素
  let hoverButton = null;
  let batchToolbar = null;
  let accountModal = null;
  let currentHoverImage = null;

  // 初始化
  init();

  async function init() {
    // 加载设置
    const settings = await chrome.storage.sync.get(['showHoverButton', 'askBeforeUpload']);
    showHoverButton = settings.showHoverButton !== false;
    askBeforeUpload = settings.askBeforeUpload !== false;

    // 创建悬浮按钮
    createHoverButton();

    // 创建批量工具栏
    createBatchToolbar();

    // 创建账号选择弹窗
    createAccountModal();

    // 监听消息
    chrome.runtime.onMessage.addListener(handleMessage);

    // 监听鼠标移动
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
  }

  function handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'TOGGLE_BATCH_MODE':
        toggleBatchMode();
        sendResponse({ success: true });
        break;

      case 'START_UPLOAD':
        // 从右键菜单触发的上传
        startUpload(message.imageUrl);
        sendResponse({ success: true });
        break;

      case 'UPLOAD_STATUS_UPDATED':
        updateUploadNotification(message);
        sendResponse({ success: true });
        break;

      case 'SETTINGS_UPDATED':
        chrome.storage.sync.get(['showHoverButton', 'askBeforeUpload']).then(settings => {
          showHoverButton = settings.showHoverButton !== false;
          askBeforeUpload = settings.askBeforeUpload !== false;
        });
        sendResponse({ success: true });
        break;
    }
    return true;
  }

  // 创建悬浮按钮
  function createHoverButton() {
    hoverButton = document.createElement('div');
    hoverButton.className = 'wechat-upload-hover-btn';
    hoverButton.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
      </svg>
      <span>上传</span>
    `;
    hoverButton.style.display = 'none';
    hoverButton.addEventListener('click', handleHoverButtonClick);
    document.body.appendChild(hoverButton);
  }

  // 创建批量工具栏
  function createBatchToolbar() {
    batchToolbar = document.createElement('div');
    batchToolbar.className = 'wechat-upload-batch-toolbar';
    batchToolbar.innerHTML = `
      <div class="wechat-batch-info">
        <span class="wechat-batch-count">已选择 <strong>0</strong> 张图片</span>
      </div>
      <div class="wechat-batch-actions">
        <button class="wechat-batch-btn wechat-batch-upload">上传选中图片</button>
        <button class="wechat-batch-btn wechat-batch-cancel">取消</button>
      </div>
    `;
    batchToolbar.style.display = 'none';

    batchToolbar.querySelector('.wechat-batch-upload').addEventListener('click', async () => {
      if (selectedImages.size === 0) {
        showNotification('请先选择图片', 'error');
        return;
      }
      // 收集选中图片的信息（URL 和元素引用）
      const imageInfoList = [];
      for (const [url, img] of selectedImages) {
        imageInfoList.push({ url, img });
      }
      startBatchUpload(imageInfoList);
    });
    batchToolbar.querySelector('.wechat-batch-cancel').addEventListener('click', () => toggleBatchMode(false));

    document.body.appendChild(batchToolbar);
  }

  // 创建账号选择弹窗
  function createAccountModal() {
    accountModal = document.createElement('div');
    accountModal.className = 'wechat-account-modal';
    accountModal.style.display = 'none';
    accountModal.innerHTML = `
      <div class="wechat-account-modal-content">
        <div class="wechat-account-modal-header">
          <h3>选择公众号</h3>
          <button class="wechat-account-modal-close">&times;</button>
        </div>
        <div class="wechat-account-list"></div>
        <div class="wechat-account-modal-footer">
          <label class="wechat-remember-choice">
            <input type="checkbox" id="wechat-remember">
            <span>记住选择，下次直接上传到此公众号</span>
          </label>
        </div>
      </div>
    `;

    accountModal.querySelector('.wechat-account-modal-close').addEventListener('click', closeAccountModal);
    accountModal.addEventListener('click', (e) => {
      if (e.target === accountModal) closeAccountModal();
    });

    document.body.appendChild(accountModal);
  }

  // 开始上传流程（单张或已处理好的数据）
  async function startUpload(imageUrls) {
    // 标准化为数组
    const urls = Array.isArray(imageUrls) ? imageUrls : [imageUrls];

    // 获取账号信息
    const { accounts, defaultAccountId, askBeforeUpload: shouldAsk } = await chrome.runtime.sendMessage({
      type: 'GET_ACCOUNTS'
    });

    if (accounts.length === 0) {
      showNotification('请先配置公众号', 'error');
      chrome.runtime.openOptionsPage();
      return;
    }

    // 如果只有一个账号或不需要询问，直接上传
    if (accounts.length === 1 || !shouldAsk) {
      const accountId = defaultAccountId || accounts[0].id;
      await doUpload(urls, accountId);
      return;
    }

    // 显示账号选择弹窗
    showAccountModal(accounts, defaultAccountId, urls);
  }

  // 批量上传流程（逐张处理，避免消息过大）
  async function startBatchUpload(imageInfoList) {
    // 获取账号信息
    const { accounts, defaultAccountId, askBeforeUpload: shouldAsk } = await chrome.runtime.sendMessage({
      type: 'GET_ACCOUNTS'
    });

    if (accounts.length === 0) {
      showNotification('请先配置公众号', 'error');
      chrome.runtime.openOptionsPage();
      return;
    }

    // 如果只有一个账号或不需要询问，直接上传
    if (accounts.length === 1 || !shouldAsk) {
      const accountId = defaultAccountId || accounts[0].id;
      await doBatchUpload(imageInfoList, accountId);
      return;
    }

    // 显示账号选择弹窗（批量模式）
    showAccountModalForBatch(accounts, defaultAccountId, imageInfoList);
  }

  // 显示账号选择弹窗
  function showAccountModal(accounts, defaultAccountId, imageUrls) {
    const listContainer = accountModal.querySelector('.wechat-account-list');

    listContainer.innerHTML = accounts.map(account => `
      <div class="wechat-account-option ${account.id === defaultAccountId ? 'is-default' : ''}" data-id="${account.id}">
        <div class="wechat-account-option-info">
          <span class="wechat-account-option-name">${account.name}</span>
          ${account.isDefault ? '<span class="wechat-account-option-badge">默认</span>' : ''}
        </div>
        <svg class="wechat-account-option-arrow" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
        </svg>
      </div>
    `).join('');

    // 绑定点击事件
    listContainer.querySelectorAll('.wechat-account-option').forEach(option => {
      option.addEventListener('click', async () => {
        const accountId = option.dataset.id;
        const remember = document.getElementById('wechat-remember').checked;

        closeAccountModal();

        // 如果选择记住，更新设置
        if (remember) {
          await chrome.storage.sync.set({ askBeforeUpload: false, defaultAccountId: accountId });
          // 更新账号的默认状态
          const settings = await chrome.storage.sync.get(['accounts']);
          const updatedAccounts = (settings.accounts || []).map(acc => ({
            ...acc,
            isDefault: acc.id === accountId
          }));
          await chrome.storage.sync.set({ accounts: updatedAccounts });
        }

        await doUpload(imageUrls, accountId);
      });
    });

    accountModal.style.display = 'flex';
  }

  // 关闭账号选择弹窗
  function closeAccountModal() {
    accountModal.style.display = 'none';
  }

  // 显示账号选择弹窗（批量模式）
  function showAccountModalForBatch(accounts, defaultAccountId, imageInfoList) {
    const listContainer = accountModal.querySelector('.wechat-account-list');

    listContainer.innerHTML = accounts.map(account => `
      <div class="wechat-account-option ${account.id === defaultAccountId ? 'is-default' : ''}" data-id="${account.id}">
        <div class="wechat-account-option-info">
          <span class="wechat-account-option-name">${account.name}</span>
          ${account.isDefault ? '<span class="wechat-account-option-badge">默认</span>' : ''}
        </div>
        <svg class="wechat-account-option-arrow" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
        </svg>
      </div>
    `).join('');

    // 绑定点击事件
    listContainer.querySelectorAll('.wechat-account-option').forEach(option => {
      option.addEventListener('click', async () => {
        const accountId = option.dataset.id;
        const remember = document.getElementById('wechat-remember').checked;

        closeAccountModal();

        // 如果选择记住，更新设置
        if (remember) {
          await chrome.storage.sync.set({ askBeforeUpload: false, defaultAccountId: accountId });
          const settings = await chrome.storage.sync.get(['accounts']);
          const updatedAccounts = (settings.accounts || []).map(acc => ({
            ...acc,
            isDefault: acc.id === accountId
          }));
          await chrome.storage.sync.set({ accounts: updatedAccounts });
        }

        await doBatchUpload(imageInfoList, accountId);
      });
    });

    accountModal.style.display = 'flex';
  }

  // 执行上传（用于单张或已处理好的数据）
  async function doUpload(imageUrls, accountId) {
    // 单张上传
    showNotification('正在上传...', 'info');

    try {
      const result = await chrome.runtime.sendMessage({
        type: 'UPLOAD_IMAGE',
        imageUrl: imageUrls[0],
        accountId
      });

      if (result.success) {
        showNotification('上传成功！', 'success', true);
      } else {
        showNotification(result.error || '上传失败', 'error', true);
      }
    } catch (error) {
      showNotification('上传失败：' + error.message, 'error', true);
    }
  }

  // 执行批量上传（逐张处理，避免消息过大）
  async function doBatchUpload(imageInfoList, accountId) {
    const uploadBtn = batchToolbar.querySelector('.wechat-batch-upload');
    if (uploadBtn) {
      uploadBtn.disabled = true;
      uploadBtn.textContent = '上传中...';
    }

    // 先显示队列信息
    showNotification(`${imageInfoList.length} 张图片已加入上传队列`, 'info');
    toggleBatchMode(false);

    // 第一步：先创建所有任务，让队列中显示所有待上传的图片
    const urls = imageInfoList.map(info => info.url);
    const createResult = await chrome.runtime.sendMessage({
      type: 'CREATE_BATCH_TASKS',
      imageUrls: urls,
      accountId
    });

    if (!createResult.success) {
      showNotification('创建上传任务失败', 'error', true);
      return;
    }

    const taskIds = createResult.taskIds;
    let successCount = 0;
    let failCount = 0;

    // 第二步：逐张获取图片数据并上传
    for (let i = 0; i < imageInfoList.length; i++) {
      const { img } = imageInfoList[i];
      const taskId = taskIds[i];

      try {
        // 获取图片数据（每次只处理一张，避免消息过大）
        const imageData = await getImageAsDataUrl(img);

        const result = await chrome.runtime.sendMessage({
          type: 'UPLOAD_TASK',
          taskId,
          imageData // 可能为 null，此时后台会使用原始 URL
        });

        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        console.error('上传失败:', error);
        failCount++;
      }
    }

    // 显示最终结果
    if (failCount === 0) {
      showNotification(`成功上传 ${successCount} 张图片`, 'success', true);
    } else {
      showNotification(`上传完成：${successCount} 成功，${failCount} 失败`, 'warning', true);
    }

    if (uploadBtn) {
      uploadBtn.disabled = false;
      uploadBtn.textContent = '上传选中图片';
    }
  }

  // 鼠标悬停处理
  function handleMouseOver(e) {
    if (!showHoverButton || batchMode) return;

    const img = e.target.closest('img');
    if (!img || !isValidImage(img)) return;

    currentHoverImage = img;
    positionHoverButton(img);
    hoverButton.style.display = 'flex';
  }

  function handleMouseOut(e) {
    if (!showHoverButton || batchMode) return;

    const relatedTarget = e.relatedTarget;
    if (relatedTarget === hoverButton || hoverButton.contains(relatedTarget)) {
      return;
    }

    if (e.target === currentHoverImage) {
      hoverButton.style.display = 'none';
      currentHoverImage = null;
    }
  }

  // 定位悬浮按钮
  function positionHoverButton(img) {
    const rect = img.getBoundingClientRect();
    hoverButton.style.top = `${window.scrollY + rect.top + 10}px`;
    hoverButton.style.left = `${window.scrollX + rect.right - hoverButton.offsetWidth - 10}px`;
  }

  // 悬浮按钮点击
  async function handleHoverButtonClick(e) {
    e.stopPropagation();
    e.preventDefault();

    if (!currentHoverImage) return;

    const imageUrl = getImageUrl(currentHoverImage);
    if (!imageUrl) {
      showNotification('无法获取图片地址', 'error');
      return;
    }

    hoverButton.style.display = 'none';

    // 尝试直接从页面获取图片数据（避免重复下载）
    const imageData = await getImageAsDataUrl(currentHoverImage);
    await startUpload(imageData || imageUrl);
  }

  // 切换批量模式
  function toggleBatchMode(enable) {
    batchMode = enable !== undefined ? enable : !batchMode;

    if (batchMode) {
      batchToolbar.style.display = 'flex';
      hoverButton.style.display = 'none';
      enableImageSelection();
    } else {
      batchToolbar.style.display = 'none';
      selectedImages.clear();
      disableImageSelection();
      updateBatchCount();
    }
  }

  // 启用图片选择
  function enableImageSelection() {
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      if (!isValidImage(img)) return;

      img.classList.add('wechat-selectable');

      // 创建选择覆盖层
      const overlay = document.createElement('div');
      overlay.className = 'wechat-select-overlay';
      overlay.innerHTML = `
        <div class="wechat-select-checkbox"></div>
      `;
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleImageSelection(img, overlay);
      });

      // 设置覆盖层位置
      const rect = img.getBoundingClientRect();
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;

      img._wechatOverlay = overlay;
      img.parentElement.style.position = 'relative';
      img.parentElement.insertBefore(overlay, img);
    });
  }

  // 禁用图片选择
  function disableImageSelection() {
    const overlays = document.querySelectorAll('.wechat-select-overlay');
    overlays.forEach(overlay => overlay.remove());

    const images = document.querySelectorAll('.wechat-selectable');
    images.forEach(img => {
      img.classList.remove('wechat-selectable', 'wechat-selected');
      delete img._wechatOverlay;
    });
  }

  // 切换图片选中状态
  function toggleImageSelection(img, overlay) {
    const imageUrl = getImageUrl(img);
    if (!imageUrl) return;

    if (selectedImages.has(imageUrl)) {
      selectedImages.delete(imageUrl);
      img.classList.remove('wechat-selected');
      overlay.classList.remove('wechat-checked');
    } else {
      selectedImages.set(imageUrl, img); // 保存图片元素引用
      img.classList.add('wechat-selected');
      overlay.classList.add('wechat-checked');
    }

    updateBatchCount();
  }

  // 更新选中数量
  function updateBatchCount() {
    const countEl = batchToolbar.querySelector('.wechat-batch-count strong');
    countEl.textContent = selectedImages.size;
  }

  // 判断是否为有效图片
  function isValidImage(img) {
    // 检查图片原始尺寸（至少 100x100）
    if (img.naturalWidth < 100 || img.naturalHeight < 100) return false;

    // 检查图片显示尺寸（至少 80x80，排除缩略图和小图标）
    const rect = img.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return false;

    // 检查是否有 src
    const src = img.src || img.dataset.src;
    if (!src) return false;

    // 排除 base64 小图标
    if (src.startsWith('data:') && src.length < 1000) return false;

    return true;
  }

  // 获取图片 URL
  function getImageUrl(img) {
    return img.src || img.dataset.src || img.currentSrc;
  }

  // 从页面图片直接获取 base64 数据（利用浏览器缓存，避免重复下载）
  async function getImageAsDataUrl(img) {
    try {
      // 确保图片已加载
      if (!img.complete || img.naturalWidth === 0) {
        return null;
      }

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      // 根据原始格式选择输出格式
      const src = img.src || '';
      let mimeType = 'image/png';
      if (src.includes('.jpg') || src.includes('.jpeg') || src.includes('image/jpeg')) {
        mimeType = 'image/jpeg';
      } else if (src.includes('.webp') || src.includes('image/webp')) {
        mimeType = 'image/webp';
      }

      return canvas.toDataURL(mimeType, 0.95);
    } catch (error) {
      // CORS 错误或其他问题，返回 null，后续会回退到 URL 下载方式
      console.log('无法直接获取图片数据，将使用下载方式:', error.message);
      return null;
    }
  }

  // 显示通知
  function showNotification(message, type = 'info', priority = false) {
    // 移除已有通知（优先级通知不会被普通通知覆盖）
    const existing = document.querySelector('.wechat-notification');
    if (existing) {
      // 如果现有通知是优先级通知（成功/错误），普通通知不覆盖
      if (existing.dataset.priority === 'true' && !priority) {
        return;
      }
      existing.remove();
    }

    const notification = document.createElement('div');
    notification.className = `wechat-notification wechat-notification-${type}`;
    notification.dataset.priority = priority ? 'true' : 'false';
    notification.innerHTML = `
      <span>${message}</span>
      <button class="wechat-notification-close">&times;</button>
    `;

    notification.querySelector('.wechat-notification-close').addEventListener('click', () => {
      notification.remove();
    });

    document.body.appendChild(notification);

    // 3秒后自动消失
    setTimeout(() => {
      notification.classList.add('wechat-notification-fadeout');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // 更新上传通知
  function updateUploadNotification(message) {
    const { queue } = message;

    // 如果有正在上传的任务，显示进度（非优先级，不覆盖成功/错误通知）
    const uploading = queue.find(item =>
      item.status === 'uploading' || item.status === 'downloading' || item.status === 'processing'
    );
    if (uploading) {
      showNotification(`正在上传到 ${uploading.accountName || '公众号'}... ${uploading.progress}%`, 'info', false);
    }
  }
})();
