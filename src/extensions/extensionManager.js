/**
 * Extension Manager for SORA Modular Tool Extensions
 *
 * Coordinates extension lifecycle: discovery, import, manifest validation,
 * enabling/disabling, tool registration, permissions, and configuration persistence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validateManifest } from './manifestValidator.js';
import { PermissionManager } from './permissionManager.js';
import { ToolRegistry } from './toolRegistry.js';
import { ExtensionLoader } from './extensionLoader.js';
import { ToolExecutionBridge } from './toolExecutionBridge.js';

export class ExtensionManager {
  /**
   * @param {Object} options
   * @param {string} [options.extensionsDir] Root directory where extensions live
   * @param {string} [options.configFile] Path to persisted extension configuration file
   */
  constructor({
    extensionsDir = path.resolve(process.cwd(), 'extensions'),
    configFile = path.resolve(process.cwd(), 'data/extensions_config.json'),
  } = {}) {
    this.extensionsDir = extensionsDir;
    this.configFile = configFile;

    this.manifests = new Map(); // extensionId -> manifest
    this.extensionDirs = new Map(); // extensionId -> dirPath
    this.extensionErrors = new Map(); // extensionId -> string (if load failed)

    this.toolRegistry = new ToolRegistry();
    this.permissionManager = new PermissionManager();
    this.extensionLoader = new ExtensionLoader();

    this.bridge = new ToolExecutionBridge(
      this.toolRegistry,
      this.permissionManager,
      this.extensionLoader,
      (extId) => this.getExtensionConfig(extId)
    );

    /**
     * Map of extensionId -> { enabled: boolean, config: Record<string, any>, permissions: Record<string, boolean> }
     */
    this._persistedState = {};
  }

  /**
   * Initialize extension manager: load persisted states, scan directories, and activate enabled extensions.
   */
  async initialize() {
    this._loadPersistedConfig();

    // Ensure extensions directory exists
    if (!fs.existsSync(this.extensionsDir)) {
      try {
        fs.mkdirSync(this.extensionsDir, { recursive: true });
      } catch (err) {
        console.warn('[ExtensionManager] Could not create extensions directory:', err.message);
      }
    }

    await this.scanExtensions();
  }

  /**
   * Scan extensions directory and any explicitly linked extension paths.
   */
  async scanExtensions() {
    if (!fs.existsSync(this.extensionsDir)) return;

    const entries = fs.readdirSync(this.extensionsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.resolve(this.extensionsDir, entry.name);
      await this._loadExtensionFromDir(subDir);
    }

    // Also scan any imported extension directories stored in persisted state
    for (const [id, state] of Object.entries(this._persistedState)) {
      if (state.customPath && fs.existsSync(state.customPath) && !this.manifests.has(id)) {
        await this._loadExtensionFromDir(state.customPath);
      }
    }
  }

  /**
   * Internal helper to load an extension manifest from a folder.
   *
   * @param {string} dirPath
   */
  async _loadExtensionFromDir(dirPath) {
    const manifestPath = path.resolve(dirPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;

    let manifest;
    try {
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(raw);
    } catch (err) {
      console.warn(`[ExtensionManager] Failed to read manifest at ${manifestPath}:`, err.message);
      return null;
    }

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      console.warn(`[ExtensionManager] Invalid manifest in ${dirPath}:`, validation.errors.join('; '));
      this.extensionErrors.set(manifest?.id || path.basename(dirPath), validation.errors.join('; '));
      return null;
    }

    const id = manifest.id;
    this.manifests.set(id, manifest);
    this.extensionDirs.set(id, dirPath);
    this.extensionErrors.delete(id);

    // Apply persisted permissions or initialize defaults
    const state = this._persistedState[id] || {};
    if (state.permissions) {
      this.permissionManager.setPermissions(id, state.permissions);
    } else {
      // Default: grant permissions requested by bundled initial extensions on first run
      const defaultGrants = {};
      for (const p of manifest.permissions || []) {
        defaultGrants[p] = true;
      }
      this.permissionManager.setPermissions(id, defaultGrants);
    }

    // Default enabled state: true for standard bundled extensions unless explicitly disabled
    const shouldEnable = state.enabled !== undefined ? Boolean(state.enabled) : true;
    if (shouldEnable) {
      try {
        await this.enableExtension(id, false); // do not re-save during init scan
      } catch (err) {
        console.warn(`[ExtensionManager] Auto-enable failed for "${id}":`, err.message);
        this.extensionErrors.set(id, err.message);
      }
    }

    return manifest;
  }

  /**
   * List all discovered extensions with their manifests, statuses, and configurations.
   */
  listExtensions() {
    const list = [];

    for (const [id, manifest] of this.manifests.entries()) {
      const state = this._persistedState[id] || {};
      const isEnabled = this._isExtensionActive(id);
      const permissions = this.permissionManager.getPermissions(id, manifest.permissions || []);
      const error = this.extensionErrors.get(id) || null;

      list.push({
        id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author || 'Community',
        entry: manifest.entry,
        permissionsRequested: manifest.permissions || [],
        permissionsGranted: permissions,
        configurationSchema: manifest.configuration || {},
        currentConfiguration: this.getExtensionConfig(id),
        tools: manifest.tools || [],
        enabled: isEnabled,
        error,
        path: this.extensionDirs.get(id) || '',
      });
    }

    return list;
  }

  /**
   * Enable an extension and register its tools.
   *
   * @param {string} id Extension ID
   * @param {boolean} [saveState=true] Whether to persist to disk
   */
  async enableExtension(id, saveState = true) {
    const manifest = this.manifests.get(id);
    const dirPath = this.extensionDirs.get(id);

    if (!manifest || !dirPath) {
      throw new Error(`Extension "${id}" not found.`);
    }

    try {
      // Load module handlers
      const handlers = await this.extensionLoader.loadExtension(dirPath, manifest);

      // Register tools into ToolRegistry
      for (const toolDef of manifest.tools) {
        const handler = handlers[toolDef.name];
        if (handler) {
          this.toolRegistry.registerTool(id, {
            ...toolDef,
            requiredPermissions: manifest.permissions || [],
          }, handler);
        }
      }

      this._updatePersistedState(id, { enabled: true });
      this.extensionErrors.delete(id);

      if (saveState) {
        this._savePersistedConfig();
      }

      return { ok: true, message: `Extension "${manifest.name}" enabled.` };
    } catch (err) {
      this.extensionErrors.set(id, err.message);
      throw err;
    }
  }

  /**
   * Disable an extension and unregister its tools.
   *
   * @param {string} id Extension ID
   * @param {boolean} [saveState=true]
   */
  disableExtension(id, saveState = true) {
    if (!this.manifests.has(id)) {
      throw new Error(`Extension "${id}" not found.`);
    }

    this.toolRegistry.unregisterExtensionTools(id);
    this.extensionLoader.unloadExtension(id);

    this._updatePersistedState(id, { enabled: false });

    if (saveState) {
      this._savePersistedConfig();
    }

    return { ok: true, message: `Extension "${id}" disabled.` };
  }

  /**
   * Update configuration and/or permissions for an extension.
   *
   * @param {string} id
   * @param {Object} options
   * @param {Record<string, any>} [options.config]
   * @param {Record<string, boolean>} [options.permissions]
   */
  updateExtensionConfig(id, { config, permissions } = {}) {
    if (!this.manifests.has(id)) {
      throw new Error(`Extension "${id}" not found.`);
    }

    const state = this._persistedState[id] || { enabled: true, config: {}, permissions: {} };

    if (config && typeof config === 'object') {
      state.config = { ...(state.config || {}), ...config };
    }

    if (permissions && typeof permissions === 'object') {
      state.permissions = { ...(state.permissions || {}), ...permissions };
      this.permissionManager.setPermissions(id, state.permissions);
    }

    this._persistedState[id] = state;
    this._savePersistedConfig();

    return { ok: true, message: `Extension "${id}" configuration updated.` };
  }

  /**
   * Reload an extension from disk (clearing cache and re-registering tools).
   *
   * @param {string} id
   */
  async reloadExtension(id) {
    const dirPath = this.extensionDirs.get(id);
    if (!dirPath) {
      throw new Error(`Extension "${id}" directory not found.`);
    }

    this.disableExtension(id, false);
    await this._loadExtensionFromDir(dirPath);
    await this.enableExtension(id, true);

    return { ok: true, message: `Extension "${id}" reloaded successfully.` };
  }

  /**
   * Import an extension from an external folder.
   *
   * @param {string} folderPath Local directory containing manifest.json
   */
  async importExtension(folderPath) {
    const resolvedPath = path.resolve(folderPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Directory not found: "${folderPath}"`);
    }

    const manifestPath = path.resolve(resolvedPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`No manifest.json found in "${folderPath}"`);
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      throw new Error(`Failed to parse manifest.json: ${err.message}`);
    }

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      throw new Error(`Invalid manifest: ${validation.errors.join('; ')}`);
    }

    const id = manifest.id;

    // Destination in extensions/ folder
    const targetDir = path.resolve(this.extensionsDir, id);

    // If source folder is not already inside extensions/<id>, copy it
    if (resolvedPath !== targetDir) {
      try {
        fs.cpSync(resolvedPath, targetDir, { recursive: true });
      } catch (cpErr) {
        throw new Error(`Failed to copy extension folder: ${cpErr.message}`);
      }
    }

    // Load and enable
    await this._loadExtensionFromDir(targetDir);
    await this.enableExtension(id, true);

    return {
      ok: true,
      id,
      name: manifest.name,
      message: `Extension "${manifest.name}" imported and enabled successfully.`,
    };
  }

  /**
   * Remove an extension.
   *
   * @param {string} id
   */
  removeExtension(id) {
    if (!this.manifests.has(id)) {
      throw new Error(`Extension "${id}" not found.`);
    }

    this.disableExtension(id, false);

    const dirPath = this.extensionDirs.get(id);
    this.manifests.delete(id);
    this.extensionDirs.delete(id);
    this.extensionErrors.delete(id);
    delete this._persistedState[id];

    // Remove folder from disk if it's within extensionsDir
    if (dirPath && dirPath.startsWith(this.extensionsDir)) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[ExtensionManager] Could not remove directory ${dirPath}:`, err.message);
      }
    }

    this._savePersistedConfig();

    return { ok: true, message: `Extension "${id}" removed.` };
  }

  /**
   * Get user configuration values for an extension, merged with manifest defaults.
   *
   * @param {string} id
   * @returns {Record<string, any>}
   */
  getExtensionConfig(id) {
    const manifest = this.manifests.get(id);
    const defaults = {};

    if (manifest?.configuration) {
      for (const [key, prop] of Object.entries(manifest.configuration)) {
        if (prop?.default !== undefined) {
          defaults[key] = prop.default;
        }
      }
    }

    const saved = this._persistedState[id]?.config || {};
    return { ...defaults, ...saved };
  }

  _isExtensionActive(id) {
    const state = this._persistedState[id];
    if (state && typeof state.enabled === 'boolean') {
      return state.enabled;
    }
    // If not recorded yet, check if any tool is currently in registry
    return Array.from(this.toolRegistry._tools.values()).some((t) => t.extensionId === id);
  }

  _updatePersistedState(id, updates) {
    const current = this._persistedState[id] || {};
    this._persistedState[id] = { ...current, ...updates };
  }

  _loadPersistedConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        const raw = fs.readFileSync(this.configFile, 'utf-8');
        this._persistedState = JSON.parse(raw);
      }
    } catch (err) {
      console.warn('[ExtensionManager] Error reading config file:', err.message);
      this._persistedState = {};
    }
  }

  _savePersistedConfig() {
    try {
      const configDir = path.dirname(this.configFile);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.configFile, JSON.stringify(this._persistedState, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[ExtensionManager] Error saving config file:', err.message);
    }
  }
}
