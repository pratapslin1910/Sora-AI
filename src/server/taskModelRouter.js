/**
 * Task-aware routing for OpenAI-compatible FreeLLMAPI model IDs.
 * The provider exposes model IDs, not reliable capability metadata, so this
 * uses conservative name heuristics and supports per-task user overrides.
 */
export const MODEL_TASK_TYPES = Object.freeze([
  'reasoning',
  'coding',
  'vision',
  'research',
  'assistant',
]);

function normalizedId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeModelTaskType(taskType) {
  return MODEL_TASK_TYPES.includes(taskType) ? taskType : 'reasoning';
}

/**
 * Resolve a model request without confusing model-catalogue visibility with
 * upstream provider availability.
 *
 * FreeLLMAPI /models lists IDs, but does not promise that an ID has a usable
 * provider key or quota. Auto therefore delegates selection to the gateway's
 * own availability-aware router. Only explicit task overrides or Manual mode
 * pin a concrete model ID.
 */
export function selectTaskModel({
  taskType = 'reasoning',
  availableModels = [],
  defaultModel = 'auto',
  routingMode = 'auto',
  taskModels = {},
} = {}) {
  const task = normalizeModelTaskType(taskType);
  const catalog = [...new Set((Array.isArray(availableModels) ? availableModels : [])
    .map(normalizedId).filter(Boolean))];
  const defaultId = normalizedId(defaultModel) || 'auto';

  if (routingMode === 'manual') {
    return {
      model: defaultId,
      task,
      reason: 'Manual routing is enabled; the configured global model is pinned for all tasks.',
    };
  }

  const override = normalizedId(taskModels?.[task]);
  if (override && override.toLowerCase() !== 'auto') {
    if (catalog.length === 0 || catalog.includes(override)) {
      return { model: override, task, reason: 'Explicit model override for this task.' };
    }
    return {
      model: 'auto',
      task,
      reason: 'The saved task override is not present in the current catalogue; delegated to FreeLLMAPI Auto.',
      warning: 'The configured per-task model is no longer listed by FreeLLMAPI. Auto routing is being used instead.',
    };
  }

  return {
    model: 'auto',
    task,
    reason: catalog.length
      ? 'Auto mode delegates provider availability and model selection to FreeLLMAPI; catalogue presence alone does not prove a usable key or quota.'
      : 'Model catalogue unavailable; delegated selection to FreeLLMAPI Auto.',
  };
}

const modelCatalogCache = new WeakMap();
const MODEL_CATALOG_TTL_MS = 2 * 60 * 1000;

export function cacheProviderModels(provider, models) {
  if (!provider || typeof provider !== 'object' || !Array.isArray(models)) return;
  const cleanModels = [...new Set(models.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim()))];
  modelCatalogCache.set(provider, { models: cleanModels, cachedAt: Date.now() });
}

export function getCachedProviderModels(provider) {
  if (!provider || typeof provider !== 'object') return [];
  const cached = modelCatalogCache.get(provider);
  if (!cached || Date.now() - cached.cachedAt > MODEL_CATALOG_TTL_MS) return [];
  return cached.models;
}
