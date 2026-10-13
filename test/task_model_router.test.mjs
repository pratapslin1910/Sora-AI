import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheProviderModels,
  getCachedProviderModels,
  normalizeModelTaskType,
  selectTaskModel,
} from '../src/server/taskModelRouter.js';

test('Auto mode delegates model availability and selection to FreeLLMAPI even when many IDs are listed', () => {
  const models = [
    'chat-general-8b-instruct',
    'deepseek-r1-32b',
    'qwen2.5-coder-32b-instruct',
    'qwen2.5-vl-8b-instruct',
    'embedding-large',
    'reranker-v2',
  ];

  for (const taskType of ['reasoning', 'coding', 'vision', 'research', 'assistant']) {
    const result = selectTaskModel({ taskType, availableModels: models, defaultModel: 'qwen3-235b-a22b-thinking-25' });
    assert.equal(result.model, 'auto', taskType + ' should delegate provider availability to FreeLLMAPI');
    assert.match(result.reason, /delegates provider availability/i);
  }
});

test('Auto ignores an unavailable configured default even if it looks like a strong model', () => {
  const result = selectTaskModel({
    taskType: 'reasoning',
    availableModels: ['chat-general-8b-instruct'],
    defaultModel: 'qwen3-235b-a22b-thinking-25',
    routingMode: 'auto',
  });
  assert.equal(result.model, 'auto');
});

test('manual mode pins one configured model and ignores specialist candidates', () => {
  const result = selectTaskModel({
    taskType: 'coding',
    availableModels: ['qwen2.5-coder-32b-instruct', 'deepseek-r1-32b'],
    defaultModel: 'chat-general-8b-instruct',
    routingMode: 'manual',
  });
  assert.equal(result.model, 'chat-general-8b-instruct');
});

test('a valid explicit per-task override can pin a model in Auto mode', () => {
  const result = selectTaskModel({
    taskType: 'coding',
    availableModels: ['qwen2.5-coder-32b-instruct', 'codestral-22b'],
    defaultModel: 'auto',
    taskModels: { coding: 'codestral-22b' },
  });
  assert.equal(result.model, 'codestral-22b');
  assert.match(result.reason, /override/i);
});

test('stale overrides are ignored and Auto is delegated to the gateway', () => {
  const result = selectTaskModel({
    taskType: 'coding',
    availableModels: ['deepseek-r1-32b', 'qwen2.5-coder-32b-instruct'],
    taskModels: { coding: 'deleted-old-coder' },
  });
  assert.equal(result.model, 'auto');
  assert.match(result.reason, /FreeLLMAPI Auto/i);
});

test('vision Auto routing delegates to FreeLLMAPI rather than guessing a text-only or vision model', () => {
  const listedTextOnly = selectTaskModel({
    taskType: 'vision',
    availableModels: ['llama-3.1-8b-instruct', 'qwen2.5-14b-instruct'],
    defaultModel: 'qwen2.5-14b-instruct',
  });
  assert.equal(listedTextOnly.model, 'auto');

  const catalogueHasVision = selectTaskModel({
    taskType: 'vision',
    availableModels: ['llama-3.1-8b-instruct', 'qwen2.5-vl-8b-instruct'],
  });
  assert.equal(catalogueHasVision.model, 'auto');

  const noCatalogue = selectTaskModel({ taskType: 'vision', availableModels: [], defaultModel: 'qwen2.5-14b-instruct' });
  assert.equal(noCatalogue.model, 'auto');
});

test('unknown task types safely normalize to reasoning', () => {
  assert.equal(normalizeModelTaskType('terminal'), 'reasoning');
  assert.equal(normalizeModelTaskType('coding'), 'coding');
  assert.equal(selectTaskModel({ taskType: 'terminal', availableModels: ['deepseek-r1-32b'] }).model, 'auto');
});

test('provider model cache is isolated by provider instance and de-duplicates IDs', () => {
  const firstProvider = {};
  const secondProvider = {};
  cacheProviderModels(firstProvider, ['model-a', ' model-b ', 'model-a', '']);
  assert.deepEqual(getCachedProviderModels(firstProvider), ['model-a', 'model-b']);
  assert.deepEqual(getCachedProviderModels(secondProvider), []);
});
