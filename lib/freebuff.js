const API_BASE = 'https://www.codebuff.com';
const WEBSITE_URL = 'https://freebuff.com';
const LOGIN_BASE = 'https://freebuff.com';

const MODEL_TO_AGENT = {
  'minimax/minimax-m2.7': 'base2-free',
  'z-ai/glm-5.1': 'base2-free',
  'google/gemini-2.5-flash-lite': 'file-picker',
  'google/gemini-3.1-flash-lite-preview': 'file-picker-max',
  'google/gemini-3.1-pro-preview': 'thinker-with-files-gemini',
};

const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'minimax/minimax-m2.7';
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';
const runCache = new Map();
const rotationCache = new Map();

function getDefaultModel() {
  return MODEL_TO_AGENT[DEFAULT_MODEL] ? DEFAULT_MODEL : 'minimax/minimax-m2.7';
}

function getAvailableModels() {
  return Object.keys(MODEL_TO_AGENT).map((id) => ({
    id,
    object: 'model',
    created: 1700000000,
    owned_by: 'freebuff',
  }));
}

function getAgentId(model) {
  return MODEL_TO_AGENT[model] || MODEL_TO_AGENT[getDefaultModel()];
}

function isAccessPasswordEnabled() {
  return Boolean(ACCESS_PASSWORD);
}

function verifyAccessPassword(password) {
  if (!isAccessPasswordEnabled()) {
    return true;
  }
  return password === ACCESS_PASSWORD;
}

function generateFingerprintId() {
  return `freebuff-web-${Math.random().toString(36).slice(2, 15)}${Math.random().toString(36).slice(2, 15)}`;
}

function normalizeAccount(account) {
  return {
    id: account?.id || null,
    name: account?.name || 'δ�����˺�',
    email: account?.email || '',
    authToken: account?.authToken || account?.token || '',
  };
}

function sanitizeAccount(account) {
  const normalized = normalizeAccount(account);
  return {
    id: normalized.id,
    name: normalized.name,
    email: normalized.email,
    tokenPreview: normalized.authToken ? `${normalized.authToken.slice(0, 8)}...${normalized.authToken.slice(-6)}` : '',
  };
}

function ensureAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('�����ṩһ�������˺�');
  }

  const normalized = accounts
    .map(normalizeAccount)
    .filter((account) => account.authToken);

  if (normalized.length === 0) {
    throw new Error('�˺ų���û����Ч�� authToken');
  }

  return normalized;
}

function buildRotationKey(accounts, model) {
  const base = accounts
    .map((account) => account.email || account.id || account.name || account.authToken.slice(0, 12))
    .join('|');
  return `${model}::${base}`;
}

function selectAccount(accounts, model, strategy = 'round_robin', preferredIndex) {
  const normalized = ensureAccounts(accounts);

  if (strategy === 'fixed') {
    const index = Number.isInteger(preferredIndex) ? preferredIndex : 0;
    const safeIndex = ((index % normalized.length) + normalized.length) % normalized.length;
    return { account: normalized[safeIndex], index: safeIndex, strategy: 'fixed' };
  }

  const key = buildRotationKey(normalized, model);
  const nextIndex = rotationCache.get(key) || 0;
  const safeIndex = nextIndex % normalized.length;
  rotationCache.set(key, safeIndex + 1);

  return { account: normalized[safeIndex], index: safeIndex, strategy: 'round_robin' };
}

function getRunCacheKey(token, agentId) {
  return `${token.slice(0, 18)}::${agentId}`;
}

async function requestJson(url, { method = 'POST', token, body, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'freebuff2api-vercel/1.0',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  return { status: response.status, data, headers: response.headers };
}

async function requestApi(path, options = {}) {
  return requestJson(`${API_BASE}${path}`, options);
}

async function requestLogin(path, options = {}) {
  return requestJson(`${LOGIN_BASE}${path}`, {
    ...options,
    headers: {
      Origin: WEBSITE_URL,
      Referer: `${WEBSITE_URL}/`,
      ...(options.headers || {}),
    },
  });
}

async function createAgentRun(token, agentId) {
  const result = await requestApi('/api/v1/agent-runs', {
    token,
    body: { action: 'START', agentId },
  });

  if (result.status !== 200 || !result.data?.runId) {
    throw new Error(`���� Agent Run ʧ��: ${JSON.stringify(result.data)}`);
  }

  return result.data.runId;
}

async function getOrCreateAgentRun(token, agentId) {
  const key = getRunCacheKey(token, agentId);
  const cached = runCache.get(key);
  if (cached) {
    return cached;
  }

  const runId = await createAgentRun(token, agentId);
  runCache.set(key, runId);
  return runId;
}

async function finishAgentRun(token, runId) {
  await requestApi('/api/v1/agent-runs', {
    token,
    body: {
      action: 'FINISH',
      runId,
      status: 'completed',
      totalSteps: 1,
      directCredits: 0,
      totalCredits: 0,
    },
  });
}

function resetRunCache(token, agentId) {
  if (token && agentId) {
    runCache.delete(getRunCacheKey(token, agentId));
    return;
  }
  runCache.clear();
}

function openaiToFreebuffBody(openaiBody, runId) {
  const payload = { ...openaiBody };
  delete payload.accounts;
  delete payload.rotationStrategy;
  delete payload.accountIndex;
  delete payload.accessPassword;

  return {
    ...payload,
    codebuff_metadata: {
      run_id: runId,
      client_id: `freebuff-vercel-${Math.random().toString(36).slice(2, 10)}`,
      cost_mode: 'free',
    },
  };
}

function buildOpenAIResponse(runId, model, upstream, accountMeta) {
  const choice = upstream?.choices?.[0] || {};
  const message = choice.message || {};

  return {
    id: `freebuff-${runId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: message.content || '',
          ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
        },
        finish_reason: choice.finish_reason || 'stop',
      },
    ],
    usage: {
      prompt_tokens: upstream?.usage?.prompt_tokens || 0,
      completion_tokens: upstream?.usage?.completion_tokens || 0,
      total_tokens: upstream?.usage?.total_tokens || 0,
    },
    account: accountMeta,
  };
}

async function createChatCompletion(openaiBody) {
  const model = openaiBody?.model || getDefaultModel();
  const strategy = openaiBody?.rotationStrategy || 'round_robin';
  const preferredIndex = Number.isInteger(openaiBody?.accountIndex) ? openaiBody.accountIndex : undefined;
  const { account, index, strategy: actualStrategy } = selectAccount(openaiBody?.accounts, model, strategy, preferredIndex);
  const agentId = getAgentId(model);
  const token = account.authToken;

  let runId = await getOrCreateAgentRun(token, agentId);
  let freebuffBody = openaiToFreebuffBody(openaiBody, runId);

  let result = await requestApi('/api/v1/chat/completions', {
    token,
    body: freebuffBody,
  });

  if (result.status === 200) {
    return buildOpenAIResponse(runId, model, result.data, {
      index,
      strategy: actualStrategy,
      name: account.name,
      email: account.email,
      id: account.id,
    });
  }

  if (result.status === 400 || result.status === 404) {
    resetRunCache(token, agentId);
    runId = await getOrCreateAgentRun(token, agentId);
    freebuffBody = openaiToFreebuffBody(openaiBody, runId);
    result = await requestApi('/api/v1/chat/completions', {
      token,
      body: freebuffBody,
    });

    if (result.status === 200) {
      return buildOpenAIResponse(runId, model, result.data, {
        index,
        strategy: actualStrategy,
        name: account.name,
        email: account.email,
        id: account.id,
      });
    }
  }

  const message = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
  const error = new Error(message || '��������ʧ��');
  error.status = result.status;
  throw error;
}

async function startLogin() {
  const fingerprintId = generateFingerprintId();
  const result = await requestLogin('/api/auth/cli/code', {
    body: { fingerprintId },
  });

  if (result.status !== 200 || !result.data?.loginUrl) {
    throw new Error(`获取登录地址失败: HTTP ${result.status} ${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`);
  }

  return {
    fingerprintId,
    loginUrl: result.data.loginUrl,
    fingerprintHash: result.data.fingerprintHash,
    expiresAt: result.data.expiresAt,
  };
}

async function checkLoginStatus({ fingerprintId, fingerprintHash, expiresAt }) {
  const url = `/api/auth/cli/status?fingerprintId=${encodeURIComponent(fingerprintId)}&fingerprintHash=${encodeURIComponent(fingerprintHash)}&expiresAt=${encodeURIComponent(expiresAt)}`;
  const result = await requestLogin(url, { method: 'GET' });

  if (result.status !== 200) {
    const error = new Error(`查询登录状态失败: HTTP ${result.status} ${typeof result.data === 'string' ? result.data : JSON.stringify(result.data)}`);
    error.status = result.status;
    throw error;
  }

  const user = result.data?.user;
  if (!user) {
    return { authorized: false };
  }

  return {
    authorized: true,
    account: sanitizeAccount({
      id: user.id,
      name: user.name,
      email: user.email,
      authToken: user.authToken || user.auth_token,
    }),
    rawAccount: normalizeAccount({
      id: user.id,
      name: user.name,
      email: user.email,
      authToken: user.authToken || user.auth_token,
    }),
  };
}

module.exports = {
  WEBSITE_URL,
  MODEL_TO_AGENT,
  getDefaultModel,
  getAvailableModels,
  getAgentId,
  isAccessPasswordEnabled,
  verifyAccessPassword,
  createChatCompletion,
  createAgentRun,
  getOrCreateAgentRun,
  finishAgentRun,
  resetRunCache,
  startLogin,
  checkLoginStatus,
  sanitizeAccount,
  selectAccount,
};
