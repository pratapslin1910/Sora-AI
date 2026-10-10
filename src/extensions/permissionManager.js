/**
 * Permission Manager for SORA Modular Tool Extensions
 *
 * Controls sensitive capabilities (browser, applications, files, terminal, system).
 * Enforces non-default-unrestricted access and confirmation/safeguard policies.
 */

export const KNOWN_PERMISSIONS = Object.freeze({
  BROWSER: 'browser',
  APPS: 'apps',
  FILES: 'files',
  TERMINAL: 'terminal',
  NETWORK: 'network',
  CLIPBOARD: 'clipboard',
  SYSTEM: 'system',
});

export const PERMISSION_ALLOWANCE_MODES = Object.freeze({
  FULL_ACCESS: 'full_access',
  SANDBOX: 'sandbox',
  STRICT: 'strict',
});

// Dangerous / catastrophic command patterns that must always be blocked
const CATASTROPHIC_PATTERNS = [
  /\bformat\s+[a-z]:/i,
  /\brmdir\b.*[a-z]:\\/i,
  /\bdel\b.*[a-z]:\\/i,
  /\bdiskpart\b/i,
  /\bRemove-Item\b.*[a-z]:\\/i,
  /\bClear-Disk\b/i,
  /\bInitialize-Disk\b/i,
];

// Sandbox-prohibited terminal patterns (cannot alter system or delete files in sandbox)
const SANDBOX_PROHIBITED_PATTERNS = [
  /\b(?:del|rmdir|rm|erase)\b/i,
  /\b(?:shutdown|reboot|restart-computer)\b/i,
  /\b(?:reg\s+(?:add|delete))\b/i,
  /\b(?:net\s+user|net\s+localgroup)\b/i,
  /\b(?:takeown|icacls)\b/i,
];

// Sandbox whitelisted applications
const SANDBOX_ALLOWED_APPS = new Set([
  'chrome',
  'google-chrome',
  'msedge',
  'notepad',
  'calc',
  'calculator',
  'explorer',
  'code',
  'powershell',
  'cmd',
]);

export class PermissionManager {
  constructor(initialGrants = {}, allowanceMode = PERMISSION_ALLOWANCE_MODES.FULL_ACCESS) {
    /**
     * Map of extensionId -> Record<permission, boolean>
     * @type {Map<string, Record<string, boolean>>}
     */
    this._grants = new Map();
    this.allowanceMode = allowanceMode || PERMISSION_ALLOWANCE_MODES.FULL_ACCESS;

    if (initialGrants && typeof initialGrants === 'object') {
      for (const [id, perms] of Object.entries(initialGrants)) {
        if (perms && typeof perms === 'object') {
          this._grants.set(id, { ...perms });
        }
      }
    }
  }

  /**
   * Get all permission statuses for an extension.
   *
   * @param {string} extensionId
   * @param {string[]} [requestedPermissions] List of permissions requested in manifest
   * @returns {Record<string, boolean>}
   */
  getPermissions(extensionId, requestedPermissions = []) {
    const existing = this._grants.get(extensionId) || {};
    const result = { ...existing };

    // Ensure all requested permissions exist in the returned dictionary
    for (const perm of requestedPermissions) {
      if (typeof result[perm] !== 'boolean') {
        result[perm] = false; // Default: NOT granted
      }
    }

    return result;
  }

  /**
   * Sets the permission map for an extension.
   *
   * @param {string} extensionId
   * @param {Record<string, boolean>} permissionsMap
   */
  setPermissions(extensionId, permissionsMap = {}) {
    const sanitized = {};
    for (const [key, val] of Object.entries(permissionsMap)) {
      sanitized[key.toLowerCase()] = Boolean(val);
    }
    this._grants.set(extensionId, sanitized);
  }

  /**
   * Grant a specific permission to an extension.
   *
   * @param {string} extensionId
   * @param {string} permission
   */
  grantPermission(extensionId, permission) {
    const current = this.getPermissions(extensionId);
    current[permission.toLowerCase()] = true;
    this._grants.set(extensionId, current);
  }

  /**
   * Revoke a specific permission from an extension.
   *
   * @param {string} extensionId
   * @param {string} permission
   */
  revokePermission(extensionId, permission) {
    const current = this.getPermissions(extensionId);
    current[permission.toLowerCase()] = false;
    this._grants.set(extensionId, current);
  }

  /**
   * Check if an extension holds a specific permission.
   *
   * @param {string} extensionId
   * @param {string} permission
   * @returns {boolean}
   */
  hasPermission(extensionId, permission) {
    const grants = this._grants.get(extensionId);
    if (!grants) return false;
    return Boolean(grants[permission.toLowerCase()]);
  }

  /**
   * Get the active Permission Allowance mode.
   * @returns {'full_access' | 'sandbox' | 'strict'}
   */
  getAllowanceMode() {
    return this.allowanceMode;
  }

  /**
   * Set the active Permission Allowance mode.
   * @param {'full_access' | 'sandbox' | 'strict'} mode
   */
  setAllowanceMode(mode) {
    if (Object.values(PERMISSION_ALLOWANCE_MODES).includes(mode)) {
      this.allowanceMode = mode;
    }
  }

  /**
   * Validate whether a tool execution request complies with permission policies.
   *
   * @param {string} extensionId
   * @param {Object} toolDef
   * @param {Object} args
   * @param {Object} [extensionConfig]
   * @param {Object} [context] Optional execution context (e.g. workspaceRoot)
   * @returns {{ allowed: boolean, requiresConfirmation?: boolean, reason?: string }}
   */
  checkExecutionPermission(extensionId, toolDef, args = {}, extensionConfig = {}, context = {}) {
    const toolName = toolDef.name || '';
    const permissions = toolDef.requiredPermissions || [];

    // Check each required permission
    for (const perm of permissions) {
      if (!this.hasPermission(extensionId, perm)) {
        return {
          allowed: false,
          reason: `Permission denied: Extension "${extensionId}" requires permission "${perm}" for tool "${toolName}". Grant this permission in Settings → Extensions.`,
        };
      }
    }

    // Always block catastrophic system wipe patterns in all modes
    if (permissions.includes(KNOWN_PERMISSIONS.TERMINAL) || toolName.includes('terminal')) {
      const cmd = String(args.command || args.cmd || '');
      for (const pattern of CATASTROPHIC_PATTERNS) {
        if (pattern.test(cmd)) {
          return {
            allowed: false,
            reason: `Execution blocked by safety policy: Catastrophic or destructive command pattern detected: "${cmd}".`,
          };
        }
      }
    }

    // ── Mode-specific enforcement: STRICT ──────────────────────────────────
    if (this.allowanceMode === PERMISSION_ALLOWANCE_MODES.STRICT) {
      // In strict mode, state-modifying tools require explicit confirmation
      const isStateModifying =
        toolName === 'terminal_execute' ||
        toolName === 'windows_launch_app' ||
        toolName === 'windows_close_app' ||
        toolName === 'windows_open_settings' ||
        toolName === 'delete_item' ||
        toolName === 'write_file';

      if (isStateModifying && !args.__confirmed) {
        return {
          allowed: false,
          requiresConfirmation: true,
          reason: `Strict Mode: Tool "${toolName}" requires explicit user confirmation before executing.`,
        };
      }
    }

    // ── Mode-specific enforcement: SANDBOX ─────────────────────────────────
    if (this.allowanceMode === PERMISSION_ALLOWANCE_MODES.SANDBOX) {
      const workspaceRoot = (context?.workspaceRoot || process.cwd()).toLowerCase();

      // Restrict terminal execution in sandbox
      if (permissions.includes(KNOWN_PERMISSIONS.TERMINAL) || toolName.includes('terminal')) {
        const cmd = String(args.command || args.cmd || '');
        for (const pattern of SANDBOX_PROHIBITED_PATTERNS) {
          if (pattern.test(cmd)) {
            return {
              allowed: false,
              reason: `Sandbox Mode: Destructive or system-altering command "${cmd}" is blocked in sandbox mode. Switch to Full Access in Settings to allow.`,
            };
          }
        }

        if (args.cwd) {
          const targetCwd = String(args.cwd).toLowerCase();
          if (!targetCwd.startsWith(workspaceRoot)) {
            return {
              allowed: false,
              reason: `Sandbox Mode: Command working directory must be within active workspace root "${workspaceRoot}".`,
            };
          }
        }
      }

      // Restrict application launching in sandbox
      if (toolName === 'windows_launch_app') {
        const appName = String(args.appName || '').toLowerCase().replace(/\.exe$/, '').trim();
        if (!SANDBOX_ALLOWED_APPS.has(appName)) {
          return {
            allowed: false,
            reason: `Sandbox Mode: Application "${args.appName}" is not in the allowed sandbox whitelist. Switch to Full Access in Settings to allow.`,
          };
        }
      }

      // Restrict File Explorer path navigation in sandbox
      if (toolName === 'windows_file_explorer' && args.path) {
        const targetPath = String(args.path).toLowerCase();
        if (!targetPath.startsWith(workspaceRoot)) {
          return {
            allowed: false,
            reason: `Sandbox Mode: File Explorer navigation restricted to active workspace "${workspaceRoot}".`,
          };
        }
      }
    }

    // Check extension-specific confirmation policy
    if (extensionConfig.requireConfirmation === true && !args.__confirmed) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Command requires explicit user confirmation per extension policy.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Export all grants to JSON-serializable object.
   *
   * @returns {Record<string, Record<string, boolean>>}
   */
  toJSON() {
    const out = {};
    for (const [id, perms] of this._grants.entries()) {
      out[id] = { ...perms };
    }
    return out;
  }
}
