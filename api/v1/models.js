const { getAvailableModels } = require('../../lib/freebuff');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  res.status(200).json({
    object: 'list',
    data: getAvailableModels(),
  });
};
