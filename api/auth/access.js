const { isAccessPasswordEnabled, verifyAccessPassword } = require('../../lib/freebuff');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const password = String(body.password || '');

    if (!isAccessPasswordEnabled()) {
      res.status(200).json({ enabled: false, passed: true });
      return;
    }

    if (!verifyAccessPassword(password)) {
      res.status(401).json({ enabled: true, passed: false, error: { message: '访问密码错误' } });
      return;
    }

    res.status(200).json({ enabled: true, passed: true });
  } catch (error) {
    res.status(500).json({ error: { message: error.message || '密码校验失败' } });
  }
};
