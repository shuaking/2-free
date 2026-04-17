#!/usr/bin/env node

/**
 * Freebuff OpenAI API 反代代理
 * 暴露本地端口，提供标准 OpenAI Chat Completion API
 * 其他程序可通过 http://localhost:PORT/v1/chat/completions 调用
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const child_process = require('child_process');

const API_BASE = 'www.codebuff.com';
const WEBSITE_URL = 'https://freebuff.com';
const LOCAL_PORT = 1145;
const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 5 * 60 * 1000;

// 模型 → Agent 映射（FREE 模式）
const MODEL_TO_AGENT = {
  'minimax/minimax-m2.7': 'base2-free',
  'z-ai/glm-5.1': 'base2-free',
  'google/gemini-2.5-flash-lite': 'file-picker',
  'google/gemini-3.1-flash-lite-preview': 'file-picker-max',
  'google/gemini-3.1-pro-preview': 'thinker-with-files-gemini',
};

// 默认配置
let defaultModel = 'minimax/minimax-m2.7';
let token = null;

// 缓存的 agent run（复用，避免每次创建）
let cachedRunId = null;
let cachedAgentId = null;

const colors = {
  reset: '\x1b[0m', bright: '\x1b[1m', green: '\x1b[32m',
  yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m'
};

function log(msg, type = 'info') {
  const c = type === 'success' ? colors.green : type === 'error' ? colors.red : type === 'warn' ? colors.yellow : colors.cyan;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✗' : type === 'warn' ? '⚠' : 'ℹ';
  console.log(`${c}${icon}${colors.reset} ${msg}`);
}

// ============ 工具函数 ============
function generateFingerprintId() {
  return `codebuff-cli-${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
}

function getConfigPaths() {
  const homeDir = os.homedir();
  const configDir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || homeDir, 'manicode')
    : path.join(homeDir, '.config', 'manicode');
  return { configDir, credentialsPath: path.join(configDir, 'credentials.json') };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ HTTP 请求 ============
function request(hostname, path, body, authToken, method = 'POST') {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';

    const options = {
      hostname: hostname,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'freebuff-proxy/1.0',
        ...(authToken && { 'Authorization': `Bearer ${authToken}` }),
        ...(data && { 'Content-Length': Buffer.byteLength(data) }),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: responseData, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

// SSE 流式请求
function streamRequest(path, body, authToken) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);

    const options = {
      hostname: API_BASE,
      port: 443,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Accept': 'text/event-stream',
        'User-Agent': 'freebuff-proxy/1.0',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', chunk => errData += chunk);
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errData}`)));
        return;
      }

      const chunks = [];
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) chunks.push(content);
          } catch {}
        }
      });

      res.on('end', () => resolve(chunks.join('')));
    });

    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

// ============ 登录流程 ============
async function doLogin() {
  log('需要登录 Freebuff...');

  const fingerprintId = generateFingerprintId();
  log(`指纹: ${fingerprintId.substring(0, 30)}...`);

  const loginRes = await request('freebuff.com', '/api/auth/cli/code', { fingerprintId });
  if (loginRes.status !== 200 || !loginRes.data.loginUrl) {
    throw new Error(`获取登录 URL 失败`);
  }

  const { loginUrl, fingerprintHash, expiresAt } = loginRes.data;

  console.log(`\n${colors.yellow}请在浏览器中打开:${colors.reset}\n${colors.cyan}${loginUrl}${colors.reset}\n`);

  const platform = process.platform;
  const cmd = platform === 'darwin' ? `open "${loginUrl}"` :
              platform === 'win32' ? `start "" "${loginUrl}"` : null;
  if (cmd) child_process.exec(cmd, () => {});

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(r => {
    rl.question(`${colors.yellow}完成登录后按回车继续...${colors.reset}`, () => { rl.close(); r(); });
  });

  log('等待登录完成...');
  const startTime = Date.now();

  while (Date.now() - startTime < TIMEOUT_MS) {
    process.stdout.write(`\r${colors.gray}轮询中...${colors.reset}`);

    try {
      const statusPath = `/api/auth/cli/status?fingerprintId=${encodeURIComponent(fingerprintId)}` +
        `&fingerprintHash=${encodeURIComponent(fingerprintHash)}` +
        `&expiresAt=${encodeURIComponent(expiresAt)}`;
      const statusRes = await request('freebuff.com', statusPath, null, null, 'GET');

      if (statusRes.status === 200 && statusRes.data.user) {
        console.log();
        const user = statusRes.data.user;

        const { configDir, credentialsPath } = getConfigPaths();
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

        const credentials = {
          default: {
            id: user.id,
            name: user.name,
            email: user.email,
            authToken: user.authToken || user.auth_token,
            credits: user.credits ?? 0,
          }
        };

        fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));
        log(`登录成功！`, 'success');
        console.log(`  用户: ${user.name} (${user.email})`);
        return credentials.default.authToken;
      }
    } catch {}

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('登录超时');
}

function loadToken() {
  const { credentialsPath } = getConfigPaths();
  if (fs.existsSync(credentialsPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      return creds.default?.authToken;
    } catch {}
  }
  return null;
}

// ============ Freebuff API 调用 ============
async function createAgentRun(authToken, agentId) {
  const startTime = Date.now();
  const res = await request(API_BASE, '/api/v1/agent-runs',
    { action: 'START', agentId }, authToken);
  const elapsed = Date.now() - startTime;
  if (res.status !== 200 || !res.data.runId) {
    throw new Error(`创建 Agent Run 失败: ${JSON.stringify(res.data)}`);
  }
  log(`创建新 Agent Run: ${res.data.runId} (耗时 ${elapsed}ms)`, 'info');
  return res.data.runId;
}

// 获取或创建 agent run（复用缓存）
async function getOrCreateAgentRun(authToken, agentId) {
  // 如果缓存的 agent 类型不同，需要新建
  if (cachedAgentId !== agentId) {
    cachedRunId = null;
    cachedAgentId = agentId;
  }

  // 如果有缓存，直接使用
  if (cachedRunId) {
    return cachedRunId;
  }

  // 创建新的 run 并缓存
  cachedRunId = await createAgentRun(authToken, agentId);
  return cachedRunId;
}

async function finishAgentRun(authToken, runId) {
  await request(API_BASE, '/api/v1/agent-runs', {
    action: 'FINISH',
    runId: runId,
    status: 'completed',
    totalSteps: 1,
    directCredits: 0,
    totalCredits: 0,
  }, authToken);
}

// ============ OpenAI API 转换 ============
function openaiToFreebuffBody(openaiBody, runId) {
  // 直接透传所有参数，只添加 Freebuff 元数据
  return {
    ...openaiBody,  // 透传所有原始参数（model, messages, tools, temperature 等）
    // 覆盖/添加 Freebuff 元数据
    codebuff_metadata: {
      run_id: runId,
      client_id: `freebuff-proxy-${Math.random().toString(36).substring(2, 10)}`,
      cost_mode: 'free',
    },
  };
}

// ============ 本地代理服务器 ============
async function handleChatCompletion(req, res) {
  const startTime = Date.now();

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
    return;
  }

  const model = body.model || defaultModel;
  const agentId = MODEL_TO_AGENT[model] || 'base2-free';

  log(`收到请求: model=${model}, messages=${body.messages?.length || 0}, stream=${body.stream || false}`);

  // 获取或创建 agent run（复用缓存）
  let runId;
  try {
    runId = await getOrCreateAgentRun(token, agentId);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: e.message } }));
    return;
  }

  const freebuffBody = openaiToFreebuffBody(body, runId);

  // 调用 LLM
  try {
    if (body.stream) {
      // 流式响应
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      await streamToOpenAIFormat(freebuffBody, token, res, model);

      const totalElapsed = Date.now() - startTime;
      log(`请求完成，总耗时 ${totalElapsed}ms`, 'success');
    } else {
      // 非流式响应
      const llmRes = await request(API_BASE, '/api/v1/chat/completions', freebuffBody, token);

      if (llmRes.status === 200) {
        const choice = llmRes.data.choices?.[0] || {};
        const message = choice.message || {};
        const content = message.content || '';
        const toolCalls = message.tool_calls || null;
        const finishReason = choice.finish_reason || 'stop';

        const openaiResponse = {
          id: `freebuff-${runId}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: content,
              ...(toolCalls && { tool_calls: toolCalls }),
            },
            finish_reason: finishReason,
          }],
          usage: {
            prompt_tokens: llmRes.data.usage?.prompt_tokens || 0,
            completion_tokens: llmRes.data.usage?.completion_tokens || 0,
            total_tokens: llmRes.data.usage?.total_tokens || 0,
          },
        };

        const totalElapsed = Date.now() - startTime;
        log(`请求完成，总耗时 ${totalElapsed}ms`, 'success');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(openaiResponse));
      } else if (llmRes.status === 400 || llmRes.status === 404) {
        // runId 失效，清除缓存并重试一次
        log('Agent Run 失效，重新创建...', 'warn');
        cachedRunId = null;
        runId = await getOrCreateAgentRun(token, agentId);
        freebuffBody.codebuff_metadata.run_id = runId;

        const retryRes = await request(API_BASE, '/api/v1/chat/completions', freebuffBody, token);
        if (retryRes.status === 200) {
          const retryChoice = retryRes.data.choices?.[0] || {};
          const retryMessage = retryChoice.message || {};
          const retryContent = retryMessage.content || '';
          const retryToolCalls = retryMessage.tool_calls || null;
          const retryFinishReason = retryChoice.finish_reason || 'stop';

          const openaiResponse = {
            id: `freebuff-${runId}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: retryContent,
                ...(retryToolCalls && { tool_calls: retryToolCalls }),
              },
              finish_reason: retryFinishReason,
            }],
            usage: {
              prompt_tokens: retryRes.data.usage?.prompt_tokens || 0,
              completion_tokens: retryRes.data.usage?.completion_tokens || 0,
              total_tokens: retryRes.data.usage?.total_tokens || 0,
            },
          };
          log(`重试成功，总耗时 ${Date.now() - startTime}ms`, 'success');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(openaiResponse));
        } else {
          res.writeHead(retryRes.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: retryRes.data } }));
        }
      } else {
        res.writeHead(llmRes.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: llmRes.data } }));
      }
    }
  } catch (e) {
    log(`请求失败: ${e.message}`, 'error');
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

// 流式响应转换为 OpenAI SSE 格式（支持 tool_calls）
async function streamToOpenAIFormat(freebuffBody, authToken, res, model) {
  const data = JSON.stringify(freebuffBody);

  const options = {
    hostname: API_BASE,
    port: 443,
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'Accept': 'text/event-stream',
      'User-Agent': 'freebuff-proxy/1.0',
      'Content-Length': Buffer.byteLength(data),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (llmRes) => {
      if (llmRes.statusCode !== 200) {
        let errData = '';
        llmRes.on('data', chunk => errData += chunk);
        llmRes.on('end', () => reject(new Error(`HTTP ${llmRes.statusCode}: ${errData}`)));
        return;
      }

      let buffer = '';
      let fullContent = '';
      let finishReason = 'stop';
      const responseId = `freebuff-${Date.now()}`;

      llmRes.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const jsonStr = trimmed.slice(6).trim();
          if (jsonStr === '[DONE]') {
            res.write('data: [DONE]\n\n');
            continue;
          }
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta || {};
            const choiceFinishReason = parsed.choices?.[0]?.finish_reason;

            // 检查 finish_reason
            if (choiceFinishReason) {
              finishReason = choiceFinishReason;
            }

            // 构建 delta 对象
            const deltaObj = {};
            if (delta.content) {
              fullContent += delta.content;
              deltaObj.content = delta.content;
            }
            if (delta.tool_calls) {
              deltaObj.tool_calls = delta.tool_calls;
            }
            if (delta.role) {
              deltaObj.role = delta.role;
            }

            // 只在有内容时发送
            if (Object.keys(deltaObj).length > 0) {
              const openaiChunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                  index: 0,
                  delta: deltaObj,
                  finish_reason: null,
                }],
              };
              res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
            }
          } catch {}
        }
      });

      llmRes.on('end', () => {
        // 发送最终 chunk
        const finalChunk = {
          id: responseId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: finishReason,
          }],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        resolve(fullContent);
      });

      llmRes.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

// ============ 主服务器 ============
async function startServer() {
  // 加载或登录获取 token
  token = loadToken();
  if (!token) {
    token = await doLogin();
  } else {
    log(`已加载 Token: ${token.substring(0, 30)}...`);
  }

  // 预热：启动时创建一个 agent run
  log('预热：创建 Agent Run...');
  const defaultAgentId = MODEL_TO_AGENT[defaultModel] || 'base2-free';
  cachedRunId = await createAgentRun(token, defaultAgentId);
  cachedAgentId = defaultAgentId;
  log('预热完成，Agent Run 已缓存', 'success');

  const server = http.createServer(async (req, res) => {
    const urlPath = req.url;

    // 路由处理
    if (urlPath === '/v1/chat/completions' && req.method === 'POST') {
      await handleChatCompletion(req, res);
    } else if (urlPath === '/v1/models' && req.method === 'GET') {
      // 返回可用模型列表
      const models = Object.keys(MODEL_TO_AGENT).map(id => ({
        id: id,
        object: 'model',
        created: 1700000000,
        owned_by: 'freebuff',
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models }));
    } else if (urlPath === '/v1/reset-run' && req.method === 'POST') {
      // 手动重置 agent run
      cachedRunId = null;
      log('Agent Run 缓存已清除');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'cleared' }));
    } else if (urlPath === '/health' || urlPath === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        model: defaultModel,
        cachedRunId: cachedRunId,
        cachedAgentId: cachedAgentId
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
    }
  });

  // 关闭时清理 agent run
  const cleanup = async () => {
    if (cachedRunId) {
      log('关闭代理，结束 Agent Run...');
      try {
        await finishAgentRun(token, cachedRunId);
        log('Agent Run 已结束', 'success');
      } catch {}
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  server.listen(LOCAL_PORT, () => {
    console.log(`
${colors.bright}${colors.cyan}
╔══════════════════════════════════════════════════════════════╗
║               Freebuff OpenAI Proxy                          ║
║             本地端口: ${LOCAL_PORT}                          ║
║              Agent Run 已缓存，零额外延迟                    ║
╚══════════════════════════════════════════════════════════════╝
${colors.reset}
`);
    log(`代理地址: http://localhost:${LOCAL_PORT}/v1/chat/completions`);
    log(`模型列表: http://localhost:${LOCAL_PORT}/v1/models`);
    log(`重置缓存: http://localhost:${LOCAL_PORT}/v1/reset-run (POST)`);
    log(`健康检查: http://localhost:${LOCAL_PORT}/health`);
    console.log(`\n${colors.yellow}可用模型:${colors.reset}`);
    Object.entries(MODEL_TO_AGENT).forEach(([model, agent]) => {
      console.log(`  ${colors.cyan}${model}${colors.reset} → ${agent}`);
    });
    console.log(`\n${colors.green}等待请求... (Ctrl+C 关闭)${colors.reset}\n`);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      log(`端口 ${LOCAL_PORT} 已被占用`, 'error');
    } else {
      log(`服务器错误: ${e.message}`, 'error');
    }
  });
}

// ============ 入口 ============
async function main() {
  try {
    await startServer();
  } catch (err) {
    log(`启动失败: ${err.message}`, 'error');
    process.exit(1);
  }
}

main();
