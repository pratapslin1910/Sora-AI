import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleApiRequest } from '../src/server/apiRouter.js';
import { FreeLLMAPIProvider } from '../src/server/FreeLLMAPIProvider.js';

function createMockReqRes({ method = 'GET', url = '/api/models', body = null } = {}) {
  const req = new http.IncomingMessage(null);
  req.method = method;
  req.url = url;
  if (body) {
    req.push(typeof body === 'string' ? body : JSON.stringify(body));
  }
  req.push(null);

  let statusCode = 200;
  let headers = {};
  let responseData = '';
  const writtenChunks = [];

  const res = new http.ServerResponse(req);
  res.writeHead = (code, h) => {
    statusCode = code;
    if (h) Object.assign(headers, h);
    return res;
  };
  res.setHeader = (k, v) => {
    headers[k.toLowerCase()] = v;
  };
  res.write = (chunk) => {
    writtenChunks.push(String(chunk));
    return true;
  };
  res.end = (chunk) => {
    if (chunk) responseData += chunk;
  };

  return {
    req,
    res,
    getStatusCode: () => res.statusCode || statusCode,
    getHeaders: () => headers,
    getWrittenChunks: () => writtenChunks,
    getBody: () => {
      try {
        return JSON.parse(responseData);
      } catch {
        return responseData;
      }
    },
  };
}

test('Model Validation Regression Suite', async (t) => {
  await t.test('1. GET /api/models returns ready concrete models and full catalog', async () => {
    const mockProvider = new FreeLLMAPIProvider();
    mockProvider.getModelCatalogue = async ({ filter = '' } = {}) => {
      if (filter === 'ready') {
        return [
          { id: 'gemini-2.5-flash', execution_status: 'ready' },
          { id: 'deepseek-chat', execution_status: 'ready' },
          { id: 'auto', execution_status: 'ready' },
        ];
      }
      return [
        { id: 'gemini-2.5-flash', execution_status: 'ready' },
        { id: 'deepseek-chat', execution_status: 'ready' },
        { id: 'qwen3-32b', execution_status: 'needsKey' },
        { id: 'auto', execution_status: 'ready' },
        { id: 'fusion', execution_status: 'ready' },
      ];
    };

    const { req, res, getStatusCode, getBody } = createMockReqRes({ method: 'GET', url: '/api/models' });
    const handled = await handleApiRequest(req, res, mockProvider);

    assert.equal(handled, true);
    assert.equal(getStatusCode(), 200);
    const body = getBody();
    assert.equal(body.ok, true);
    assert.deepEqual(body.models, ['gemini-2.5-flash', 'deepseek-chat']);
    assert.deepEqual(body.allModels, ['gemini-2.5-flash', 'deepseek-chat', 'qwen3-32b']);
    assert.equal(body.count, 2);
    assert.equal(body.catalogCount, 3);
  });

  await t.test('2. GET /api/models returns 502 when discovery fails', async () => {
    const mockProvider = new FreeLLMAPIProvider();
    mockProvider.getModels = async () => {
      throw new Error('Connection refused by FreeLLMAPI gateway');
    };

    const { req, res, getStatusCode, getBody } = createMockReqRes({ method: 'GET', url: '/api/models' });
    const handled = await handleApiRequest(req, res, mockProvider);

    assert.equal(handled, true);
    assert.equal(getStatusCode(), 502);
    const body = getBody();
    assert.equal(body.ok, false);
    assert.deepEqual(body.models, []);
    assert.deepEqual(body.allModels, []);
  });

  await t.test('3. POST /api/chat Auto mode selects ready concrete model for text turn', async () => {
    const mockProvider = new FreeLLMAPIProvider();
    mockProvider.getModels = async ({ readyOnly = false } = {}) => {
      return ['gemini-2.5-flash'];
    };
    let streamedModel = '';
    mockProvider.streamChat = async ({ messages, model, onToken, onDone }) => {
      streamedModel = model;
      onToken('Hello! I was routed successfully.');
      onDone();
      return 'Hello! I was routed successfully.';
    };

    const { req, res, getStatusCode, getWrittenChunks } = createMockReqRes({
      method: 'POST',
      url: '/api/chat',
      body: {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'auto',
        stream: true,
      },
    });

    const handled = await handleApiRequest(req, res, mockProvider);
    assert.equal(handled, true);
    assert.equal(getStatusCode(), 200);
    assert.equal(streamedModel, 'gemini-2.5-flash');

    const chunks = getWrittenChunks();
    const hasSelectedModelEvent = chunks.some((c) => c.includes('"selectedModel":"gemini-2.5-flash"'));
    assert.ok(hasSelectedModelEvent, 'Must emit selectedModel SSE event');
  });

  await t.test('4. POST /api/chat preserves auto routing for vision requests', async () => {
    const mockProvider = new FreeLLMAPIProvider();
    let streamedModel = '';
    mockProvider.streamChat = async ({ model, onToken, onDone }) => {
      streamedModel = model;
      onToken('Vision analysis');
      onDone();
      return 'Vision analysis';
    };

    const { req, res, getStatusCode } = createMockReqRes({
      method: 'POST',
      url: '/api/chat',
      body: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } },
            ],
          },
        ],
        model: 'auto',
        stream: true,
      },
    });

    const handled = await handleApiRequest(req, res, mockProvider);
    assert.equal(handled, true);
    assert.equal(getStatusCode(), 200);
    assert.equal(streamedModel, 'auto', 'Vision requests with model=auto must delegate to upstream auto');
  });

  await t.test('5. POST /api/chat rejects stale/unavailable manually selected model with 400', async () => {
    const mockProvider = new FreeLLMAPIProvider();
    mockProvider.getModels = async ({ readyOnly = false } = {}) => {
      return ['gemini-2.5-flash'];
    };

    const { req, res, getStatusCode, getBody } = createMockReqRes({
      method: 'POST',
      url: '/api/chat',
      body: {
        messages: [{ role: 'user', content: 'Ping' }],
        model: 'unavailable-model-xyz',
        stream: false,
      },
    });

    const handled = await handleApiRequest(req, res, mockProvider);
    assert.equal(handled, true);
    assert.equal(getStatusCode(), 400);
    const body = getBody();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'model_unavailable');
    assert.match(body.error, /is not currently available/i);
    assert.deepEqual(body.availableModels, ['gemini-2.5-flash']);
  });

  await t.test('6. POST /api/chat returns 503 when no ready models exist for Auto', async () => {
    const mockProvider = new FreeLLMAPIProvider();
    mockProvider.getModels = async ({ readyOnly = false } = {}) => {
      return [];
    };

    const { req, res, getStatusCode, getBody } = createMockReqRes({
      method: 'POST',
      url: '/api/chat',
      body: {
        messages: [{ role: 'user', content: 'Ping' }],
        model: 'auto',
        stream: false,
      },
    });

    const handled = await handleApiRequest(req, res, mockProvider);
    assert.equal(handled, true);
    assert.equal(getStatusCode(), 503);
    const body = getBody();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'no_ready_models');
  });

  await t.test('7. POST /api/settings preserves other fields when saving', async () => {
    // 1. Initial settings save
    const { req: req1, res: res1 } = createMockReqRes({
      method: 'POST',
      url: '/api/settings',
      body: {
        baseUrl: 'http://127.0.0.1:31415/v1',
        apiKey: 'sk-test-secret',
        model: 'auto',
        permissionAllowance: 'sandbox',
        copilotSecurityMode: 'full_access',
        modelRoutingMode: 'auto',
        taskModels: { coding: 'qwen2.5-coder-32b-instruct' },
      },
    });
    await handleApiRequest(req1, res1);

    // 2. Partial save (e.g. updating model without retyping API key)
    const { req: req2, res: res2, getStatusCode: getStatusCode2 } = createMockReqRes({
      method: 'POST',
      url: '/api/settings',
      body: {
        model: 'gemini-2.5-flash',
        apiKey: '••••••••', // masked key should not overwrite real key
      },
    });
    await handleApiRequest(req2, res2);
    assert.equal(getStatusCode2(), 200);

    // 3. Inspect saved settings
    const { req: req3, res: res3, getBody: getBody3 } = createMockReqRes({
      method: 'GET',
      url: '/api/settings',
    });
    await handleApiRequest(req3, res3);
    const saved = getBody3();

    assert.equal(saved.model, 'gemini-2.5-flash');
    assert.equal(saved.apiKeySet, true);
    assert.equal(saved.permissionAllowance, 'sandbox');
    assert.equal(saved.copilotSecurityMode, 'full_access');
    assert.equal(saved.taskModels?.coding, 'qwen2.5-coder-32b-instruct');
  });

  await t.test('8. Task-aware routing: uses task override if ready, falls back to ready model if stale', async () => {
    const mockProvider = new FreeLLMAPIProvider();
    mockProvider.getModels = async ({ readyOnly = false } = {}) => {
      return ['gemini-2.5-flash', 'qwen2.5-coder-32b-instruct'];
    };

    let streamedModel = '';
    mockProvider.streamChat = async ({ model, onToken, onDone }) => {
      streamedModel = model;
      onToken('Response');
      onDone();
      return 'Response';
    };

    // Set taskModels in settings
    const { req: sReq, res: sRes } = createMockReqRes({
      method: 'POST',
      url: '/api/settings',
      body: {
        taskModels: {
          coding: 'qwen2.5-coder-32b-instruct',
          analysis: 'offline-analysis-model',
        },
      },
    });
    await handleApiRequest(sReq, sRes);

    // Request 1: coding task with ready override model
    const { req: req1, res: res1 } = createMockReqRes({
      method: 'POST',
      url: '/api/chat',
      body: {
        messages: [{ role: 'user', content: 'Write a python script' }],
        model: 'auto',
        taskType: 'coding',
        stream: true,
      },
    });
    await handleApiRequest(req1, res1, mockProvider);
    assert.equal(streamedModel, 'qwen2.5-coder-32b-instruct', 'Should select ready task override model');

    // Request 2: analysis task with stale/unavailable override model
    const { req: req2, res: res2 } = createMockReqRes({
      method: 'POST',
      url: '/api/chat',
      body: {
        messages: [{ role: 'user', content: 'Analyze this report' }],
        model: 'auto',
        taskType: 'analysis',
        stream: true,
      },
    });
    await handleApiRequest(req2, res2, mockProvider);
    assert.notEqual(streamedModel, 'offline-analysis-model', 'Should not select unavailable task override');
    assert.ok(
      ['gemini-2.5-flash', 'qwen2.5-coder-32b-instruct'].includes(streamedModel),
      'Should fall back to an available ready concrete model'
    );
  });
});
