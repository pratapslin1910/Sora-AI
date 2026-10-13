import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheProviderModels,
  getCachedProviderModels,
  normalizeModelTaskType,
  selectTaskModel,
} from '../src/server/taskModelRouter.js';

test('task model router selects explicit specialist model IDs from the provider catalogue', () => {
  const models = [
    'chat-general-8b-instruct',
    'deepseek-r1-32b',
    'qwen2.5-coder-32b-instruct',
    'qwen2.5-vl-8b-instruct',
    'embedding-large',
    'reranker-v2',
  ];

  assert.equal(selectTaskModel({ taskType: 'reasoning', availableModels: models }).model, 'deepseek-r1-32b');
  assert.equal(selectTaskModel({ taskType: 'coding', availableModels: models }).model, 'qwen2.5-coder-32b-instruct');
  assert.equal(selectTaskModel({ taskType: 'vision', availableModels: models }).model, 'qwen2.5-vl-8b-instruct');
  assert.notEqual(selectTaskModel({ taskType: 'assistant', availableModels: models }).model, 'embedding-large');
  assert.notEqual(selectTaskModel({ taskType: 'research', availableModels: models }).model, 'reranker-v2');
});

test('general assistant tasks prefer a general chat model over coding/reasoning specialists', () => {
  const result = selectTaskModel({
    taskType: 'assistant',
    availableModels: ['chat-general-8b-instruct', 'deepseek-r1-32b', 'qwen2.5-coder-32b-instruct'],
  });
  assert.equal(result.model, 'chat-general-8b-instruct');
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

test('a valid per-task override takes priority in Auto mode', () => {
  const result = selectTaskModel({
    taskType: 'coding',
    availableModels: ['qwen2.5-coder-32b-instruct', 'codestral-22b'],
    defaultModel: 'auto',
    taskModels: { coding: 'codestral-22b' },
  });
  assert.equal(result.model, 'codestral-22b');
  assert.match(result.reason, /override/i);
});

test('stale overrides are ignored when a non-empty current catalogue exists', () => {
  const result = selectTaskModel({
    taskType: 'coding',
    availableModels: ['deepseek-r1-32b', 'qwen2.5-coder-32b-instruct'],
    taskModels: { coding: 'deleted-old-coder' },
  });
  assert.equal(result.model, 'qwen2.5-coder-32b-instruct');
});

test('vision never assumes an ordinary text model supports images', () => {
  const listedTextOnly = selectTaskModel({
    taskType: 'vision',
    availableModels: ['llama-3.1-8b-instruct', 'qwen2.5-14b-instruct'],
    defaultModel: 'qwen2.5-14b-instruct',
  });
  assert.equal(listedTextOnly.model, 'auto');
  assert.match(listedTextOnly.warning, /vision-capable/i);

  const noCatalogue = selectTaskModel({ taskType: 'vision', availableModels: [], defaultModel: 'qwen2.5-14b-instruct' });
  assert.equal(noCatalogue.model, 'auto');
  assert.ok(noCatalogue.warning);
});

test('unknown task types safely normalize to reasoning', () => {
  assert.equal(normalizeModelTaskType('terminal'), 'reasoning');
  assert.equal(normalizeModelTaskType('coding'), 'coding');
  assert.equal(selectTaskModel({ taskType: 'terminal', availableModels: ['deepseek-r1-32b'] }).model, 'deepseek-r1-32b');
});

test('provider model cache is isolated by provider instance and de-duplicates IDs', () => {
  const firstProvider = {};
  const secondProvider = {};
  cacheProviderModels(firstProvider, ['model-a', ' model-b ', 'model-a', '']);
  assert.deepEqual(getCachedProviderModels(firstProvider), ['model-a', 'model-b']);
  assert.deepEqual(getCachedProviderModels(secondProvider), []);
});
