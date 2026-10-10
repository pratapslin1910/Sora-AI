/**
 * Tool Execution Bridge for SORA Modular Tool Extensions
 *
 * Bridges SORA Core agent execution requests to registered extension tools.
 * Handles schema validation, permission checks, safe execution, and structured results.
 */

/**
 * Basic JSON Schema validator for tool arguments.
 *
 * @param {Object} schema JSON Schema definition
 * @param {Object} args Arguments provided by caller
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateArguments(schema, args = {}) {
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    return { valid: true, errors: [] };
  }

  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return { valid: false, errors: ['Tool arguments must be a JSON object'] };
  }

  // Check required properties
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const reqKey of required) {
    if (args[reqKey] === undefined || args[reqKey] === null || args[reqKey] === '') {
      errors.push(`Missing required parameter: "${reqKey}"`);
    }
  }

  // Check types of provided properties
  const properties = schema.properties || {};
  for (const [key, val] of Object.entries(args)) {
    const propSchema = properties[key];
    if (!propSchema) continue;

    if (val === undefined || val === null) continue;

    const expectedType = propSchema.type;
    if (expectedType === 'string' && typeof val !== 'string') {
      errors.push(`Parameter "${key}" must be a string, got ${typeof val}`);
    } else if (expectedType === 'number' && typeof val !== 'number') {
      errors.push(`Parameter "${key}" must be a number, got ${typeof val}`);
    } else if (expectedType === 'boolean' && typeof val !== 'boolean') {
      errors.push(`Parameter "${key}" must be a boolean, got ${typeof val}`);
    } else if (expectedType === 'array') {
      if (!Array.isArray(val)) {
        if (typeof val === 'string') {
          // LLMs frequently pass command line strings or flags for array parameters.
          // Auto-coerce string to array so execution proceeds without breaking.
          args[key] = [val];
        } else {
          errors.push(`Parameter "${key}" must be an array, got ${typeof val}`);
        }
      }
    } else if (expectedType === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
      errors.push(`Parameter "${key}" must be an object, got ${typeof val}`);
    }

    if (Array.isArray(propSchema.enum) && !propSchema.enum.includes(val)) {
      errors.push(`Parameter "${key}" must be one of: [${propSchema.enum.join(', ')}], got "${val}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export class ToolExecutionBridge {
  /**
   * @param {import('./toolRegistry.js').ToolRegistry} toolRegistry
   * @param {import('./permissionManager.js').PermissionManager} permissionManager
   * @param {import('./extensionLoader.js').ExtensionLoader} extensionLoader
   * @param {Function} [getConfigCallback] Callback returning (extensionId) -> config
   */
  constructor(toolRegistry, permissionManager, extensionLoader, getConfigCallback = () => ({})) {
    this.toolRegistry = toolRegistry;
    this.permissionManager = permissionManager;
    this.extensionLoader = extensionLoader;
    this.getConfigCallback = getConfigCallback;
  }

  /**
   * Execute a tool by name with arguments.
   *
   * @param {string} toolName
   * @param {Record<string, any>} args
   * @param {Object} [executionOverrides]
   * @returns {Promise<{ ok: boolean, data?: any, error?: string, executionTimeMs: number }>}
   */
  async executeTool(toolName, args = {}, executionOverrides = {}) {
    const startTime = Date.now();

    try {
      if (!toolName || typeof toolName !== 'string') {
        return {
          ok: false,
          error: 'Tool name is required',
          executionTimeMs: 0,
        };
      }

      const toolEntry = this.toolRegistry.getTool(toolName);
      if (!toolEntry) {
        return {
          ok: false,
          error: `Tool "${toolName}" is not registered or its extension is disabled.`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      const { extensionId, toolDef, handler } = toolEntry;
      const extensionConfig = this.getConfigCallback(extensionId) || {};

      // 1. Validate arguments
      const validation = validateArguments(toolDef.parameters, args);
      if (!validation.valid) {
        return {
          ok: false,
          error: `Argument validation failed: ${validation.errors.join('; ')}`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // 2. Check permissions & safeguards
      const permCheck = this.permissionManager.checkExecutionPermission(
        extensionId,
        toolDef,
        args,
        extensionConfig,
        executionOverrides
      );

      if (!permCheck.allowed) {
        return {
          ok: false,
          error: permCheck.reason || 'Permission denied',
          requiresConfirmation: Boolean(permCheck.requiresConfirmation),
          executionTimeMs: Date.now() - startTime,
        };
      }

      // 3. Prepare execution context
      const context = {
        extensionId,
        toolName,
        config: extensionConfig,
        permissions: this.permissionManager.getPermissions(extensionId),
        workspaceRoot: executionOverrides.workspaceRoot || process.cwd(),
      };

      const timeoutMs = extensionConfig.timeoutSeconds
        ? extensionConfig.timeoutSeconds * 1000
        : (toolDef.timeoutMs || 30000);

      // 4. Safely invoke handler
      const result = await this.extensionLoader.invokeHandler(handler, args, context, timeoutMs);

      const executionTimeMs = Date.now() - startTime;
      return {
        ...result,
        executionTimeMs,
      };
    } catch (err) {
      return {
        ok: false,
        error: `Unexpected error executing tool "${toolName}": ${err?.message || String(err)}`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}
