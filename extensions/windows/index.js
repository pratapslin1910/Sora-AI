/**
 * SORA Windows Automation Extension Implementation
 */

import { exec } from 'node:child_process';
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
  const { appName, args: appArgs = [] } = args;
  if (!appName) return { ok: false, error: 'appName is required' };

  const rawLower = appName.toLowerCase().trim();
  const targetExe = APP_ALIASES[rawLower] || appName.replace(/["';`$]/g, '').trim();

  // Handle arguments: whether passed as string or array
  let joinedArgs = '';
  if (Array.isArray(appArgs)) {
    joinedArgs = appArgs.map((a) => {
      const s = String(a).trim();
      if ((s.startsWith('"') && s.endsWith('"')) || s.startsWith('-') || s.startsWith('/')) {
        return s;
      }
      return s.includes(' ') ? `"${s}"` : s;
    }).join(' ');
  } else if (typeof appArgs === 'string') {
    joinedArgs = appArgs.trim();
  }

  // If launching a terminal / console application, ensure it opens visibly on the user's desktop
  const isConsoleApp = /^(wt|wt\.exe|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe)$/i.test(targetExe);

  return new Promise((resolve) => {
    // For console apps (like Windows Terminal, cmd, powershell), don't hide windows
    const cmd = `start "" "${targetExe}" ${joinedArgs}`.trim();
    exec(cmd, { windowsHide: !isConsoleApp }, (err) => {
      if (err) {
        // Fallback: if wt.exe fails, fallback to cmd or powershell
        if (targetExe === 'wt.exe') {
          let dirMatch = joinedArgs.match(/-d\s+["']?([^"']+)["']?/i);
          let targetDir = dirMatch ? dirMatch[1] : '';
          const fallbackCmd = targetDir
            ? `start "Command Prompt" cmd.exe /k "cd /d "${targetDir}""`
            : `start "Command Prompt" cmd.exe`;
          exec(fallbackCmd, { windowsHide: false }, (fbErr) => {
            if (fbErr) {
              resolve({ ok: false, error: `Could not launch terminal: ${fbErr.message}` });
            } else {
              resolve({ ok: true, data: { appName, executable: 'cmd.exe', launched: true, fallback: true } });
            }
          });
          return;
        }

        // Fallback to powershell Start-Process
        const psArgs = joinedArgs ? `-ArgumentList '${joinedArgs.replace(/'/g, "''")}'` : '';
        const psCmd = `powershell -Command "Start-Process '${targetExe}' ${psArgs} -ErrorAction Stop"`;
        exec(psCmd, (psErr) => {
          if (psErr) {
            resolve({ ok: false, error: `Could not launch "${appName}": ${psErr.message}` });
          } else {
            resolve({ ok: true, data: { appName, executable: targetExe, launched: true, launcher: 'powershell' } });
          }
        });
        return;
      }
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
