/**
 * SORA Modular Tool Extension System — Unified Exports & Shared Manager Instance
 */

import { ExtensionManager } from './extensionManager.js';
import { PermissionManager, KNOWN_PERMISSIONS } from './permissionManager.js';
import { ToolRegistry } from './toolRegistry.js';
import { ToolExecutionBridge } from './toolExecutionBridge.js';
import { ExtensionLoader } from './extensionLoader.js';
import { validateManifest, ALLOWED_PERMISSION_CATEGORIES } from './manifestValidator.js';

let sharedManager = null;

/**
 * Get or create the shared ExtensionManager singleton.
 *
 * @param {Object} [options]
 * @returns {ExtensionManager}
 */
export function getExtensionManager(options) {
  if (!sharedManager) {
    sharedManager = new ExtensionManager(options);
  }
  return sharedManager;
}

export {
  ExtensionManager,
  PermissionManager,
  KNOWN_PERMISSIONS,
  ToolRegistry,
  ToolExecutionBridge,
  ExtensionLoader,
  validateManifest,
  ALLOWED_PERMISSION_CATEGORIES,
};
