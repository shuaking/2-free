const { createChatCompletion, verifyAccessPassword, isAccessPasswordEnabled } = require('../../../lib/freebuff');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (isAccessPasswordEnabled() && !verifyAccessPassword(String(body.accessPassword || ''))) {
      res.status(401).json({
        error: {
          message: '访问密码错误',
        },
      });
      return;
    }

    if (body.stream) {
      res.status(400).json({
        error: {
          message: '��ǰ Web �汾�ݲ�֧�� stream=true����ʹ����ͨ��Ӧģʽ��',
        },
      });
      return;
    }

    const data = await createChatCompletion(body);
    res.status(200).json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        message: error.message || '����ʧ��',
      },
    });
  }
};
