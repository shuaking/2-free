const crypto = require('crypto');
const { sql } = require('@vercel/postgres');

const STORAGE_KEY = 'default';

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function maskKey(key) {
  const raw = String(key || '');
  if (!raw) return '';
  if (raw.length <= 8) return raw[0] + '***';
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function normalizeKey(key) {
  const value = String(key || '').trim();
  if (!value) return '';
  return value;
}

function getEnvKey() {
  return normalizeKey(process.env.CUSTOM_API_KEY || '');
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS freebuff_custom_api_key (
      storage_key TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL,
      key_mask TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function getCustomKeyStatus() {
  const envKey = getEnvKey();
  if (envKey) {
    return { enabled: true, source: 'env', masked: maskKey(envKey) };
  }

  await ensureTable();
  const result = await sql`
    SELECT key_mask
    FROM freebuff_custom_api_key
    WHERE storage_key = ${STORAGE_KEY}
    LIMIT 1
  `;
  if (!result.rows.length) return { enabled: false, source: 'none', masked: '' };
  return { enabled: true, source: 'postgres', masked: String(result.rows[0].key_mask || '') };
}

async function saveCustomKey(key) {
  const normalized = normalizeKey(key);
  if (!normalized) {
    const error = new Error('自定义 Key 不能为空');
    error.status = 400;
    throw error;
  }

  await ensureTable();
  const keyHash = hashKey(normalized);
  const keyMask = maskKey(normalized);
  await sql`
    INSERT INTO freebuff_custom_api_key (storage_key, key_hash, key_mask, updated_at)
    VALUES (${STORAGE_KEY}, ${keyHash}, ${keyMask}, NOW())
    ON CONFLICT (storage_key)
    DO UPDATE SET key_hash = EXCLUDED.key_hash, key_mask = EXCLUDED.key_mask, updated_at = NOW()
  `;
  return { enabled: true, source: 'postgres', masked: keyMask };
}

async function clearCustomKey() {
  await ensureTable();
  await sql`DELETE FROM freebuff_custom_api_key WHERE storage_key = ${STORAGE_KEY}`;
  return { enabled: false, source: 'none', masked: '' };
}

async function verifyCustomKey(candidate) {
  const key = normalizeKey(candidate);
  if (!key) return false;

  const envKey = getEnvKey();
  if (envKey && key === envKey) return true;

  await ensureTable();
  const result = await sql`
    SELECT key_hash
    FROM freebuff_custom_api_key
    WHERE storage_key = ${STORAGE_KEY}
    LIMIT 1
  `;
  if (!result.rows.length) return false;
  return String(result.rows[0].key_hash || '') === hashKey(key);
}

function extractApiKey(req, body) {
  const auth = String(req.headers?.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const xApiKey = String(req.headers?.['x-api-key'] || '').trim();
  if (xApiKey) return xApiKey;
  return String(body?.apiKey || '').trim();
}

module.exports = {
  getCustomKeyStatus,
  saveCustomKey,
  clearCustomKey,
  verifyCustomKey,
  extractApiKey,
};

