/**
 * SORA Chrome Automation Extension Implementation
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { safeFetch } from '../../src/server/siteReader.js';

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

function launchDetached(executable, args = []) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        shell: false,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (err) {
      reject(err);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function launchDefaultBrowser(targetUrl) {
  if (process.platform === 'win32') {
    return launchDetached('rundll32.exe', ['url.dll,FileProtocolHandler', targetUrl]);
  }
  if (process.platform === 'darwin') {
    return launchDetached('open', [targetUrl]);
  }
  return launchDetached('xdg-open', [targetUrl]);
}

export async function chrome_search_and_navigate(args, context = {}) {
  const { url, newTab = true } = args || {};
  if (typeof url !== 'string' || !url.trim()) {
    return { ok: false, error: 'URL or search query is required' };
  }

  const config = context.config || {};
  const chromePath = findChromePath(config.chromeExecutablePath);
  const targetUrl = normalizeUrl(url, config.defaultSearchEngine);

  try {
    // Pass the URL as one argv value. It is never re-parsed by cmd.exe.
    await launchDetached(chromePath, [targetUrl]);
    return {
      ok: true,
      data: { navigatedTo: targetUrl, browser: 'Google Chrome', newTab },
    };
  } catch (chromeErr) {
    try {
      await launchDefaultBrowser(targetUrl);
      return {
        ok: true,
        data: { navigatedTo: targetUrl, method: 'default-browser-fallback', newTab },
      };
    } catch (fallbackErr) {
      return {
        ok: false,
        error: `Failed to open URL: ${fallbackErr?.message || chromeErr?.message || 'browser launch failed'}`,
      };
    }
  }
}

/**
 * Manage Chrome tabs: open, close, list.
 */
export async function chrome_manage_tabs(args, context = {}) {
  const { action, url } = args || {};

  if (action === 'open') {
    const rawUrl = (typeof url === 'string' ? url : '').trim().toLowerCase();
    const isBlankIntent =
      !rawUrl ||
      rawUrl === 'about:blank' ||
      rawUrl === 'newtab' ||
      rawUrl === 'chrome://newtab' ||
      rawUrl === 'chrome://new-tab-page';

    if (isBlankIntent) {
      const config = context.config || {};
      const chromePath = findChromePath(config.chromeExecutablePath);
      try {
        await launchDetached(chromePath, []);
      } catch (err) {
        try {
          await launchDetached('chrome', []);
        } catch (fallbackErr) {
          return { ok: false, error: `Failed to open Chrome: ${fallbackErr?.message || err?.message}` };
        }
      }
      return { ok: true, data: { navigatedTo: 'New Tab', browser: 'Google Chrome', newTab: true } };
    }

    return chrome_search_and_navigate({ url, newTab: true }, context);
  }

  if (action === 'close') {
    return {
      ok: false,
      error: 'chrome_manage_tabs: "close" requires a Chrome DevTools Protocol (CDP) connection which is not available in this extension. Use the Chrome window directly to close a tab (Ctrl+W).',
      data: {
        action: 'close',
        supported: false,
        hint: 'Use Ctrl+W in Chrome, or open chrome_search_and_navigate to navigate away instead.',
      },
    };
  }

  if (action === 'list') {
    return {
      ok: false,
      error: 'chrome_manage_tabs: "list" requires a Chrome DevTools Protocol (CDP) connection which is not available in this extension.',
      data: {
        action: 'list',
        supported: false,
        hint: 'Tab listing requires a running CDP session. This capability is not implemented.',
      },
    };
  }

  return { ok: false, error: `Unsupported tab action: "${action}"` };
}

/**
 * Open a new Chrome window or private Incognito window.
 */
export async function chrome_manage_windows(args = {}, context = {}) {
  const { incognito = false, url = 'https://www.google.com' } = args || {};
  if (typeof url !== 'string' || !url.trim()) {
    return { ok: false, error: 'A valid URL is required.' };
  }
  const config = context.config || {};
  const chromePath = findChromePath(config.chromeExecutablePath);
  const targetUrl = normalizeUrl(url, config.defaultSearchEngine);
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return { ok: false, error: 'Invalid URL.' };
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return { ok: false, error: 'Only HTTP and HTTPS URLs can be opened in a new window.' };
  }

  const argv = incognito
    ? ['--incognito', '--new-window', targetUrl]
    : ['--new-window', targetUrl];
  try {
    await launchDetached(chromePath, argv);
    return {
      ok: true,
      data: {
        windowType: incognito ? 'incognito' : 'standard',
        openedUrl: targetUrl,
        message: `Opened ${incognito ? 'Incognito' : 'standard'} Chrome window.`,
      },
    };
  } catch (err) {
    return { ok: false, error: `Failed to open window: ${err?.message || 'browser launch failed'}` };
  }
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

    let res;
    try {
      res = await safeFetch(targetUrl, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      return { ok: false, error: 'Redirect blocked by SSRF policy; validate the destination before fetching it.' };
    }

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
