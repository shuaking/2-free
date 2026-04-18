const { getDefaultModel, isAccessPasswordEnabled } = require('../lib/freebuff');
const { getStorageStatus } = require('../lib/account-storage');
const { getCustomKeyStatus } = require('../lib/custom-key');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const storage = getStorageStatus();
  let customKeyEnabled = false;
  try {
    const keyStatus = await getCustomKeyStatus();
    customKeyEnabled = Boolean(keyStatus.enabled);
  } catch {}
  res.status(200).json({
    status: 'ok',
    model: getDefaultModel(),
    web: true,
    loginMode: 'github-via-freebuff',
    accountMode: 'server-pool-round-robin',
    accessPasswordEnabled: isAccessPasswordEnabled(),
    customApiKeyEnabled: customKeyEnabled,
    accountStorage: storage.mode,
    postgresConfigured: storage.configured,
  });
};
