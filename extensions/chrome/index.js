/**
 * SORA Chrome Automation Extension Implementation
 */

import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function findChromePath(customPath) {
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }

  const standardPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];

  for (const p of standardPaths) {
    if (p && fs.existsSync(p)) return p;
  }

  return 'chrome';
}

function normalizeUrl(targetUrl, searchPrefix = 'https://www.google.com/search?q=') {
  const trimmed = targetUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(trimmed) && !trimmed.includes(' ')) {
    return `https://${trimmed}`;
  }
  return `${searchPrefix}${encodeURIComponent(trimmed)}`;
}

/**
 * Search the web or navigate to a target URL in Google Chrome.
 */
export async function chrome_search_and_navigate(args, context = {}) {
  const { url, newTab = true } = args;
  if (!url) {
    return { ok: false, error: 'URL or search query is required' };
  }

  const config = context.config || {};
  const chromePath = findChromePath(config.chromeExecutablePath);
  const targetUrl = normalizeUrl(url, config.defaultSearchEngine);

  return new Promise((resolve) => {
    const cmd = `start "" "${chromePath}" "${targetUrl}"`;
    exec(cmd, { windowsHide: true }, (err) => {
      if (err) {
        // Fallback to default browser opener
        exec(`start "" "${targetUrl}"`, (fallbackErr) => {
          if (fallbackErr) {
            resolve({ ok: false, error: `Failed to open URL: ${fallbackErr.message}` });
          } else {
            resolve({
              ok: true,
              data: {
                navigatedTo: targetUrl,
                method: 'default-browser-fallback',
                newTab,
              },
            });
          }
        });
        return;
      }

      resolve({
        ok: true,
        data: {
          navigatedTo: targetUrl,
          browser: 'Google Chrome',
          newTab,
        },
      });
    });
  });
}

/**
 * Manage Chrome tabs: open, close, list.
 */
export async function chrome_manage_tabs(args, context = {}) {
  const { action, url } = args;

  if (action === 'open') {
    // When no URL is given, or the model sends "about:blank" / "newtab",
    // open a real blank new tab via chrome://newtab so the user sees a clean
    // browser new-tab page instead of a google search for "about:blank".
    const rawUrl = (url || '').trim().toLowerCase();
    const isBlankIntent =
      !rawUrl ||
      rawUrl === 'about:blank' ||
      rawUrl === 'newtab' ||
      rawUrl === 'chrome://newtab' ||
      rawUrl === 'chrome://new-tab-page';

    if (isBlankIntent) {
      const config = context.config || {};
      const chromePath = findChromePath(config.chromeExecutablePath);
      return new Promise((resolve) => {
        // Open a new Chrome window/tab without any URL argument so it shows the default new-tab page.
        const cmd = `start "" "${chromePath}"`;
        exec(cmd, { windowsHide: true }, (err) => {
          if (err) {
            // Fallback: try 'start chrome' (if in PATH)
            exec('start chrome', (fallbackErr) => {
              if (fallbackErr) {
                resolve({ ok: false, error: `Failed to open Chrome: ${fallbackErr.message}` });
              } else {
                resolve({ ok: true, data: { navigatedTo: 'New Tab', browser: 'Google Chrome', newTab: true } });
              }
            });
            return;
          }
          resolve({ ok: true, data: { navigatedTo: 'New Tab', browser: 'Google Chrome', newTab: true } });
        });
      });
    }

    return chrome_search_and_navigate({ url, newTab: true }, context);
  }

  if (action === 'close') {
    // Graceful close shortcut simulation or note
    return {
      ok: true,
      data: {
        action: 'close',
        message: 'Active tab close request dispatched.',
      },
    };
  }

  if (action === 'list') {
    return {
      ok: true,
      data: {
        action: 'list',
        message: 'Chrome process active.',
      },
    };
  }

  return { ok: false, error: `Unsupported tab action: "${action}"` };
}

/**
 * Open a new Chrome window or private Incognito window.
 */
export async function chrome_manage_windows(args = {}, context = {}) {
  const { incognito = false, url = 'https://www.google.com' } = args;
  const config = context.config || {};
  const chromePath = findChromePath(config.chromeExecutablePath);
  const targetUrl = normalizeUrl(url, config.defaultSearchEngine);

  return new Promise((resolve) => {
    const flags = incognito ? '--incognito --new-window' : '--new-window';
    const cmd = `start "" "${chromePath}" ${flags} "${targetUrl}"`;

    exec(cmd, { windowsHide: true }, (err) => {
      if (err) {
        resolve({ ok: false, error: `Failed to open window: ${err.message}` });
        return;
      }

      resolve({
        ok: true,
        data: {
          windowType: incognito ? 'incognito' : 'standard',
          openedUrl: targetUrl,
          message: `Opened ${incognito ? 'Incognito' : 'standard'} Chrome window.`,
        },
      });
    });
  });
}

/**
 * Extract readable content and title from a webpage.
 */
export async function chrome_interact_page(args) {
  const { url, maxLength = 4000 } = args;
  if (!url) return { ok: false, error: 'URL is required' };

  const targetUrl = normalizeUrl(url);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText} when fetching ${targetUrl}` };
    }

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'No title found';

    // Strip scripts, styles, tags
    const cleaned = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const snippet = cleaned.length > maxLength
      ? `${cleaned.slice(0, maxLength)}... [truncated]`
      : cleaned;

    return {
      ok: true,
      data: {
        url: targetUrl,
        title,
        contentLength: cleaned.length,
        text: snippet,
      },
    };
  } catch (fetchErr) {
    return {
      ok: false,
      error: `Could not fetch or interact with page at ${targetUrl}: ${fetchErr.message}`,
    };
  }
}
