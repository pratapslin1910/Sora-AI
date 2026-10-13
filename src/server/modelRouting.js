/**
 * Model selection helpers for the FreeLLMAPI catalogue.
 * Router aliases are valid request targets, but they are not concrete models
 * and must never be displayed as selectable concrete-model options.
 */

const ROUTER_MODEL_IDS = new Set(['auto', 'fusion']);

export function normalizeModelId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function isRouterModelId(value) {
  const id = normalizeModelId(value).toLowerCase();
  return ROUTER_MODEL_IDS.has(id) || id.startsWith('auto:');
}

export function isConcreteModelId(value) {
  const id = normalizeModelId(value);
  return Boolean(id) && !isRouterModelId(id);
}

function modelId(entry) {
  if (typeof entry === 'string') return normalizeModelId(entry);
  return normalizeModelId(entry?.id);
}

/** Return unique real model IDs from the full FreeLLMAPI catalogue. */
export function getConcreteModelIds(catalogue) {
  if (!Array.isArray(catalogue)) return [];
  return [...new Set(catalogue.map(modelId).filter(isConcreteModelId))];
}

/** Return only concrete models whose live execution status is exactly ready. */
export function getReadyModelIds(catalogue) {
  if (!Array.isArray(catalogue)) return [];
  const ready = catalogue.filter((entry) => {
    if (typeof entry === 'string') return false;
    return String(entry?.execution_status ?? entry?.executionStatus ?? '').toLowerCase() === 'ready';
  });
  return getConcreteModelIds(ready);
}

/** Select one concrete model uniformly at random; throws rather than inventing a fallback. */
export function chooseRandomModel(models, random = Math.random) {
  const candidates = [...new Set((Array.isArray(models) ? models : []).map(modelId).filter(isConcreteModelId))];
  if (candidates.length === 0) {
    throw new Error('FreeLLMAPI has no ready concrete models available.');
  }
  const value = Number(random());
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.9999999999999999) : 0;
  return candidates[Math.floor(normalized * candidates.length)];
}
