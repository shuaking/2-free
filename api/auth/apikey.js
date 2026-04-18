const { isAccessPasswordEnabled, verifyAccessPassword } = require('../../lib/freebuff');
const { getCustomKeyStatus, saveCustomKey, clearCustomKey } = require('../../lib/custom-key');

function readPassword(req, body) {
  if (typeof body?.accessPassword !== 'undefined') return String(body.accessPassword || '');
  if (typeof req.query?.accessPassword !== 'undefined') return String(req.query.accessPassword || '');
  return '';
}

module.exports = async function handler(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const accessPassword = readPassword(req, body);

    if (isAccessPasswordEnabled() && !verifyAccessPassword(accessPassword)) {
      res.status(401).json({ error: { message: '访问密码错误' } });
      return;
    }

    if (req.method === 'GET') {
      const status = await getCustomKeyStatus();
      res.status(200).json(status);
      return;
    }

    if (req.method === 'POST') {
      const status = await saveCustomKey(body.key);
      res.status(200).json({ ok: true, ...status });
      return;
    }

    if (req.method === 'DELETE') {
      const status = await clearCustomKey();
      res.status(200).json({ ok: true, ...status });
      return;
    }

    res.status(405).json({ error: { message: 'Method not allowed' } });
  } catch (error) {
    res.status(error.status || 500).json({
      error: { message: error.message || '自定义 Key 操作失败' },
    });
  }
};

