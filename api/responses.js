const chatHandler = require('./v1/chat/completions');

function responsesToChatBody(body) {
  const input = body?.input;
  let messages = [];

  if (Array.isArray(input)) {
    messages = input
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const role = item.role === 'assistant' ? 'assistant' : 'user';
        if (typeof item.content === 'string') {
          return { role, content: item.content };
        }
        if (Array.isArray(item.content)) {
          const text = item.content
            .map((part) => (part && typeof part === 'object' && part.type === 'input_text' ? String(part.text || '') : ''))
            .filter(Boolean)
            .join('\n');
          return { role, content: text };
        }
        return null;
      })
      .filter(Boolean);
  } else if (typeof input === 'string' && input.trim()) {
    messages = [{ role: 'user', content: input }];
  }

  return {
    model: body?.model,
    messages,
    stream: Boolean(body?.stream),
    temperature: body?.temperature,
    top_p: body?.top_p,
    max_tokens: body?.max_output_tokens || body?.max_tokens,
    stop: body?.stop,
    rotationStrategy: body?.rotationStrategy,
    accountIndex: body?.accountIndex,
    accounts: body?.accounts,
    accessPassword: body?.accessPassword,
    apiKey: body?.apiKey,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const chatBody = responsesToChatBody(body);
    req.body = chatBody;
    await chatHandler(req, res);
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        message: error.message || '请求失败',
      },
    });
  }
};

