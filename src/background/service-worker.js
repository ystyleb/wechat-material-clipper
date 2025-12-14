// 微信公众号素材上传助手 - 后台服务

// Token 缓存（按账号 ID 存储）
const tokenCache = new Map();

// 上传队列和历史记录（从 storage 加载）
let uploadQueue = [];
let uploadHistory = [];
let storageLoaded = false;

// 初始化：从 storage 加载数据
async function loadFromStorage() {
  if (storageLoaded) return;

  try {
    const data = await chrome.storage.local.get(['uploadQueue', 'uploadHistory']);
    uploadQueue = data.uploadQueue || [];
    uploadHistory = data.uploadHistory || [];

    // 清理过期的队列项（超过 1 小时的 pending 任务）
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    uploadQueue = uploadQueue.filter(item =>
      item.status !== 'pending' || item.createdAt > oneHourAgo
    );

    storageLoaded = true;
  } catch (error) {
    console.error('Failed to load from storage:', error);
  }
}

// 保存到 storage
async function saveToStorage() {
  try {
    await chrome.storage.local.set({
      uploadQueue,
      uploadHistory
    });
  } catch (error) {
    console.error('Failed to save to storage:', error);
  }
}

// 启动时加载数据
loadFromStorage();

// 注册右键菜单
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'uploadToWechat',
    title: '上传到公众号素材库',
    contexts: ['image']
  });

  chrome.contextMenus.create({
    id: 'batchSelectMode',
    title: '开启批量选择模式',
    contexts: ['page']
  });
});

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'uploadToWechat') {
    // 发送消息到 content script 让其处理（可能需要选择公众号）
    chrome.tabs.sendMessage(tab.id, {
      type: 'START_UPLOAD',
      imageUrl: info.srcUrl
    });
  } else if (info.menuItemId === 'batchSelectMode') {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_BATCH_MODE' });
  }
});

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // 保持消息通道开放
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'TEST_CONNECTION':
      return await testConnection(message.appId, message.appSecret);

    case 'GET_ACCOUNTS':
      return await getAccounts();

    case 'UPLOAD_IMAGE':
      return await uploadImage(message.imageUrl, message.accountId, sender.tab?.id);

    case 'UPLOAD_IMAGES':
      return await uploadImages(message.imageUrls, message.accountId, sender.tab?.id);

    case 'CREATE_BATCH_TASKS':
      return await createBatchTasks(message.imageUrls, message.accountId, sender.tab?.id);

    case 'UPLOAD_TASK':
      return await uploadTask(message.taskId, message.imageData, sender.tab?.id);

    case 'GET_UPLOAD_STATUS':
      await loadFromStorage();
      return { queue: uploadQueue, history: uploadHistory };

    case 'SETTINGS_UPDATED':
      // 清除所有 token 缓存
      tokenCache.clear();
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

// 获取账号列表
async function getAccounts() {
  const settings = await chrome.storage.sync.get(['accounts', 'defaultAccountId', 'askBeforeUpload']);
  return {
    accounts: settings.accounts || [],
    defaultAccountId: settings.defaultAccountId,
    askBeforeUpload: settings.askBeforeUpload !== false
  };
}

// 测试连接
async function testConnection(appId, appSecret) {
  try {
    await fetchAccessToken(appId, appSecret);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// 直接获取 access_token（不使用缓存，用于测试）
async function fetchAccessToken(appId, appSecret) {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.errcode) {
    throw new Error(`微信 API 错误: ${data.errmsg} (${data.errcode})`);
  }

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };
}

// 获取指定账号的 access_token
async function getAccessToken(accountId) {
  // 检查缓存
  const cached = tokenCache.get(accountId);
  if (cached && Date.now() < cached.expiresAt - 60000) {
    return cached.accessToken;
  }

  // 从存储中读取账号信息
  const settings = await chrome.storage.sync.get(['accounts']);
  const accounts = settings.accounts || [];
  const account = accounts.find(acc => acc.id === accountId);

  if (!account) {
    throw new Error('找不到指定的公众号配置');
  }

  const tokenData = await fetchAccessToken(account.appId, account.appSecret);

  // 缓存 token
  tokenCache.set(accountId, tokenData);

  return tokenData.accessToken;
}

// 获取默认账号
async function getDefaultAccount() {
  const settings = await chrome.storage.sync.get(['accounts', 'defaultAccountId']);
  const accounts = settings.accounts || [];

  if (accounts.length === 0) {
    throw new Error('请先配置公众号');
  }

  // 优先使用默认账号
  const defaultAccount = accounts.find(acc => acc.id === settings.defaultAccountId);
  return defaultAccount || accounts[0];
}

// 创建上传任务项
async function createUploadItem(imageUrl, accountId) {
  const uploadItem = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    url: imageUrl,
    accountId,
    status: 'pending',
    progress: 0,
    createdAt: Date.now()
  };

  // 获取账号名称
  if (!accountId) {
    const defaultAccount = await getDefaultAccount();
    uploadItem.accountId = defaultAccount.id;
    uploadItem.accountName = defaultAccount.name;
  } else {
    const settings = await chrome.storage.sync.get(['accounts']);
    const account = (settings.accounts || []).find(acc => acc.id === accountId);
    uploadItem.accountName = account?.name || '未知公众号';
  }

  return uploadItem;
}

// 处理单个上传任务
async function processUploadItem(uploadItem, tabId) {
  try {
    // 判断是否是 data URL（已从页面直接获取，无需下载）
    const isDataUrl = uploadItem.url.startsWith('data:');

    // 更新状态
    uploadItem.status = isDataUrl ? 'processing' : 'downloading';
    uploadItem.progress = isDataUrl ? 30 : 10;
    notifyUploadStatus(tabId);

    // 获取图片数据（data URL 直接转换，否则下载）
    const imageBlob = await downloadImage(uploadItem.url);
    uploadItem.progress = 40;
    notifyUploadStatus(tabId);

    // 更新状态为上传中
    uploadItem.status = 'uploading';
    uploadItem.progress = 50;
    notifyUploadStatus(tabId);

    // 获取 access_token
    const accessToken = await getAccessToken(uploadItem.accountId);

    // 上传到微信
    const result = await uploadToWechat(imageBlob, accessToken);
    uploadItem.progress = 100;
    uploadItem.status = 'success';
    uploadItem.mediaId = result.media_id;
    uploadItem.wechatUrl = result.url;
    notifyUploadStatus(tabId);

    // 移到历史记录
    moveToHistory(uploadItem);

    return { success: true, mediaId: result.media_id, url: result.url };
  } catch (error) {
    uploadItem.status = 'error';
    uploadItem.error = error.message;
    notifyUploadStatus(tabId);

    // 移到历史记录
    moveToHistory(uploadItem);

    return { success: false, error: error.message };
  }
}

// 上传单张图片
async function uploadImage(imageUrl, accountId, tabId) {
  await loadFromStorage();

  const uploadItem = await createUploadItem(imageUrl, accountId);
  uploadQueue.push(uploadItem);
  await saveToStorage();
  notifyUploadStatus(tabId);

  return await processUploadItem(uploadItem, tabId);
}

// 批量上传图片
async function uploadImages(imageUrls, accountId, tabId) {
  // 先创建所有上传任务并加入队列
  const uploadItems = [];
  for (const url of imageUrls) {
    const uploadItem = await createUploadItem(url, accountId);
    uploadItems.push(uploadItem);
    uploadQueue.push(uploadItem);
  }

  // 通知状态更新，显示所有待上传的图片
  notifyUploadStatus(tabId);

  // 逐个处理上传
  const results = [];
  for (const uploadItem of uploadItems) {
    const result = await processUploadItem(uploadItem, tabId);
    results.push(result);
  }

  return { success: true, results };
}

// 创建批量上传任务（只创建任务，不开始上传）
async function createBatchTasks(imageUrls, accountId, tabId) {
  await loadFromStorage();

  const taskIds = [];

  for (const url of imageUrls) {
    const uploadItem = await createUploadItem(url, accountId);
    uploadQueue.push(uploadItem);
    taskIds.push(uploadItem.id);
  }

  // 持久化保存
  await saveToStorage();

  // 通知状态更新，显示所有待上传的图片
  notifyUploadStatus(tabId);

  return { success: true, taskIds };
}

// 上传指定任务（使用已获取的图片数据）
async function uploadTask(taskId, imageData, tabId) {
  await loadFromStorage();

  // 找到对应的任务
  const uploadItem = uploadQueue.find(item => item.id === taskId);
  if (!uploadItem) {
    return { success: false, error: '任务不存在' };
  }

  // 如果提供了图片数据，保存原始 URL 后替换
  if (imageData) {
    uploadItem.originalUrl = uploadItem.url; // 保存原始 URL 用于历史记录
    uploadItem.url = imageData;
  }

  // 处理上传
  return await processUploadItem(uploadItem, tabId);
}

// 下载图片（或从 data URL 转换）
async function downloadImage(imageUrl) {
  // 如果是 data URL，直接转换为 blob，无需下载
  if (imageUrl.startsWith('data:')) {
    return dataUrlToBlob(imageUrl);
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error('图片下载失败');
  }
  return await response.blob();
}

// 将 data URL 转换为 Blob
function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// 上传到微信公众号
async function uploadToWechat(imageBlob, accessToken) {
  const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${accessToken}&type=image`;

  // 获取文件扩展名
  const mimeType = imageBlob.type || 'image/jpeg';
  const ext = mimeType.split('/')[1] || 'jpg';
  const filename = `image_${Date.now()}.${ext}`;

  // 创建 FormData
  const formData = new FormData();
  formData.append('media', imageBlob, filename);

  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });

  const data = await response.json();

  if (data.errcode) {
    throw new Error(`上传失败: ${data.errmsg} (${data.errcode})`);
  }

  return data;
}

// 移到历史记录
function moveToHistory(uploadItem) {
  // 从队列中移除
  const index = uploadQueue.findIndex(item => item.id === uploadItem.id);
  if (index !== -1) {
    uploadQueue.splice(index, 1);
  }

  // 创建精简的历史记录项（不保存 data URL，太大了）
  const historyItem = {
    id: uploadItem.id,
    url: uploadItem.originalUrl || uploadItem.url, // 优先使用原始 URL
    accountId: uploadItem.accountId,
    accountName: uploadItem.accountName,
    status: uploadItem.status,
    error: uploadItem.error,
    mediaId: uploadItem.mediaId,
    wechatUrl: uploadItem.wechatUrl,
    createdAt: uploadItem.createdAt
  };

  // 如果 URL 是 data URL，不保存到历史（占用太大）
  if (historyItem.url && historyItem.url.startsWith('data:')) {
    historyItem.url = null;
  }

  // 添加到历史记录
  uploadHistory.unshift(historyItem);

  // 只保留最近 50 条
  if (uploadHistory.length > 50) {
    uploadHistory = uploadHistory.slice(0, 50);
  }

  // 持久化保存
  saveToStorage();
}

// 通知上传状态更新
function notifyUploadStatus(tabId) {
  // 通知 popup
  chrome.runtime.sendMessage({
    type: 'UPLOAD_STATUS_UPDATED',
    queue: uploadQueue,
    history: uploadHistory
  }).catch(() => {}); // 忽略 popup 未打开的错误

  // 通知 content script
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'UPLOAD_STATUS_UPDATED',
      queue: uploadQueue,
      history: uploadHistory
    }).catch(() => {});
  }
}
