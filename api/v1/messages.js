const {
  createChatCompletion,
  createChatCompletionStream,
  verifyAccessPassword,
  isAccessPasswordEnabled,
  getDefaultModel,
} = require('../../lib/freebuff');
const { readAccountsFromStorage } = require('../../lib/account-storage');
const { verifyCustomKey, extractApiKey } = require('../../lib/custom-key');

function normalizeContentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      if (block.type === 'text') return String(block.text || '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function anthropicToOpenAI(body) {
  const messages = [];
  const systemText = normalizeContentToText(body.system);
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  const source = Array.isArray(body.messages) ? body.messages : [];
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role === 'assistant' ? 'assistant' : 'user';
    const content = normalizeContentToText(item.content);
    messages.push({ role, content });
  }

  return {
    model: body.model || getDefaultModel(),
    messages,
    stream: Boolean(body.stream),
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop_sequences,
    max_tokens: body.max_tokens,
    rotationStrategy: body.rotationStrategy,
    accountIndex: body.accountIndex,
    accounts: body.accounts,
    accessPassword: body.accessPassword,
  };
}

function buildAnthropicResponseFromOpenAI(openaiResult, requestedModel) {
  const text = openaiResult?.choices?.[0]?.message?.content || '';
  return {
    id: `msg_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel || openaiResult?.model,
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: Number(openaiResult?.usage?.prompt_tokens || 0),
      output_tokens: Number(openaiResult?.usage?.completion_tokens || 0),
    },
  };
}

function writeSse(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const apiKey = extractApiKey(req, body);
    const apiKeyPassed = await verifyCustomKey(apiKey);

    if (!apiKeyPassed && isAccessPasswordEnabled() && !verifyAccessPassword(String(body.accessPassword || ''))) {
      res.status(401).json({
        error: {
          message: '访问密码错误或客户端 Key 无效',
        },
      });
      return;
    }

    if (!Array.isArray(body.accounts) || body.accounts.length === 0) {
      try {
        body.accounts = await readAccountsFromStorage();
      } catch {}
    }

    const openaiPayload = anthropicToOpenAI(body);

    if (!openaiPayload.stream) {
      const openaiResult = await createChatCompletion(openaiPayload);
      res.status(200).json(buildAnthropicResponseFromOpenAI(openaiResult, body.model));
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const { response } = await createChatCompletionStream(openaiPayload);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let aggregatedText = '';

    writeSse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: `msg_${Date.now().toString(36)}`,
        type: 'message',
        role: 'assistant',
        model: body.model || openaiPayload.model,
        content: [],
      },
    });
    writeSse(res, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6);
          if (raw === '[DONE]') {
            continue;
          }
          try {
            const parsed = JSON.parse(raw);
            const delta = parsed?.choices?.[0]?.delta?.content || '';
            if (!delta) continue;
            aggregatedText += delta;
            writeSse(res, 'content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: delta },
            });
          } catch {}
        }
      }
    } finally {
      reader.releaseLock();
    }

    writeSse(res, 'content_block_stop', {
      type: 'content_block_stop',
      index: 0,
    });
    writeSse(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 0 },
    });
    writeSse(res, 'message_stop', { type: 'message_stop' });
    res.end();
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        message: error.message || '请求失败',
      },
    });
  }
};

