/**
 * SORA Windows Automation Extension Implementation
 */

import { exec, spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const SETTINGS_MAP = {
  apps: 'ms-settings:appsfeatures',
  network: 'ms-settings:network',
  wifi: 'ms-settings:network-wifi',
  display: 'ms-settings:display',
  bluetooth: 'ms-settings:bluetooth',
  windowsupdate: 'ms-settings:windowsupdate',
  update: 'ms-settings:windowsupdate',
  sound: 'ms-settings:sound',
  audio: 'ms-settings:sound',
  privacy: 'ms-settings:privacy',
  personalization: 'ms-settings:personalization',
  storage: 'ms-settings:storagesense',
  about: 'ms-settings:about',
  system: 'ms-settings:about',
  battery: 'ms-settings:batterysaver',
  power: 'ms-settings:powersleep',
};

const APP_ALIASES = {
  terminal: 'wt.exe',
  'windows terminal': 'wt.exe',
  'window terminal': 'wt.exe',
  wt: 'wt.exe',
  'wt.exe': 'wt.exe',
  cmd: 'cmd.exe',
  'command prompt': 'cmd.exe',
  'cmd.exe': 'cmd.exe',
  powershell: 'powershell.exe',
  'powershell.exe': 'powershell.exe',
  pwsh: 'pwsh.exe',
  calculator: 'calc.exe',
  calc: 'calc.exe',
  notepad: 'notepad.exe',
  explorer: 'explorer.exe',
  'file explorer': 'explorer.exe',
  chrome: 'chrome.exe',
  'google chrome': 'chrome.exe',
  edge: 'msedge.exe',
  'microsoft edge': 'msedge.exe',
  code: 'code',
  'vs code': 'code',
  vscode: 'code',
};

/**
 * Launch an application on Windows.
 */
export async function windows_launch_app(args) {
  const { appName, args: appArgs = [] } = args || {};
  if (typeof appName !== 'string' || !appName.trim()) {
    return { ok: false, error: 'appName is required' };
  }

  const rawLower = appName.toLowerCase().trim();
  const shellAliases = new Set([
    'cmd', 'command prompt', 'cmd.exe',
    'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  ]);
  if (shellAliases.has(rawLower)) {
    return {
      ok: false,
      error: 'Command interpreters cannot be launched with the apps permission. Use terminal_execute with terminal permission instead.',
    };
  }

  // Only launch explicitly supported applications; never treat an LLM-provided
  // path or executable name as a trusted program.
  const targetExe = APP_ALIASES[rawLower];
  if (!targetExe) {
    return { ok: false, error: `Unsupported application "${appName}". Use an approved application alias.` };
  }

  let argv;
  if (Array.isArray(appArgs)) {
    if (appArgs.some((arg) => typeof arg !== 'string')) {
      return { ok: false, error: 'Application arguments must be an array of strings.' };
    }
    argv = appArgs.map((arg) => arg.trim());
  } else if (typeof appArgs === 'string' && appArgs.trim() === '') {
    argv = [];
  } else {
    return { ok: false, error: 'Application arguments must be an array of strings.' };
  }

  // Windows Terminal can dispatch arbitrary shell commands through its args.
  // Launch it only without additional arguments; command execution has its own
  // separately permissioned tool.
  if (targetExe.toLowerCase() === 'wt.exe' && argv.length > 0) {
    return { ok: false, error: 'Windows Terminal arguments are disabled for apps-permission requests.' };
  }
  if (argv.some((arg) => /[\\r\\n\\0]/.test(arg))) {
    return { ok: false, error: 'Application arguments cannot contain control characters.' };
  }

  const isConsoleApp = targetExe.toLowerCase() === 'wt.exe';
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(targetExe, argv, {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: !isConsoleApp,
      });
    } catch (err) {
      resolve({ ok: false, error: `Could not launch "${appName}": ${err.message}` });
      return;
    }

    child.once('error', (err) => {
      resolve({ ok: false, error: `Could not launch "${appName}": ${err.message}` });
    });
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, data: { appName, executable: targetExe, launched: true } });
    });
  });
}

/**
 * Gracefully close or terminate a running application process by name.
 */
export async function windows_close_app(args) {
  const { processName } = args;
  if (!processName) return { ok: false, error: 'processName is required' };

  // Strip .exe if provided
  const baseName = processName.replace(/\.exe$/i, '').replace(/["';`$]/g, '').trim();

  return new Promise((resolve) => {
    const psCmd = `powershell -Command "Stop-Process -Name '${baseName}' -Force -ErrorAction SilentlyContinue"`;
    exec(psCmd, { windowsHide: true }, (err) => {
      if (err) {
        resolve({ ok: false, error: `Failed to terminate "${processName}": ${err.message}` });
      } else {
        resolve({
          ok: true,
          data: {
            processName: baseName,
            status: 'terminated',
            message: `Process "${baseName}" terminated or was not running.`,
          },
        });
      }
    });
  });
}

/**
 * Open Windows Settings pages.
 */
export async function windows_open_settings(args) {
  const { page } = args;
  if (!page) return { ok: false, error: 'page is required' };

  const lower = page.toLowerCase().trim();
  let uri = lower.startsWith('ms-settings:') ? lower : (SETTINGS_MAP[lower] || `ms-settings:${lower}`);

  return new Promise((resolve) => {
    const cmd = `start "" "${uri}"`;
    exec(cmd, { windowsHide: true }, (err) => {
      if (err) {
        resolve({ ok: false, error: `Failed to open settings URI "${uri}": ${err.message}` });
      } else {
        resolve({
          ok: true,
          data: {
            category: page,
            uri,
            opened: true,
          },
        });
      }
    });
  });
}

/**
 * Search, open, and navigate files and folders in Windows File Explorer.
 */
export async function windows_file_explorer(args, context = {}) {
  const { action, path: targetPath, query } = args;
  const config = context.config || {};
  const effectivePath = targetPath || config.defaultExplorerDirectory || context.workspaceRoot || process.cwd();

  if (action === 'open') {
    const resolved = path.resolve(effectivePath);
    return new Promise((resolve) => {
      exec(`explorer.exe "${resolved}"`, { windowsHide: true }, (err) => {
        if (err) {
          resolve({ ok: false, error: `Failed to open File Explorer at "${resolved}": ${err.message}` });
        } else {
          resolve({ ok: true, data: { action: 'open', path: resolved } });
        }
      });
    });
  }

  if (action === 'select') {
    const resolved = path.resolve(effectivePath);
    return new Promise((resolve) => {
      exec(`explorer.exe /select,"${resolved}"`, { windowsHide: true }, (err) => {
        if (err) {
          resolve({ ok: false, error: `Failed to select "${resolved}": ${err.message}` });
        } else {
          resolve({ ok: true, data: { action: 'select', selectedFile: resolved } });
        }
      });
    });
  }

  if (action === 'search') {
    const resolved = path.resolve(effectivePath);
    const searchTerm = (query || '').replace(/["';`$]/g, '').trim();
    if (!searchTerm) {
      return { ok: false, error: 'query parameter is required for action "search"' };
    }

    return new Promise((resolve) => {
      const psCmd = `powershell -Command "Get-ChildItem -Path '${resolved}' -Recurse -Filter '*${searchTerm}*' -ErrorAction SilentlyContinue | Select-Object -First 20 -ExpandProperty FullName"`;
      exec(psCmd, { windowsHide: true }, (err, stdout) => {
        if (err) {
          resolve({ ok: false, error: `Search error: ${err.message}` });
        } else {
          const results = stdout
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          resolve({
            ok: true,
            data: {
              searchPath: resolved,
              query: searchTerm,
              matchCount: results.length,
              matches: results,
            },
          });
        }
      });
    });
  }

  return { ok: false, error: `Unsupported action "${action}". Must be 'open', 'select', or 'search'.` };
}
