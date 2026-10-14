import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { FreeLLMAPIProvider } from '../src/server/FreeLLMAPIProvider.js';
import { handleApiRequest } from '../src/server/apiRouter.js';

describe('FreeLLMAPIProvider Unit & Mock Tests', () => {
  it('explains missing upstream provider credentials instead of implying model selection guarantees availability', () => {
    const provider = new FreeLLMAPIProvider();
    const error = provider.formatError(new Error(
      'No candidate model has a configured, usable provider key. Add provider API keys in the dashboard. All models exhausted. 1 model skipped: no key configured for their platform.'
    ));
    assert.match(error, /no usable provider API key is configured/i);
    assert.match(error, /FreeLLMAPI dashboard/i);
    assert.match(error, /Selecting a model in Sora does not configure upstream provider credentials/i);
  });

  it('uses a three-minute default timeout while allowing explicit overrides', () => {
    assert.equal(new FreeLLMAPIProvider().timeoutMs, 180000);
    assert.equal(new FreeLLMAPIProvider({ timeoutMs: 2500 }).timeoutMs, 2500);
  });

  let mockServer;
  let mockPort;
  let mockBaseUrl;

  before(async () => {
    // Start a mock FreeLLMAPI server on an ephemeral port
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${mockPort}`);

      if (url.pathname === '/v1/models' && req.method === 'GET') {
        const auth = req.headers['authorization'];
        if (auth === 'Bearer invalid_key') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [
            { id: 'auto' },
            { id: 'fusion' },
            { id: 'qwen-3.8-27b', execution_status: 'ready' },
          ]
        }));
        return;
      }

      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        const auth = req.headers['authorization'];
        if (auth === 'Bearer invalid_key') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
          return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body);

          if (parsed.model === 'trigger-429') {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Too Many Requests' } }));
            return;
          }

          if (parsed.stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
            });
            if (parsed.model === 'inline-test') {
              res.write('data: {"choices":[{"delta":{"content":"Hello<thi"}}]}\n\n');
              res.write('data: {"choices":[{"delta":{"content":"nk>SECRET_MARKER</think> world!"}}]}\n\n');
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            if (parsed.model === 'actual-model-test') {
              res.write('data: {"model":"resolved-model-v2","choices":[{"delta":{"content":"Model identified"}}]}\n\n');
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            // Send reasoning chunk (which should be skipped from content)
            res.write('data: {"choices":[{"delta":{"reasoning_content":"Thinking..."}}]}\n\n');
            // Send content tokens
            res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
            res.write('data: {"choices":[{"delta":{"content":" world!"}}]}\n\n');
            // Send [DONE]
            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Hello world!',
                  }
                }
              ],
              model: parsed.model || 'auto',
              usage: { total_tokens: 10 }
            }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise(resolve => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        mockBaseUrl = `http://127.0.0.1:${mockPort}/v1`;
        resolve();
      });
    });
  });

  after(async () => {
    if (mockServer) {
      await new Promise(resolve => mockServer.close(resolve));
    }
  });

  it('initializes with default options and normalizes baseUrl', () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: 'http://127.0.0.1:31415/v1///',
      apiKey: 'test-secret-key',
      model: 'custom-model',
    });

    assert.equal(provider.baseUrl, 'http://127.0.0.1:31415/v1');
    assert.equal(provider.apiKey, 'test-secret-key');
    assert.equal(provider.defaultModel, 'custom-model');
  });

  it('validates messages correctly', () => {
    const provider = new FreeLLMAPIProvider();
    assert.throws(() => provider.validateMessages([]), /non-empty array/);
    assert.throws(() => provider.validateMessages('hello'), /non-empty array/);
    assert.throws(() => provider.validateMessages([{ content: 'hi' }]), /role/);
    assert.throws(() => provider.validateMessages([{ role: 'user' }]), /content/);
    assert.doesNotThrow(() => provider.validateMessages([{ role: 'user', content: 'hi' }]));
  });

  it('performs health check against mock gateway successfully', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: mockBaseUrl,
      apiKey: 'valid_key',
    });

    const health = await provider.checkHealth();
    assert.equal(health.ok, true);
    assert.equal(health.status, 'connected');
    assert.equal(health.apiKeyConfigured, true);
    assert.ok(Array.isArray(health.availableModels));
    assert.ok(health.availableModels.includes('auto'));
    assert.ok(health.availableModels.includes('fusion'));
  });

  it('handles authentication failure gracefully without leaking secret', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: mockBaseUrl,
      apiKey: 'invalid_key',
    });

    const health = await provider.checkHealth();
    assert.equal(health.ok, false);
    assert.equal(health.status, 'error');
    assert.match(health.error, /Invalid API key/);
    assert.equal(health.error.includes('invalid_key'), false, 'Key must not be leaked');
  });

  it('handles unreachable gateway gracefully with descriptive message', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: 'http://127.0.0.1:65432/v1', // unused port
      apiKey: 'valid_key',
      timeoutMs: 1500,
    });

    const health = await provider.checkHealth();
    assert.equal(health.ok, false);
    assert.match(health.error, /FreeLLMAPI is unreachable/);
  });

  it('handles non-streaming chat requests', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: mockBaseUrl,
      apiKey: 'valid_key',
      model: 'auto',
    });

    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Hello' }],
    });

    assert.equal(result.role, 'assistant');
    assert.equal(result.content, 'Hello world!');
    assert.equal(result.model, 'auto');
    assert.equal(result.usage.total_tokens, 10);
  });

  it('handles streaming chat requests with token callbacks and reasoning suppression', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: mockBaseUrl,
      apiKey: 'valid_key',
      model: 'auto',
    });

    const tokens = [];
    let completed = false;

    const fullText = await provider.streamChat({
      messages: [{ role: 'user', content: 'Hello' }],
      onToken: (t) => tokens.push(t),
      onDone: () => { completed = true; },
    });

    assert.equal(completed, true);
    assert.deepEqual(tokens, ['Hello', ' world!']);
    assert.equal(fullText, 'Hello world!');
  });

  it('reports the actual model returned by the streaming provider', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: mockBaseUrl,
      apiKey: 'valid_key',
      model: 'actual-model-test',
    });
    const models = [];
    const fullText = await provider.streamChat({
      messages: [{ role: 'user', content: 'Which model?' }],
      onModel: (model) => models.push(model),
      onToken: () => {},
    });
    assert.equal(fullText, 'Model identified');
    assert.ok(models.includes('actual-model-test'));
    assert.ok(models.includes('resolved-model-v2'));
  });

  it('filters inline tagged content across delta boundaries', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: mockBaseUrl,
      apiKey: 'valid_key',
      model: 'inline-test',
    });
    const tokens = [];
    const reasoningParts = [];
    const fullText = await provider.streamChat({
      messages: [{ role: 'user', content: 'Hello' }],
      onToken: (token) => tokens.push(token),
      onReasoning: (token) => reasoningParts.push(token),
    });
    assert.equal(tokens.join(''), 'Hello world!');
    assert.equal(fullText, 'Hello world!');
    assert.equal(reasoningParts.join(''), 'SECRET_MARKER');
  });

  it('handles 429 rate limit errors cleanly', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: mockBaseUrl,
      apiKey: 'valid_key',
      model: 'trigger-429',
    });

    await assert.rejects(
      () => provider.chat({ messages: [{ role: 'user', content: 'Hi' }] }),
      /Rate limit exceeded/
    );
  });
});

describe('API Router Integration Tests', () => {
  let mockServer;
  let mockPort;
  let mockBaseUrl;

  before(async () => {
    mockServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${mockPort}`);
      if (url.pathname === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'auto' }] }));
        return;
      }
      if (url.pathname === '/v1/chat/completions') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"Hi"漫}}]}\n\n'.replace('漫', ''));
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise(resolve => {
      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        mockBaseUrl = `http://127.0.0.1:${mockPort}/v1`;
        resolve();
      });
    });
  });

  after(async () => {
    if (mockServer) {
      await new Promise(resolve => mockServer.close(resolve));
    }
  });

  it('handles GET /api/health and returns JSON without secret keys', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: mockBaseUrl,
      apiKey: 'super-secret-key-123',
    });

    const req = {
      method: 'GET',
      url: '/api/health',
      headers: {},
      on: () => {},
    };

    let statusCode;
    const headers = {};
    let body = '';

    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      set statusCode(c) { statusCode = c; },
      get statusCode() { return statusCode; },
      end: (data) => { body = data; },
    };

    const handled = await handleApiRequest(req, res, provider);
    assert.equal(handled, true);
    assert.equal(statusCode, 200);

    const parsed = JSON.parse(body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.status, 'connected');
    assert.equal(parsed.apiKeyConfigured, true);
    assert.equal(body.includes('super-secret-key-123'), false, 'Secret key must never be exposed');
  });

  it('handles POST /api/chat with streaming SSE', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: mockBaseUrl,
      apiKey: 'valid_key',
    });

    // Stub getModels so model validation in apiRouter passes without hitting
    // the mock HTTP server's /models endpoint (which is not served).
    // The single model returned is what the mock chat completion server streams.
    provider.getModels = async ({ readyOnly = false } = {}) => ['test-model'];

    const reqEvents = {};
    const req = {
      method: 'POST',
      url: '/api/chat',
      headers: { 'content-type': 'application/json' },
      on: (event, handler) => {
        reqEvents[event] = handler;
        if (event === 'data') {
          handler(Buffer.from(JSON.stringify({
            messages: [{ role: 'user', content: 'Ping' }],
            model: 'test-model',
            stream: true,
          })));
        }
        if (event === 'end') {
          handler();
        }
      },
    };

    const writtenChunks = [];
    let ended = false;

    const res = {
      setHeader: () => {},
      writeHead: () => {},
      write: (data) => { writtenChunks.push(data); },
      end: () => { ended = true; },
      get writableEnded() { return ended; },
    };

    const handled = await handleApiRequest(req, res, provider);
    assert.equal(handled, true);
    assert.equal(ended, true);

    const combinedOutput = writtenChunks.join('');
    assert.ok(combinedOutput.includes('"token":"Hi"'));
    assert.ok(combinedOutput.includes('"done":true'));
  });

  it('handles GET /api/settings and POST /api/settings securely', async () => {
    // 1. Post new settings
    const postReq = {
      method: 'POST',
      url: '/api/settings',
      headers: { 'content-type': 'application/json' },
      on: (event, handler) => {
        if (event === 'data') {
          handler(Buffer.from(JSON.stringify({
            baseUrl: 'http://custom-host:8080/v1',
            apiKey: 'sk-test-secret-12345678',
            model: 'custom-model',
          })));
        }
        if (event === 'end') handler();
      },
    };

    let postStatus;
    let postBody = '';
    const postRes = {
      setHeader: () => {},
      set statusCode(c) { postStatus = c; },
      get statusCode() { return postStatus; },
      end: (data) => { postBody = data; },
    };

    const postHandled = await handleApiRequest(postReq, postRes);
    assert.equal(postHandled, true);
    assert.equal(postStatus, 200);
    const postParsed = JSON.parse(postBody);
    assert.equal(postParsed.ok, true);

    // 2. Get settings to verify persistence and key masking
    const getReq = {
      method: 'GET',
      url: '/api/settings',
      headers: {},
      on: () => {},
    };

    let getStatus;
    let getBody = '';
    const getRes = {
      setHeader: () => {},
      set statusCode(c) { getStatus = c; },
      get statusCode() { return getStatus; },
      end: (data) => { getBody = data; },
    };

    const getHandled = await handleApiRequest(getReq, getRes);
    assert.equal(getHandled, true);
    assert.equal(getStatus, 200);

    const getParsed = JSON.parse(getBody);
    assert.equal(getParsed.ok, true);
    assert.equal(getParsed.baseUrl, 'http://custom-host:8080/v1');
    assert.equal(getParsed.model, 'custom-model');
    assert.equal(getParsed.apiKeySet, true);
    // API key should be masked and not expose the full secret
    assert.ok(getParsed.apiKeyMasked.includes('••'));
    assert.equal(getBody.includes('sk-test-secret-12345678'), false, 'Raw API key must never be exposed');
  });
});

