const STORAGE_PATH = 'freebuff2api/accounts.json';

function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function getStorageStatus() {
  if (!isBlobConfigured()) {
    return { configured: false, mode: 'unconfigured' };
  }
  return { configured: true, mode: 'vercel-blob' };
}

function normalizeAccount(account) {
  if (!account || typeof account !== 'object') return null;
  const authToken = String(account.authToken || '').trim();
  if (!authToken) return null;
  return {
    id: account.id || null,
    name: String(account.name || '未命名账号'),
    email: String(account.email || ''),
    authToken,
    tokenPreview: String(account.tokenPreview || ''),
    stats: account.stats && typeof account.stats === 'object'
      ? {
          total: Number(account.stats.total || 0),
          success: Number(account.stats.success || 0),
          failed: Number(account.stats.failed || 0),
          lastUsed: account.stats.lastUsed || null,
        }
      : { total: 0, success: 0, failed: 0, lastUsed: null },
  };
}

function normalizeAccounts(accounts) {
  if (!Array.isArray(accounts)) return [];
  return accounts.map(normalizeAccount).filter(Boolean);
}

async function getBlobSDK() {
  try {
    return require('@vercel/blob');
  } catch (error) {
    const wrapped = new Error('缺少 @vercel/blob 依赖，无法使用服务端账号池');
    wrapped.status = 500;
    throw wrapped;
  }
}

function toStorageError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readAccountsFromStorage() {
  if (!isBlobConfigured()) {
    throw toStorageError('当前运行环境未配置服务端账号池存储，请设置 BLOB_READ_WRITE_TOKEN', 503);
  }

  const { head } = await getBlobSDK();
  try {
    const blob = await head(STORAGE_PATH, { token: process.env.BLOB_READ_WRITE_TOKEN });
    const response = await fetch(blob.url, { cache: 'no-store' });
    if (!response.ok) {
      throw toStorageError(`读取账号池失败: HTTP ${response.status}`, 502);
    }
    const data = await response.json();
    return normalizeAccounts(data);
  } catch (error) {
    const message = String(error.message || '');
    if (error.status === 404 || message.includes('not found') || message.includes('NOT_FOUND')) {
      return [];
    }
    throw error;
  }
}

async function writeAccountsToStorage(accounts) {
  if (!isBlobConfigured()) {
    throw toStorageError('当前运行环境未配置服务端账号池存储，请设置 BLOB_READ_WRITE_TOKEN', 503);
  }

  const { put } = await getBlobSDK();
  const normalized = normalizeAccounts(accounts);
  await put(STORAGE_PATH, JSON.stringify(normalized), {
    access: 'private',
    addRandomSuffix: false,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return normalized;
}

module.exports = {
  getStorageStatus,
  isBlobConfigured,
  readAccountsFromStorage,
  writeAccountsToStorage,
  normalizeAccounts,
};

