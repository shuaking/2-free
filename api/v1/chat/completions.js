const { createChatCompletion, createChatCompletionStream, verifyAccessPassword, isAccessPasswordEnabled } = require('../../../lib/freebuff');

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
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const { response, runId, model, accountMeta } = await createChatCompletionStream(body);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim());

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                res.write(`data: [DONE]\n\n`);
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const openaiChunk = {
                  id: `freebuff-${runId}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{
                    index: 0,
                    delta: parsed.choices?.[0]?.delta || {},
                    finish_reason: parsed.choices?.[0]?.finish_reason || null,
                  }],
                  account: accountMeta,
                };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
              } catch (e) {
                res.write(line + '\n');
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
        res.end();
      }
      return;
    }

    const data = await createChatCompletion(body);
    res.status(200).json(data);
  } catch (error) {
    res.status(error.status || 500).json({
      error: {
        message: error.message || '请求失败',
      },
    });
  }
};
