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

const NON_CHAT_MODEL = /(?:embed(?:ding)?|rerank(?:er)?|moderation|whisper|text-to-speech|tts-|speech-to-text|image-generation|flux-|stable-diffusion|guardrail)/i;
const VISION_MODEL = /(?:vision|llava|pixtral|internvl|molmo|florence|qwen[^/]*[-.]vl(?:[-/.]|$)|(?:^|[/_-])vl(?:[-/.]|$)|llama[^/]*vision|phi-3-vision|gemma-3(?:-|\/|$)|mistral-small-3\.1|multimodal)/i;
const CODING_MODEL = /(?:coder|codestral|devstral|starcoder|codegemma|granite[-/]code|wizardcoder|deepseek[^/]*coder|qwen[^/]*coder|opencoder|codeqwen|code[- ]?instruct)/i;
const REASONING_MODEL = /(?:reason(?:ing)?|thinking|qwq|deepseek[^/]*r1|(?:^|[-/])r1(?:[-/.]|$)|(?:^|[-/])o[134](?:[-/.]|$)|magistral|phi-4-reason)/i;
const RESEARCH_MODEL = /(?:research|browse|web[-_]?search|command-r(?:-plus)?|deepseek[^/]*v3|sonnet|opus|gemini[^/]*pro|gpt-?4|gpt-?5|long[-_]?context|128k|200k)/i;
const GENERAL_MODEL = /(?:instruct|chat|sonnet|opus|pro|plus|gpt|gemini|llama|qwen|mistral|command|deepseek|large|max|flagship)/i;

function normalizedId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeModelTaskType(taskType) {
  return MODEL_TASK_TYPES.includes(taskType) ? taskType : 'reasoning';
}

function modelSizeScore(id) {
  const matches = [...id.matchAll(/(?:^|[-_/])(\d+(?:\.\d+)?)\s*([bm])(?:[-_/]|$)/ig)];
  if (!matches.length) return 0;
  return Math.max(...matches.map((match) => {
    const amount = Number(match[1]);
    return Number.isFinite(amount) ? Math.min(match[2].toLowerCase() === 'b' ? amount : amount / 1000, 500) : 0;
  }));
}

function scoreModelForTask(model, taskType) {
  const id = normalizedId(model);
  const lower = id.toLowerCase();
  if (!id || NON_CHAT_MODEL.test(lower)) return Number.NEGATIVE_INFINITY;

  const isVision = VISION_MODEL.test(lower);
  if (taskType === 'vision') {
    if (!isVision) return Number.NEGATIVE_INFINITY;
    return 1000 + modelSizeScore(lower) + (/instruct|chat|it\b/i.test(lower) ? 10 : 0);
  }
  if (isVision) return Number.NEGATIVE_INFINITY;

  let score = modelSizeScore(lower);
  if (GENERAL_MODEL.test(lower)) score += 20;
  if (/mini|small|3b|4b|7b|8b|flash|lite/i.test(lower)) score -= 8;
  if (/pro|opus|sonnet|plus|flagship|max|turbo/i.test(lower)) score += 12;

  if (taskType === 'coding' && CODING_MODEL.test(lower)) score += 1000;
  if (taskType === 'reasoning' && REASONING_MODEL.test(lower)) score += 1000;
  if (taskType === 'research' && RESEARCH_MODEL.test(lower)) score += 1000;
  if (taskType === 'assistant' && /(?:assistant|instruct|chat|general|plus|pro|opus|sonnet)/i.test(lower)) score += 150;
  return score;
}

/**
 * Choose the model ID to send to /chat/completions.
 * Manual routing pins the global model; Auto routes by task and optional overrides.
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
      reason: 'Manual routing is enabled; the global model is pinned for all tasks.',
    };
  }

  const override = normalizedId(taskModels?.[task]);
  if (override && override.toLowerCase() !== 'auto') {
    if (catalog.length === 0 || catalog.includes(override)) {
      return { model: override, task, reason: 'Explicit model override for this task.' };
    }
    // A stale saved override must not send an ID that FreeLLMAPI no longer lists.
  }

  if (!catalog.length) {
    // A vision request must not be sent to a configured text-only model just
    // because model discovery has not completed yet.
    if (task === 'vision') {
      return {
        model: 'auto',
        task,
        reason: 'Model catalogue unavailable; delegate vision-capability resolution to FreeLLMAPI auto routing.',
        warning: 'Model discovery is unavailable for this vision request. FreeLLMAPI auto routing will be used; configure a vision override if the gateway cannot route images.',
      };
    }
    return {
      model: defaultId.toLowerCase() === 'auto' ? 'auto' : defaultId,
      task,
      reason: 'Model catalogue unavailable; using the configured fallback.',
    };
  }

  const candidates = catalog
    .filter((id) => id.toLowerCase() !== 'auto')
    .map((id) => ({ id, score: scoreModelForTask(id, task) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (candidates.length > 0) {
    return { model: candidates[0].id, task, reason: 'Selected from FreeLLMAPI model catalogue for ' + task + '.' };
  }

  if (catalog.some((id) => id.toLowerCase() === 'auto')) {
    return { model: 'auto', task, reason: 'No confidently labelled specialist was found; delegate to FreeLLMAPI auto routing.' };
  }

  if (task === 'vision') {
    return {
      model: 'auto',
      task,
      reason: 'No explicitly vision-capable ID was listed; request gateway auto routing as a fallback.',
      warning: 'FreeLLMAPI does not list a model whose ID clearly identifies vision capability. Configure a vision model override if auto routing cannot process images.',
    };
  }

  const fallback = catalog
    .filter((id) => !NON_CHAT_MODEL.test(id))
    .map((id) => ({ id, score: modelSizeScore(id.toLowerCase()) + (GENERAL_MODEL.test(id) ? 20 : 0) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0];
  return {
    model: fallback?.id || defaultId,
    task,
    reason: 'No task-specific model name was detected; selected the best available general-chat fallback.',
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
