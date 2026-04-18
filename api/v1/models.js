const { getAvailableModels, isAccessPasswordEnabled, verifyAccessPassword } = require('../../lib/freebuff');
const { verifyCustomKey, extractApiKey } = require('../../lib/custom-key');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  try {
    const accessPassword = String(req.query?.accessPassword || '');
    const apiKey = extractApiKey(req, {});
    const apiKeyPassed = await verifyCustomKey(apiKey);

    if (!apiKeyPassed && isAccessPasswordEnabled() && !verifyAccessPassword(accessPassword)) {
      res.status(401).json({
        error: {
          message: '访问密码错误或客户端 Key 无效',
        },
      });
      return;
    }

    res.status(200).json({
      object: 'list',
      data: getAvailableModels(),
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        message: error.message || '模型列表获取失败',
      },
    });
  }
};
