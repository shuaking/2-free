const { sql } = require('@vercel/postgres');

const STORAGE_KEY = 'default';

function isPostgresConfigured() {
  return Boolean(
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING,
  );
}

function getStorageStatus() {
  if (!isPostgresConfigured()) {
    return { configured: false, mode: 'unconfigured' };
  }
  return { configured: true, mode: 'vercel-postgres' };
}

function toStorageError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
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

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS freebuff_account_pool (
      storage_key TEXT PRIMARY KEY,
      accounts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function readAccountsFromStorage() {
  if (!isPostgresConfigured()) {
    throw toStorageError('当前运行环境未配置服务端账号池存储，请配置 Vercel Postgres', 503);
  }

  await ensureTable();
  const result = await sql`
    SELECT accounts_json
    FROM freebuff_account_pool
    WHERE storage_key = ${STORAGE_KEY}
    LIMIT 1
  `;

  if (!result.rows.length) return [];
  return normalizeAccounts(result.rows[0].accounts_json);
}

async function writeAccountsToStorage(accounts) {
  if (!isPostgresConfigured()) {
    throw toStorageError('当前运行环境未配置服务端账号池存储，请配置 Vercel Postgres', 503);
  }

  await ensureTable();
  const normalized = normalizeAccounts(accounts);
  await sql`
    INSERT INTO freebuff_account_pool (storage_key, accounts_json, updated_at)
    VALUES (${STORAGE_KEY}, ${JSON.stringify(normalized)}::jsonb, NOW())
    ON CONFLICT (storage_key)
    DO UPDATE SET accounts_json = EXCLUDED.accounts_json, updated_at = NOW()
  `;
  return normalized;
}

module.exports = {
  isPostgresConfigured,
  getStorageStatus,
  normalizeAccounts,
  readAccountsFromStorage,
  writeAccountsToStorage,
};

