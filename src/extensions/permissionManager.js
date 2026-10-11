/**
 * Permission Manager for SORA Modular Tool Extensions
 *
 * Controls sensitive capabilities (browser, applications, files, terminal, system).
 * Enforces non-default-unrestricted access and confirmation/safeguard policies.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

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

function hashToolPayload(toolName, args = {}) {
  const sanitized = { ...args };
  delete sanitized.__confirmed;
  delete sanitized.__confirmationToken;
  delete sanitized.confirmationToken;
  return crypto.createHash('sha256').update(String(toolName) + ':' + JSON.stringify(sanitized)).digest('hex');
}

/**
 * Safely verify that a target path is contained strictly within the active workspace root.
 * Rejects traversal, UNC paths, cross-drive paths, sibling directory bypasses, and symlink escapes.
 * @param {string} targetPath
 * @param {string} [workspaceRoot]
 * @returns {boolean}
 */
export function isPathInsideWorkspace(targetPath, workspaceRoot) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const root = workspaceRoot || process.cwd();
  const cleanTarget = String(targetPath).trim();

  // Reject UNC paths
  if (cleanTarget.startsWith('\\\\') || cleanTarget.startsWith('//') || /^[/\\]{2}/.test(cleanTarget)) {
    return false;
  }

  const canonicalRoot = fs.existsSync(root)
    ? fs.realpathSync(root)
    : path.resolve(root);

  const isDriveAbsolute = /^[a-zA-Z]:[/\\]/.test(cleanTarget) || (process.platform !== 'win32' && path.isAbsolute(cleanTarget));
  let resolvedTarget;
  if (/^[/\\]/.test(cleanTarget) && !/^[a-zA-Z]:[/\\]/.test(cleanTarget)) {
    resolvedTarget = path.resolve(canonicalRoot, cleanTarget.replace(/^[/\\]+/, ''));
  } else if (isDriveAbsolute) {
    resolvedTarget = path.resolve(cleanTarget);
  } else {
    resolvedTarget = path.resolve(canonicalRoot, cleanTarget);
  }

  const rel = path.relative(canonicalRoot, resolvedTarget);
  if (rel === '..' || rel.startsWith('..' + path.sep) || rel.startsWith('../') || path.isAbsolute(rel)) {
    return false;
  }

  if (fs.existsSync(resolvedTarget)) {
    const realResolved = fs.realpathSync(resolvedTarget);
    const realRel = path.relative(canonicalRoot, realResolved);
    if (realRel === '..' || realRel.startsWith('..' + path.sep) || realRel.startsWith('../') || path.isAbsolute(realRel)) {
      return false;
    }
  }

  return true;
}

export class PermissionManager {
  constructor(initialGrants = {}, allowanceMode = PERMISSION_ALLOWANCE_MODES.FULL_ACCESS) {
    /**
     * Map of extensionId -> Record<permission, boolean>
     * @type {Map<string, Record<string, boolean>>}
     */
    this._grants = new Map();
    this.allowanceMode = allowanceMode || PERMISSION_ALLOWANCE_MODES.FULL_ACCESS;
    /**
     * Server-side confirmation tokens store
     * @type {Map<string, { extensionId: string, toolName: string, payloadHash: string, expiresAt: number }>}
     */
    this._confirmationTokens = new Map();

    if (initialGrants && typeof initialGrants === 'object') {
      for (const [id, perms] of Object.entries(initialGrants)) {
        if (perms && typeof perms === 'object') {
          this._grants.set(id, { ...perms });
        }
      }
    }
  }

  /**
   * Create a cryptographically secure, single-use server confirmation token.
   *
   * @param {string} extensionId
   * @param {string} toolName
   * @param {Record<string, any>} [args]
   * @param {number} [ttlMs=300000] 5 minutes default
   * @returns {string}
   */
  createConfirmationToken(extensionId, toolName, args = {}, ttlMs = 300000) {
    const now = Date.now();
    for (const [t, data] of this._confirmationTokens.entries()) {
      if (data.expiresAt < now) this._confirmationTokens.delete(t);
    }

    const token = crypto.randomBytes(24).toString('hex');
    const payloadHash = hashToolPayload(toolName, args);
    this._confirmationTokens.set(token, {
      extensionId,
      toolName,
      payloadHash,
      expiresAt: now + ttlMs,
    });
    return token;
  }

  /**
   * Validate and consume a server confirmation token (single-use).
   *
   * @param {string} token
   * @param {string} extensionId
   * @param {string} toolName
   * @param {Record<string, any>} [args]
   * @returns {boolean}
   */
  validateAndConsumeConfirmationToken(token, extensionId, toolName, args = {}) {
    if (!token || typeof token !== 'string') return false;
    const data = this._confirmationTokens.get(token);
    if (!data) return false;

    if (data.expiresAt < Date.now()) {
      this._confirmationTokens.delete(token);
      return false;
    }

    const payloadHash = hashToolPayload(toolName, args);
    if (data.extensionId !== extensionId || data.toolName !== toolName || data.payloadHash !== payloadHash) {
      return false;
    }

    this._confirmationTokens.delete(token);
    return true;
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

    const tokenCandidate =
      (typeof context === 'object' && context !== null ? context.confirmationToken : null) ||
      args?.__confirmationToken ||
      args?.confirmationToken ||
      (typeof context === 'string' ? context : null);

    const hasValidToken = Boolean(
      tokenCandidate &&
      this.validateAndConsumeConfirmationToken(tokenCandidate, extensionId, toolName, args)
    );

    // If context explicitly flags that client confirmation token is required (e.g. from apiRouter / untrusted client),
    // then args.__confirmed is NOT accepted.
    // Otherwise, for backward compatibility with direct programmatic calls, args.__confirmed is accepted.
    const hasLegacyConfirmation = Boolean(args?.__confirmed && !context?.requireTokenOnly && !context?.isClientRequest);

    const hasValidConfirmation = hasValidToken || hasLegacyConfirmation;

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

      if (isStateModifying && !hasValidConfirmation) {
        const confirmationToken = this.createConfirmationToken(extensionId, toolName, args);
        return {
          allowed: false,
          requiresConfirmation: true,
          confirmationToken,
          reason: `Strict Mode: Tool "${toolName}" requires explicit user confirmation before executing.`,
        };
      }
    }

    // ── Mode-specific enforcement: SANDBOX ─────────────────────────────────
    if (this.allowanceMode === PERMISSION_ALLOWANCE_MODES.SANDBOX) {
      const workspaceRoot = context?.workspaceRoot || process.cwd();

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
          if (!isPathInsideWorkspace(args.cwd, workspaceRoot)) {
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
        if (!isPathInsideWorkspace(args.path, workspaceRoot)) {
          return {
            allowed: false,
            reason: `Sandbox Mode: File Explorer navigation restricted to active workspace "${workspaceRoot}".`,
          };
        }
      }
    }

    // Check extension-specific confirmation policy
    if (extensionConfig.requireConfirmation === true && !hasValidConfirmation) {
      const confirmationToken = this.createConfirmationToken(extensionId, toolName, args);
      return {
        allowed: false,
        requiresConfirmation: true,
        confirmationToken,
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
