const { isAccessPasswordEnabled, verifyAccessPassword } = require('../lib/freebuff');
const {
  readAccountsFromStorage,
  writeAccountsToStorage,
  normalizeAccounts,
  getStorageStatus,
} = require('../lib/account-storage');

function readAccessPassword(req, body) {
  if (body && typeof body.accessPassword !== 'undefined') return String(body.accessPassword || '');
  if (req.query && typeof req.query.accessPassword !== 'undefined') return String(req.query.accessPassword || '');
  return '';
}

function deny(res) {
  res.status(401).json({ error: { message: '访问密码错误' } });
}

module.exports = async function handler(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const accessPassword = readAccessPassword(req, body);

    if (isAccessPasswordEnabled() && !verifyAccessPassword(accessPassword)) {
      deny(res);
      return;
    }

    if (req.method === 'GET') {
      const accounts = await readAccountsFromStorage();
      res.status(200).json({ accounts, ...getStorageStatus() });
      return;
    }

    if (req.method === 'POST') {
      const accounts = normalizeAccounts(body.accounts || []);
      const saved = await writeAccountsToStorage(accounts);
      res.status(200).json({ ok: true, accounts: saved, ...getStorageStatus() });
      return;
    }

    if (req.method === 'DELETE') {
      const saved = await writeAccountsToStorage([]);
      res.status(200).json({ ok: true, accounts: saved, ...getStorageStatus() });
      return;
    }

    res.status(405).json({ error: { message: 'Method not allowed' } });
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        message: error.message || '账号池操作失败',
      },
      ...getStorageStatus(),
    });
  }
};

