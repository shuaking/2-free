const { startLogin, verifyAccessPassword, isAccessPasswordEnabled } = require('../../../lib/freebuff');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (isAccessPasswordEnabled() && !verifyAccessPassword(String(body.password || ''))) {
      res.status(401).json({ error: { message: '访问密码错误' } });
      return;
    }

    const data = await startLogin();
    res.status(200).json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        message: error.message || '启动登录失败',
      },
    });
  }
};
