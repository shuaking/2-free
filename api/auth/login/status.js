const { checkLoginStatus, verifyAccessPassword, isAccessPasswordEnabled } = require('../../../lib/freebuff');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  try {
    if (isAccessPasswordEnabled() && !verifyAccessPassword(String(req.query?.accessPassword || ''))) {
      res.status(401).json({ error: { message: '访问密码错误' } });
      return;
    }

    const data = await checkLoginStatus(req.query || {});
    res.status(200).json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        message: error.message || '��ѯ��¼״̬ʧ��',
      },
    });
  }
};
