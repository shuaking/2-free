const { getDefaultModel, isAccessPasswordEnabled } = require('../lib/freebuff');
const { getStorageStatus } = require('../lib/account-storage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const storage = getStorageStatus();
  res.status(200).json({
    status: 'ok',
    model: getDefaultModel(),
    web: true,
    loginMode: 'github-via-freebuff',
    accountMode: 'server-pool-round-robin',
    accessPasswordEnabled: isAccessPasswordEnabled(),
    accountStorage: storage.mode,
    postgresConfigured: storage.configured,
  });
};
