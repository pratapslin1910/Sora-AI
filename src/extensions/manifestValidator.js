/**
 * Manifest Validator for SORA Modular Tool Extensions
 *
 * Validates manifest.json structures according to the SORA Extension Contract.
 */

export const ALLOWED_PERMISSION_CATEGORIES = [
  'browser',
  'apps',
  'files',
  'terminal',
  'network',
  'clipboard',
  'system',
];

/**
 * Validates an extension manifest object.
 *
 * @param {any} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  // Required field: id
  if (typeof manifest.id !== 'string' || !manifest.id.trim()) {
    errors.push('Manifest "id" is required and must be a non-empty string');
  } else if (!/^[a-z0-9_-]+$/i.test(manifest.id.trim())) {
    errors.push('Manifest "id" must contain only letters, numbers, hyphens, and underscores');
  }

  // Required field: name
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
    errors.push('Manifest "name" is required and must be a non-empty string');
  }

  // Required field: version
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    errors.push('Manifest "version" is required and must be a non-empty string (e.g. "1.0.0")');
  }

  // Required field: description
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) {
    errors.push('Manifest "description" is required and must be a non-empty string');
  }

  // Required field: entry
  if (typeof manifest.entry !== 'string' || !manifest.entry.trim()) {
    errors.push('Manifest "entry" is required and must specify the entrypoint file (e.g. "index.js")');
  }

  // Permissions validation
  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions)) {
      errors.push('Manifest "permissions" must be an array of strings');
    } else {
      for (const perm of manifest.permissions) {
        if (typeof perm !== 'string') {
          errors.push(`Invalid permission: ${JSON.stringify(perm)} is not a string`);
        } else if (!ALLOWED_PERMISSION_CATEGORIES.includes(perm.toLowerCase())) {
          errors.push(`Permission "${perm}" is not recognized. Allowed: ${ALLOWED_PERMISSION_CATEGORIES.join(', ')}`);
        }
      }
    }
  }

  // Tools validation
  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    errors.push('Manifest "tools" must be an array containing at least one tool definition');
  } else {
    manifest.tools.forEach((tool, index) => {
      const toolRef = `Tool at index ${index} (${tool?.name || 'unnamed'})`;

      if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
        errors.push(`${toolRef} must be an object`);
        return;
      }

      if (typeof tool.name !== 'string' || !tool.name.trim()) {
        errors.push(`${toolRef}: "name" is required and must be a non-empty string`);
      } else if (!/^[a-z0-9_]+$/i.test(tool.name.trim())) {
        errors.push(`${toolRef}: "name" should contain only alphanumeric characters and underscores`);
      }

      if (typeof tool.description !== 'string' || !tool.description.trim()) {
        errors.push(`${toolRef}: "description" is required`);
      }

      if (tool.parameters !== undefined) {
        if (typeof tool.parameters !== 'object' || tool.parameters === null || Array.isArray(tool.parameters)) {
          errors.push(`${toolRef}: "parameters" must be a JSON Schema object`);
        } else if (tool.parameters.type && tool.parameters.type !== 'object') {
          errors.push(`${toolRef}: "parameters.type" must be "object" if specified`);
        }
      }
    });
  }

  // Configuration schema validation (optional)
  if (manifest.configuration !== undefined) {
    if (typeof manifest.configuration !== 'object' || manifest.configuration === null || Array.isArray(manifest.configuration)) {
      errors.push('Manifest "configuration" must be an object map of config keys');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
