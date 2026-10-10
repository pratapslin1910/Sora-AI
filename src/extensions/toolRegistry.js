/**
 * Tool Registry for SORA Modular Tool Extensions
 *
 * Dynamically registers enabled tools and exposes their descriptions and schemas
 * to SORA Core reasoning and agent execution pipeline.
 */

export class ToolRegistry {
  constructor() {
    /**
     * Map of toolName -> { extensionId, toolDef, handler }
     * @type {Map<string, { extensionId: string, toolDef: any, handler: Function }>}
     */
    this._tools = new Map();
  }

  /**
   * Register a tool with its definition and execution handler.
   *
   * @param {string} extensionId
   * @param {Object} toolDef
   * @param {Function} handler
   */
  registerTool(extensionId, toolDef, handler) {
    if (!toolDef || typeof toolDef.name !== 'string') {
      throw new Error('Invalid tool definition: "name" is required');
    }
    if (typeof handler !== 'function') {
      throw new Error(`Tool handler for "${toolDef.name}" must be a function`);
    }

    const toolName = toolDef.name.trim();
    this._tools.set(toolName, {
      extensionId,
      toolDef: {
        ...toolDef,
        name: toolName,
        parameters: toolDef.parameters || { type: 'object', properties: {} },
      },
      handler,
    });
  }

  /**
   * Unregister a single tool.
   *
   * @param {string} toolName
   * @returns {boolean}
   */
  unregisterTool(toolName) {
    return this._tools.delete(toolName);
  }

  /**
   * Unregister all tools belonging to a given extension.
   *
   * @param {string} extensionId
   * @returns {number} Count of removed tools
   */
  unregisterExtensionTools(extensionId) {
    let count = 0;
    for (const [name, entry] of this._tools.entries()) {
      if (entry.extensionId === extensionId) {
        this._tools.delete(name);
        count++;
      }
    }
    return count;
  }

  /**
   * Retrieve a tool entry by name.
   *
   * @param {string} toolName
   * @returns {{ extensionId: string, toolDef: any, handler: Function } | null}
   */
  getTool(toolName) {
    return this._tools.get(toolName) || null;
  }

  /**
   * Check if a tool is registered.
   *
   * @param {string} toolName
   * @returns {boolean}
   */
  hasTool(toolName) {
    return this._tools.has(toolName);
  }

  /**
   * List all currently registered tool definitions.
   *
   * @returns {Array<{ name: string, description: string, parameters: any, extensionId: string }>}
   */
  listTools() {
    return Array.from(this._tools.values()).map(({ extensionId, toolDef }) => ({
      name: toolDef.name,
      description: toolDef.description,
      parameters: toolDef.parameters,
      requiredPermissions: toolDef.requiredPermissions || [],
      extensionId,
    }));
  }

  /**
   * Format all registered tools for SORA's system prompt instructions.
   *
   * @returns {string}
   */
  formatToolsForPrompt() {
    const list = this.listTools();
    if (list.length === 0) return '';

    const lines = ['AVAILABLE MODULAR EXTENSION TOOLS:'];
    list.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.name}: ${t.description}`);
      const props = t.parameters?.properties || {};
      const sampleArgs = {};
      for (const [key, val] of Object.entries(props)) {
        sampleArgs[key] = val?.description ? `<${val.description}>` : `<${val?.type || 'value'}>`;
      }
      lines.push(`   args: ${JSON.stringify(sampleArgs)}`);
    });

    lines.push('\nMODULAR TOOL INVOCATION:');
    lines.push('Invoke these tools when needed by outputting:');
    lines.push('<tool_call>');
    lines.push('{"tool": "<tool_name>", "args": { ... }}');
    lines.push('</tool_call>');

    return lines.join('\n');
  }

  /**
   * Return tools formatted in OpenAI / MCP compatible function declaration format.
   *
   * @returns {Array<{ type: string, function: { name: string, description: string, parameters: any } }>}
   */
  getToolsOpenAISchema() {
    return Array.from(this._tools.values()).map(({ toolDef }) => ({
      type: 'function',
      function: {
        name: toolDef.name,
        description: toolDef.description,
        parameters: toolDef.parameters,
      },
    }));
  }

  /**
   * Clear all registered tools.
   */
  clear() {
    this._tools.clear();
  }
}
