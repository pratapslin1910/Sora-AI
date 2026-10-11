import path from 'node:path';

const SENSITIVE_NAME = /(?:secret|credential|token|apikey|api[-_.]?key|password|passwd|sora_settings|settings|config)/i;
const SENSITIVE_CONTENT = /(?:api[_-]?key|base[_-]?url|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)/i;

export function isSensitiveWorkspacePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\\\/g, '/').replace(/^\/+/, '');
  const basename = path.posix.basename(normalized);
  return basename === '.env' ||
    basename.startsWith('.env.') ||
    SENSITIVE_NAME.test(basename) ||
    normalized.toLowerCase() === 'data/sora_settings.json';
}

export function requiresWorkspaceOperationConfirmation({ operation, relativePath, existingContent = '', newContent = '' }) {
  const normalized = String(relativePath || '').replace(/\\\\/g, '/');
  const ext = path.posix.extname(normalized).toLowerCase();
  if (operation === 'delete' || operation === 'rename') {
    return true;
  }
  if (operation !== 'write' || existingContent === null || existingContent === undefined) {
    return false;
  }
  if (isSensitiveWorkspacePath(normalized) || ext === '.json') {
    return true;
  }
  if (String(newContent).trim().length === 0 && String(existingContent).length > 0) {
    return true;
  }
  if (SENSITIVE_CONTENT.test(existingContent)) {
    const oldKeys = String(existingContent).split(/\r?\n/).filter((line) => SENSITIVE_CONTENT.test(line));
    const newText = String(newContent);
    if (oldKeys.some((line) => {
      const key = line.split(/[:=]/, 1)[0].trim();
      return key && !new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(newText);
    })) return true;
  }
  const oldLength = String(existingContent).length;
  const newLength = String(newContent).length;
  return oldLength >= 200 && newLength < oldLength * 0.6;
}

export function shouldRequireConfirmationForDelete(relativePath) {
  const normalized = String(relativePath || '').replace(/\\\\/g, '/');
  return path.posix.extname(normalized).toLowerCase() === '.json' ||
    isSensitiveWorkspacePath(normalized) ||
    path.posix.basename(normalized).startsWith('.env');
}
