import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseRandomModel,
  getConcreteModelIds,
  getReadyModelIds,
  isConcreteModelId,
  isRouterModelId,
} from '../src/server/modelRouting.js';

const catalogue = [
  { id: 'gemini-2.5-flash', execution_status: 'ready' },
  { id: 'qwen3-32b', execution_status: 'needsKey' },
  { id: 'deepseek-chat', execution_status: 'ready' },
  { id: 'blocked-model', execution_status: 'exhausted' },
  { id: 'auto', execution_status: 'ready' },
  { id: 'auto:fast', execution_status: 'ready' },
  { id: 'fusion', execution_status: 'ready' },
  { id: 'gemini-2.5-flash', execution_status: 'ready' },
];

test('only ready concrete models are selectable', () => {
  assert.deepEqual(getReadyModelIds(catalogue), ['gemini-2.5-flash', 'deepseek-chat']);
});

test('full concrete catalogue excludes virtual routing entries and deduplicates IDs', () => {
  assert.deepEqual(getConcreteModelIds(catalogue), [
    'gemini-2.5-flash',
    'qwen3-32b',
    'deepseek-chat',
    'blocked-model',
  ]);
});

test('router aliases are not classified as concrete models', () => {
  assert.equal(isRouterModelId('auto'), true);
  assert.equal(isRouterModelId('AUTO:fast'), true);
  assert.equal(isRouterModelId('fusion'), true);
  assert.equal(isConcreteModelId('auto'), false);
  assert.equal(isConcreteModelId('fusion'), false);
  assert.equal(isConcreteModelId('deepseek-chat'), true);
});

test('random selection chooses only from supplied available concrete models', () => {
  const available = getReadyModelIds(catalogue);
  assert.equal(chooseRandomModel(available, () => 0), 'gemini-2.5-flash');
  assert.equal(chooseRandomModel(available, () => 0.99), 'deepseek-chat');
});

test('random selection fails clearly when no concrete models are available', () => {
  assert.throws(() => chooseRandomModel(['auto', 'fusion', 'auto:fast']), /no ready concrete models/i);
});
