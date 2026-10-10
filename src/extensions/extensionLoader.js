/**
 * Extension Loader for SORA Modular Tool Extensions
 *
 * Dynamically loads extension modules from disk, inspects handlers, and provides
 * safe, isolated invocation wrappers with timeout and error confinement.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

export class ExtensionLoader {
  constructor() {
    /**
     * Cache of loaded module instances: extensionId -> module
     * @type {Map<string, any>}
     */
    this._loadedModules = new Map();
  }

  /**
   * Load an extension module from its directory and entry point.
   *
   * @param {string} extensionDir Absolute or relative directory of the extension
   * @param {Object} manifest Validated extension manifest
   * @returns {Promise<Record<string, Function>>} Map of toolName -> async handler function
   */
  async loadExtension(extensionDir, manifest) {
    const entryFile = manifest.entry || 'index.js';
    const entryPath = path.resolve(extensionDir, entryFile);

    if (!fs.existsSync(entryPath)) {
      throw new Error(`Extension entry file not found: ${entryPath}`);
    }

    // Dynamic import using file URL with timestamp cache-buster for reloading
    const fileUrl = `${pathToFileURL(entryPath).href}?t=${Date.now()}`;

    let mod;
    try {
      mod = await import(fileUrl);
    } catch (importErr) {
      throw new Error(`Failed to import extension module at "${entryPath}": ${importErr.message}`);
    }

    this._loadedModules.set(manifest.id, mod);

    // Extract handlers from module
    // Supports:
    // 1. Named exports: export async function toolName(...)
    // 2. Export default or export const tools = { toolName: ... }
    // 3. export default class or factory returning handlers
    const handlers = {};
    const candidateHandlers = {
      ...(mod.tools || {}),
      ...(mod.default?.tools || {}),
      ...(typeof mod.default === 'object' ? mod.default : {}),
      ...mod,
    };

    for (const toolDef of manifest.tools) {
      const toolName = toolDef.name;
      const fn = candidateHandlers[toolName];

      if (typeof fn !== 'function') {
        throw new Error(
          `Extension "${manifest.id}" does not export required tool handler function for "${toolName}"`
        );
      }

      handlers[toolName] = fn;
    }

    return handlers;
  }

  /**
   * Unload an extension from the module cache.
   *
   * @param {string} extensionId
   */
  unloadExtension(extensionId) {
    this._loadedModules.delete(extensionId);
  }

  /**
   * Safely invoke a tool handler with timeout and error containment.
   *
   * @param {Function} handler The tool implementation function
   * @param {Object} args The arguments passed to the tool
   * @param {Object} context Execution context (config, permissions, workspace)
   * @param {number} [timeoutMs=30000] Execution timeout
   * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
   */
  async invokeHandler(handler, args, context = {}, timeoutMs = 30000) {
    let timer;
    try {
      const executionPromise = Promise.resolve(handler(args, context));
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const result = await Promise.race([executionPromise, timeoutPromise]);
      clearTimeout(timer);

      // Normalize return value: if tool returned an object with ok/data/error, use it; else wrap it
      if (result && typeof result === 'object' && typeof result.ok === 'boolean') {
        return result;
      }

      return {
        ok: true,
        data: result,
      };
    } catch (err) {
      clearTimeout(timer);
      return {
        ok: false,
        error: err?.message || String(err),
      };
    }
  }
}
