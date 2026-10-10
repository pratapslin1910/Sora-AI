/**
 * SORA Terminal Executor Extension Implementation
 */

import { exec } from 'node:child_process';
import path from 'node:path';

export async function terminal_execute(args, context = {}) {
  const { command, cwd, timeoutMs: callerTimeout, openInWindow: callerOpenInWindow } = args;
  if (!command || typeof command !== 'string') {
    return { ok: false, error: 'Command argument is required' };
  }

  const config = context.config || {};
  const shellType = (config.defaultShell || 'powershell').toLowerCase();
  const effectiveCwd = cwd ? path.resolve(cwd) : (context.workspaceRoot || process.cwd());
  const effectiveTimeout = callerTimeout || (config.timeoutSeconds ? config.timeoutSeconds * 1000 : 30000);
  const shouldOpenInWindow = Boolean(callerOpenInWindow);

  // If configured or requested to run in a visible Command Prompt window
  if (shouldOpenInWindow) {
    return new Promise((resolve) => {
      const winCmd = `start "SORA Command Prompt" cmd.exe /k "cd /d "${effectiveCwd}" && ${command}"`;
      exec(winCmd, { windowsHide: false }, (err) => {
        if (err) {
          resolve({
            ok: false,
            error: `Failed to open visible terminal window: ${err.message}`,
            data: { command, cwd: effectiveCwd, exitCode: 1 },
          });
        } else {
          resolve({
            ok: true,
            data: {
              command,
              exitCode: 0,
              stdout: `Command launched in opened Command Prompt window at "${effectiveCwd}".`,
              cwd: effectiveCwd,
              openedWindow: true,
            },
          });
        }
      });
    });
  }

  const startTime = Date.now();

  return new Promise((resolve) => {
    const execOptions = {
      cwd: effectiveCwd,
      timeout: effectiveTimeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024, // 4MB
    };

    if (shellType === 'powershell') {
      execOptions.shell = 'powershell.exe';
    } else if (shellType === 'cmd') {
      execOptions.shell = 'cmd.exe';
    }

    exec(command, execOptions, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      const exitCode = error ? (error.code ?? 1) : 0;

      const trimmedStdout = (stdout || '').trim();
      const trimmedStderr = (stderr || '').trim();

      if (error && error.killed) {
        resolve({
          ok: false,
          error: `Command timed out after ${effectiveTimeout}ms: "${command}"`,
          data: {
            command,
            exitCode: -1,
            stdout: trimmedStdout,
            stderr: trimmedStderr,
            cwd: effectiveCwd,
            durationMs,
          },
        });
        return;
      }

      resolve({
        ok: exitCode === 0,
        data: {
          command,
          exitCode,
          stdout: trimmedStdout.length > 8000 ? `${trimmedStdout.slice(0, 8000)}... [truncated]` : trimmedStdout,
          stderr: trimmedStderr.length > 4000 ? `${trimmedStderr.slice(0, 4000)}... [truncated]` : trimmedStderr,
          cwd: effectiveCwd,
          durationMs,
        },
        error: exitCode !== 0 ? (trimmedStderr || error?.message || `Command failed with exit code ${exitCode}`) : undefined,
      });
    });
  });
}

/**
 * Open a visible Command Prompt (cmd.exe), Windows Terminal (wt.exe), or PowerShell window.
 */
export async function terminal_open(args, context = {}) {
  const { command, cwd, shell = 'cmd', keepOpen = true } = args;
  const effectiveCwd = cwd ? path.resolve(cwd) : (context.workspaceRoot || process.cwd());
  const targetShell = (shell || 'cmd').toLowerCase().trim();

  return new Promise((resolve) => {
    let winCmd = '';
    if (targetShell === 'wt' || targetShell === 'terminal' || targetShell === 'windows terminal') {
      const runPart = command ? `cmd /k "${command}"` : '';
      winCmd = `start "" wt.exe -d "${effectiveCwd}" ${runPart}`.trim();
    } else if (targetShell === 'powershell') {
      const runPart = command
        ? `-NoExit -Command "Set-Location '${effectiveCwd}'; ${command}"`
        : `-NoExit -Command "Set-Location '${effectiveCwd}'"`;
      winCmd = `start "SORA PowerShell" powershell.exe ${runPart}`;
    } else {
      // cmd.exe
      const runPart = command
        ? (keepOpen ? `/k "cd /d "${effectiveCwd}" && ${command}"` : `/c "cd /d "${effectiveCwd}" && ${command}"`)
        : `/k "cd /d "${effectiveCwd}""`;
      winCmd = `start "SORA Command Prompt" cmd.exe ${runPart}`;
    }

    exec(winCmd, { windowsHide: false }, (err) => {
      if (err) {
        // Fallback: if wt.exe failed, fallback to cmd.exe
        const fallbackCmd = command
          ? `start "SORA Command Prompt" cmd.exe /k "cd /d "${effectiveCwd}" && ${command}"`
          : `start "SORA Command Prompt" cmd.exe /k "cd /d "${effectiveCwd}""`;
        exec(fallbackCmd, { windowsHide: false }, (fbErr) => {
          if (fbErr) {
            resolve({ ok: false, error: `Could not open terminal: ${fbErr.message}` });
          } else {
            resolve({
              ok: true,
              data: {
                opened: true,
                cwd: effectiveCwd,
                shell: 'cmd',
                fallback: true,
                message: `Opened Command Prompt at ${effectiveCwd}`,
              },
            });
          }
        });
        return;
      }

      resolve({
        ok: true,
        data: {
          opened: true,
          cwd: effectiveCwd,
          shell: targetShell,
          command: command || undefined,
          message: command
            ? `Opened ${targetShell} window and executed "${command}" in ${effectiveCwd}`
            : `Opened ${targetShell} window navigated to ${effectiveCwd}`,
        },
      });
    });
  });
}

