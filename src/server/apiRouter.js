/**
 * API Router for FreeLLMAPI Backend Endpoints
 * Supports Vite middleware and standalone Node HTTP server.
 *
 * Routes:
 *   GET  /api/health          — Gateway health check
 *   GET  /api/models          — List available models
 *   POST /api/chat            — Chat completions (streaming SSE or JSON)
 *   GET  /api/chats           — List all saved chat sessions
 *   GET  /api/chats/:id       — Get a single chat session
 *   POST /api/chats           — Save (create/update) a chat session
 *   DELETE /api/chats/:id     — Delete a chat session
 *   GET  /api/chats/search?q= — Semantic vector search over chats
 */
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { FreeLLMAPIProvider } from './FreeLLMAPIProvider.js';
import { listChats, getChatById, saveChat, deleteChat, deleteAllChats, deleteChatsOlderThan, searchChats } from './chatStore.js';
import { performWebSearch, readSiteContent } from './webSearch.js';
import {
  listMemories,
  getMemoryById,
  saveMemory,
  deleteMemory,
  searchMemories,
  detectAndExtractMemories,
  recallContextForQuery,
} from './memoryStore.js';
import { buildSystemPrompt, SORA_PROMPT_VERSION } from './systemPrompt.js';
import { parseReasoningAndAnswer } from './responseParser.js';

import { fileURLToPath } from 'node:url';
import { getExtensionManager } from '../extensions/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to user-saved gateway settings */
const SETTINGS_FILE = path.resolve(__dirname, '../../data/sora_settings.json');
const DEFAULT_BASE_URL = 'http://127.0.0.1:31415/v1';
const DEFAULT_MODEL = 'auto';
const DEFAULT_CHAT_RETENTION_DAYS = 0;

let defaultProviderInstance = null;
let activeWorkspaceRoot = process.cwd();

export const extensionManager = getExtensionManager({
  extensionsDir: path.resolve(__dirname, '../../extensions'),
  configFile: path.resolve(__dirname, '../../data/extensions_config.json'),
});
let extensionManagerInitialized = false;

export async function ensureExtensionManager() {
  if (!extensionManagerInitialized) {
    try {
      await extensionManager.initialize();
      const settings = loadSettings();
      if (settings.permissionAllowance) {
        extensionManager.permissionManager.setAllowanceMode(settings.permissionAllowance);
      }
      extensionManagerInitialized = true;
    } catch (err) {
      console.warn('[API Router] ExtensionManager init error:', err.message);
    }
  }
  return extensionManager;
}

if (process.env.NODE_ENV !== 'test') {
  ensureExtensionManager();
}

/** Load persisted user gateway settings (baseUrl, apiKey, model) */
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

/** Save gateway settings to disk and reset the provider instance so changes apply immediately */
function saveSettings(settings) {
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Settings] Failed to persist settings:', err.message);
  }
  // Force provider re-creation on next request
  defaultProviderInstance = null;
}

/**
 * Extract plain text string from content (whether string or array of vision parts).
 * @param {string|Array<any>} content
 * @returns {string}
 */
export function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && (part.type === 'text' || typeof part.text === 'string'))
      .map((part) => part.text || '')
      .join('\n');
  }
  return '';
}

/**
 * Resolve a path safely relative to activeWorkspaceRoot.
 * Prevents path traversal attacks (e.g. ../../etc/passwd).
 * Handles subfolders and Windows/POSIX separators smoothly.
 * @param {string} [target]
 * @returns {string}
 */
function resolveSafePath(target) {
  if (!target) return activeWorkspaceRoot;
  let cleanTarget = String(target).trim();

  // If path starts with / or \, on Windows path.isAbsolute('/src') returns true and
  // resolves to D:\src instead of activeWorkspaceRoot\src!
  // Unless it starts with a Windows drive letter (e.g. D:) or UNC path, treat as workspace-relative.
  if (/^[/\\]/.test(cleanTarget) && !/^[a-zA-Z]:[/\\]/.test(cleanTarget) && !cleanTarget.startsWith('\\\\')) {
    cleanTarget = cleanTarget.replace(/^[/\\]+/, '');
  }

  const isRealAbsolute = (cleanTarget.startsWith('\\\\') || /^[a-zA-Z]:[/\\]/.test(cleanTarget) || (process.platform !== 'win32' && path.isAbsolute(cleanTarget)));
  const resolved = isRealAbsolute
    ? path.resolve(cleanTarget)
    : path.resolve(activeWorkspaceRoot, cleanTarget);

  const relative = path.relative(activeWorkspaceRoot, resolved);
  if (relative.startsWith('..') && !isRealAbsolute) {
    throw new Error('Path traversal attempt detected outside workspace: ' + target);
  }
  return resolved;
}

export function getProvider() {
  if (!defaultProviderInstance) {
    const saved = loadSettings();
    defaultProviderInstance = new FreeLLMAPIProvider({
      baseUrl: saved.baseUrl || undefined,
      apiKey: saved.apiKey || undefined,
      model: saved.model || undefined,
    });
  }
  return defaultProviderInstance;
}

export function setProvider(provider) {
  defaultProviderInstance = provider;
}

/**
 * Parse JSON body from incoming Node.js IncomingMessage
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<any>}
 */
export async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;
    const fail = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    req.on('data', (chunk) => {
      if (settled) return; // already rejected — stop accumulating
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        fail(new Error('Request payload too large'));
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Malformed JSON request body: ' + err.message));
      }
    });
    req.on('error', fail);
  });
}

/**
 * Send a JSON response
 */
function jsonResponse(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

/**
 * Handle incoming API requests
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {FreeLLMAPIProvider} [customProvider]
 * @returns {Promise<boolean>} True if handled, false if not an API route
 */
export async function handleApiRequest(req, res, customProvider) {
  const provider = customProvider || getProvider();
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // ── Modular Extension System Endpoints ─────────────────────────────────
  // GET /api/extensions — List installed extensions, status, permissions, configs
  if (req.method === 'GET' && pathname === '/api/extensions') {
    await ensureExtensionManager();
    const extensions = extensionManager.listExtensions();
    jsonResponse(res, 200, { ok: true, extensions });
    return true;
  }

  // POST /api/extensions/import — Import extension from local directory
  if (req.method === 'POST' && pathname === '/api/extensions/import') {
    await ensureExtensionManager();
    let body;
    try { body = await parseJsonBody(req); } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
      return true;
    }
    const folderPath = body?.path;
    if (!folderPath) {
      jsonResponse(res, 400, { ok: false, error: 'Path parameter is required.' });
      return true;
    }
    try {
      const result = await extensionManager.importExtension(folderPath);
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // POST /api/extensions/:id/toggle — Enable or disable extension
  const toggleMatch = pathname.match(/^\/api\/extensions\/([^/]+)\/toggle$/);
  if (req.method === 'POST' && toggleMatch) {
    await ensureExtensionManager();
    const extId = decodeURIComponent(toggleMatch[1]);
    let body = {};
    try { body = await parseJsonBody(req); } catch {}
    try {
      if (body.enabled === false) {
        const result = extensionManager.disableExtension(extId);
        jsonResponse(res, 200, result);
      } else {
        const result = await extensionManager.enableExtension(extId);
        jsonResponse(res, 200, result);
      }
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // POST /api/extensions/:id/config — Update configuration and permissions
  const configMatch = pathname.match(/^\/api\/extensions\/([^/]+)\/config$/);
  if (req.method === 'POST' && configMatch) {
    await ensureExtensionManager();
    const extId = decodeURIComponent(configMatch[1]);
    let body;
    try { body = await parseJsonBody(req); } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
      return true;
    }
    try {
      const result = extensionManager.updateExtensionConfig(extId, {
        config: body.config,
        permissions: body.permissions,
      });
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // POST /api/extensions/:id/reload — Reload extension from disk
  const reloadMatch = pathname.match(/^\/api\/extensions\/([^/]+)\/reload$/);
  if (req.method === 'POST' && reloadMatch) {
    await ensureExtensionManager();
    const extId = decodeURIComponent(reloadMatch[1]);
    try {
      const result = await extensionManager.reloadExtension(extId);
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // DELETE /api/extensions/:id — Remove extension
  const deleteExtMatch = pathname.match(/^\/api\/extensions\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteExtMatch) {
    await ensureExtensionManager();
    const extId = decodeURIComponent(deleteExtMatch[1]);
    try {
      const result = extensionManager.removeExtension(extId);
      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
    }
    return true;
  }

  // GET /api/extensions/tools — List all active tools, schemas, and prompt formats
  if (req.method === 'GET' && pathname === '/api/extensions/tools') {
    await ensureExtensionManager();
    const tools = extensionManager.toolRegistry.listTools();
    const promptFormat = extensionManager.toolRegistry.formatToolsForPrompt();
    const openAiSchema = extensionManager.toolRegistry.getToolsOpenAISchema();
    jsonResponse(res, 200, { ok: true, tools, promptFormat, openAiSchema });
    return true;
  }

  // POST /api/extensions/execute — Execute an extension tool
  if (req.method === 'POST' && pathname === '/api/extensions/execute') {
    await ensureExtensionManager();
    let body;
    try { body = await parseJsonBody(req); } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message });
      return true;
    }
    const { tool, args = {} } = body || {};
    if (!tool) {
      jsonResponse(res, 400, { ok: false, error: '"tool" name is required.' });
      return true;
    }
    try {
      const result = await extensionManager.bridge.executeTool(tool, args, {
        workspaceRoot: activeWorkspaceRoot,
      });
      jsonResponse(res, result.ok ? 200 : 400, result);
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // ── GET /api/health ─────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/health') {
    try {
      const health = await provider.checkHealth();
      jsonResponse(res, health.ok ? 200 : 503, health);
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: provider.formatError(err) });
    }
    return true;
  }

  // ── GET /api/models ──────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/models') {
    try {
      const models = await provider.getModels();
      jsonResponse(res, 200, { ok: true, models });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: provider.formatError(err) });
    }
    return true;
  }

  // ── GET /api/settings ───────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/settings') {
    const saved = loadSettings();
    // Never expose the full API key — return masked version
    const maskedKey = saved.apiKey
      ? saved.apiKey.slice(0, 8) + '•'.repeat(Math.max(0, saved.apiKey.length - 8))
      : '';
    jsonResponse(res, 200, {
      ok: true,
      baseUrl: saved.baseUrl || DEFAULT_BASE_URL,
      apiKeyMasked: maskedKey,
      apiKeySet: Boolean(saved.apiKey),
      model: saved.model || DEFAULT_MODEL,
      autoDeleteChats: Boolean(saved.autoDeleteChats),
      chatRetentionDays: Number.isFinite(Number(saved.chatRetentionDays))
        ? Math.max(0, Math.min(3650, Number(saved.chatRetentionDays)))
        : DEFAULT_CHAT_RETENTION_DAYS,
      permissionAllowance: saved.permissionAllowance || 'full_access',
      systemPromptVersion: SORA_PROMPT_VERSION,
      defaultIdentity: 'Sora',
    });
    return true;
  }

  // ── POST /api/settings ──────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/settings') {
    let body;
    try { body = await parseJsonBody(req); } catch (err) {
      jsonResponse(res, 400, { error: err.message });
      return true;
    }
    const current = loadSettings();
    const updated = {
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl.trim() : (current.baseUrl || ''),
      // Only update apiKey if a non-masked value was provided
      apiKey: (typeof body.apiKey === 'string' && !body.apiKey.includes('•'))
        ? body.apiKey.trim()
        : (current.apiKey || ''),
      model: typeof body.model === 'string' ? body.model.trim() : (current.model || ''),
      autoDeleteChats: typeof body.autoDeleteChats === 'boolean'
        ? body.autoDeleteChats
        : Boolean(current.autoDeleteChats),
      chatRetentionDays: Number.isFinite(Number(body.chatRetentionDays))
        ? Math.max(0, Math.min(3650, Math.floor(Number(body.chatRetentionDays))))
        : (Number.isFinite(Number(current.chatRetentionDays))
          ? Math.max(0, Math.min(3650, Math.floor(Number(current.chatRetentionDays))))
          : DEFAULT_CHAT_RETENTION_DAYS),
      permissionAllowance: ['full_access', 'sandbox', 'strict'].includes(body.permissionAllowance)
        ? body.permissionAllowance
        : (current.permissionAllowance || 'full_access'),
    };
    saveSettings(updated);
    if (extensionManagerInitialized) {
      extensionManager.permissionManager.setAllowanceMode(updated.permissionAllowance);
    }
    jsonResponse(res, 200, { ok: true, message: 'Settings saved. Gateway reconfigured.' });
    return true;
  }

  // ── POST /api/chat ───────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/chat') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      jsonResponse(res, 400, { error: err.message });
      return true;
    }

    const { messages, model, stream = true, temperature, recallMemory = true, currentChatId } = body;

    if (!messages || !Array.isArray(messages)) {
      jsonResponse(res, 400, { error: 'Missing or invalid "messages" in request body.' });
      return true;
    }

    // Extract any existing client-provided system message
    let clientSystemPrompt = '';
    const nonSystemMessages = [];
    for (const m of messages) {
      if (m.role === 'system') {
        const text = extractTextFromContent(m.content);
        if (text) {
          clientSystemPrompt = clientSystemPrompt ? `${clientSystemPrompt}\n\n${text}` : text;
        }
      } else {
        nonSystemMessages.push({ role: m.role, content: m.content });
      }
    }

    // Process Memory & Cross-Chat Context Recall
    let recalledData = null;
    let autoSavedMemories = [];

    if (recallMemory !== false) {
      const lastUserMsg = [...nonSystemMessages].reverse().find((m) => m.role === 'user');
      const queryText = lastUserMsg ? extractTextFromContent(lastUserMsg.content) : '';
      if (queryText) {
        try {
          recalledData = await recallContextForQuery(
            queryText,
            { currentChatId: currentChatId || null, maxMemories: 5, maxChatTurns: 3 },
            { baseUrl: provider.baseUrl, apiKey: provider.apiKey }
          );

          // Automatic memory extraction
          const detected = detectAndExtractMemories(queryText);
          for (const item of detected) {
            const saved = saveMemory({
              ...item,
              source: currentChatId ? `chat:${currentChatId}` : 'conversation-auto',
            });
            autoSavedMemories.push(saved);
          }
        } catch (recallErr) {
          console.warn('[API Router] Memory recall failed:', recallErr.message);
        }
      }
    }

    // Build centralized, versioned system prompt adhering to strict 4-tier hierarchy
    await ensureExtensionManager();
    const settings = loadSettings();
    const permissionAllowance = settings.permissionAllowance || 'full_access';
    extensionManager.permissionManager.setAllowanceMode(permissionAllowance);

    // If clientSystemPrompt didn't already supply tools prompt, inject all active extension tools
    const toolsPrompt = clientSystemPrompt.includes('AVAILABLE TOOLS:')
      ? ''
      : extensionManager.toolRegistry.formatToolsForPrompt();

    const centralizedSystemPrompt = buildSystemPrompt({
      clientSystemPrompt,
      recalledContext: recalledData?.formattedContext || '',
      currentModel: model || provider.defaultModel || 'auto',
      toolsPrompt,
      permissionAllowance,
    });

    // Sanitize messages before sending to the LLM:
    // 1. Drop any non-system message whose text content is empty/whitespace.
    // 2. Collapse consecutive same-role messages (some LLMs reject them) by
    //    joining their content with a separator.
    const sanitizeContent = (content) => {
      let str = '';
      if (typeof content === 'string') str = content.trim();
      else if (Array.isArray(content)) {
        str = content
          .map((p) => (p?.type === 'text' ? (p.text || '').trim() : '[image]'))
          .filter(Boolean)
          .join(' ');
      }
      if (!str) return '';
      // Strip [Called tool: ...] and [Calling tool: ...] markers so they never leak into model history
      str = str
        .replace(/\[Called tool:[^\]]*\]/gi, '')
        .replace(/\[Calling tool:[^\]]*\]/gi, '')
        .trim();
      return str;
    };

    const rawMessages = [
      { role: 'system', content: centralizedSystemPrompt },
      ...nonSystemMessages,
    ];

    // Remove messages where content is empty (would cause upstream API errors)
    const filteredMessages = rawMessages.filter((m) => {
      const text = sanitizeContent(m.content);
      return text.length > 0;
    });

    // Collapse consecutive same-role turns (join with newline separator)
    const messagesForModel = [];
    for (const msg of filteredMessages) {
      const last = messagesForModel[messagesForModel.length - 1];
      const isVision = Array.isArray(msg.content);
      const cleaned = msg.role === 'system' || isVision ? msg.content : sanitizeContent(msg.content);
      if (last && last.role === msg.role && msg.role !== 'system') {
        // Merge: combine text content
        const prevText = typeof last.content === 'string' ? last.content : sanitizeContent(last.content);
        last.content = prevText + '\n\n' + cleaned;
      } else {
        messagesForModel.push({ role: msg.role, content: cleaned });
      }
    }

    // Guard: ensure the last message before the API call is from 'user'
    // (some LLMs reject conversations that end with 'assistant')
    if (messagesForModel.length > 0 && messagesForModel[messagesForModel.length - 1].role === 'assistant') {
      messagesForModel.push({ role: 'user', content: '(Please continue.)' });
    }

    const abortController = new AbortController();
    req.on('close', () => {
      abortController.abort();
    });

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Send initial recall and auto-save metadata events if present
      if (recalledData && (recalledData.memoriesRecalled?.length || recalledData.chatExcerptsRecalled?.length)) {
        res.write(
          `data: ${JSON.stringify({
            recalled: {
              memories: recalledData.memoriesRecalled,
              excerpts: recalledData.chatExcerptsRecalled,
            },
          })}\n\n`
        );
      }
      if (autoSavedMemories.length > 0) {
        res.write(`data: ${JSON.stringify({ memorySaved: autoSavedMemories })}\n\n`);
      }

      try {
        await provider.streamChat({
          messages: messagesForModel,
          model,
          temperature,
          signal: abortController.signal,
          onReasoning: (reasoning) => {
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ reasoning })}\n\n`);
            }
          },
          onToken: (token) => {
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ token })}\n\n`);
            }
          },
          onDone: () => {
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
              res.end();
            }
          },
          onError: (err) => {
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify({ error: provider.formatError(err) })}\n\n`);
              res.end();
            }
          },
        });
      } catch {
        if (!res.writableEnded) {
          res.end();
        }
      }
      return true;
    } else {
      try {
        const result = await provider.chat({
          messages: messagesForModel,
          model,
          temperature,
          signal: abortController.signal,
        });
        const parsed = parseReasoningAndAnswer(result.content);
        const cleanMessage = {
          ...result,
          content: parsed.answer,
          reasoning: result.reasoning || parsed.thought,
        };
        jsonResponse(res, 200, {
          ok: true,
          message: cleanMessage,
          recalled: recalledData,
          memorySaved: autoSavedMemories,
        });
      } catch (err) {
        jsonResponse(res, 500, { ok: false, error: provider.formatError(err) });
      }
      return true;
    }
  }

  // ── GET /api/chats/search?q=... ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/chats/search') {
    const q = url.searchParams.get('q') || '';
    if (!q.trim()) {
      jsonResponse(res, 400, { error: 'Missing search query parameter "q".' });
      return true;
    }
    try {
      const opts = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };
      const results = await searchChats(q, 10, opts);
      jsonResponse(res, 200, { ok: true, chats: results });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── GET /api/web-search?q=...&read=true ─────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/web-search') {
    const q = url.searchParams.get('q') || '';
    const read = url.searchParams.get('read') !== 'false';
    if (!q.trim()) {
      jsonResponse(res, 400, { error: 'Missing search query parameter "q".' });
      return true;
    }
    try {
      const results = await performWebSearch(q, 5, read);
      jsonResponse(res, 200, { ok: true, results });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── GET/POST /api/read-site?url=... ─────────────────────────────────────
  if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/read-site') {
    let targetUrl = url.searchParams.get('url') || '';
    if (!targetUrl && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        targetUrl = body?.url || '';
      } catch {}
    }

    if (!targetUrl.trim()) {
      jsonResponse(res, 400, { error: 'Missing "url" parameter.' });
      return true;
    }

    try {
      const siteData = await readSiteContent(targetUrl.trim());
      jsonResponse(res, 200, { ok: true, data: siteData });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── DELETE all saved chat history (must be checked before /api/chats/:id) ──
  if (req.method === 'DELETE' && pathname === '/api/chats') {
    try {
      const opts = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };
      const deletedCount = await deleteAllChats(opts);
      jsonResponse(res, 200, { ok: true, deletedCount });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── GET /api/chats ───────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/chats') {
    try {
      const opts = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };
      const savedSettings = loadSettings();
      if (savedSettings.autoDeleteChats && Number(savedSettings.chatRetentionDays) > 0) {
        await deleteChatsOlderThan(Number(savedSettings.chatRetentionDays), opts);
      }
      const chats = await listChats(opts);
      jsonResponse(res, 200, { ok: true, chats });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── GET /api/chats/:id ───────────────────────────────────────────────────
  const chatGetMatch = pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (req.method === 'GET' && chatGetMatch) {
    const id = decodeURIComponent(chatGetMatch[1]);
    try {
      const opts = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };
      const chat = await getChatById(id, opts);
      if (!chat) {
        jsonResponse(res, 404, { ok: false, error: 'Chat not found.' });
      } else {
        jsonResponse(res, 200, { ok: true, chat });
      }
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── POST /api/chats ──────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/chats') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      jsonResponse(res, 400, { error: err.message });
      return true;
    }

    if (!body.messages || !Array.isArray(body.messages)) {
      jsonResponse(res, 400, { error: 'Missing or invalid "messages" field.' });
      return true;
    }

    try {
      const opts = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };
      const saved = await saveChat(body, opts);
      jsonResponse(res, 200, { ok: true, chat: saved });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── DELETE /api/chats/:id ────────────────────────────────────────────────
  const chatDeleteMatch = pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (req.method === 'DELETE' && chatDeleteMatch) {
    const id = decodeURIComponent(chatDeleteMatch[1]);
    try {
      const opts = { baseUrl: provider.baseUrl, apiKey: provider.apiKey };
      await deleteChat(id, opts);
      jsonResponse(res, 200, { ok: true });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── GET /api/memories/search?q=... ─────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/memories/search') {
    const q = url.searchParams.get('q') || '';
    const type = url.searchParams.get('type') || undefined;
    try {
      const results = searchMemories(q, { limit: 10, type });
      jsonResponse(res, 200, { ok: true, memories: results });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── GET /api/memories ──────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/memories') {
    const type = url.searchParams.get('type') || undefined;
    const pinnedOnly = url.searchParams.get('pinnedOnly') === 'true';
    const q = url.searchParams.get('q') || '';
    try {
      const list = listMemories({ type, pinnedOnly, query: q });
      jsonResponse(res, 200, { ok: true, memories: list });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── GET /api/memories/:id ──────────────────────────────────────────────────
  const memoryGetMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
  if (req.method === 'GET' && memoryGetMatch) {
    const id = decodeURIComponent(memoryGetMatch[1]);
    try {
      const memory = getMemoryById(id);
      if (!memory) {
        jsonResponse(res, 404, { ok: false, error: 'Memory not found.' });
      } else {
        jsonResponse(res, 200, { ok: true, memory });
      }
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── POST /api/memories ─────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/memories') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      jsonResponse(res, 400, { error: err.message });
      return true;
    }

    if (!body || (!body.title && !body.content)) {
      jsonResponse(res, 400, { error: 'Memory requires at least a title or content.' });
      return true;
    }

    try {
      const saved = saveMemory(body);
      jsonResponse(res, 200, { ok: true, memory: saved });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── DELETE /api/memories/:id ───────────────────────────────────────────────
  const memoryDeleteMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
  if (req.method === 'DELETE' && memoryDeleteMatch) {
    const id = decodeURIComponent(memoryDeleteMatch[1]);
    try {
      const success = deleteMemory(id);
      jsonResponse(res, 200, { ok: true, deleted: success });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }

  // ── POST /api/memories/detect ──────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/memories/detect') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      jsonResponse(res, 400, { error: err.message });
      return true;
    }
    const detected = detectAndExtractMemories(body?.text || '');
    jsonResponse(res, 200, { ok: true, detected });
    return true;
  }

  // ── GET /api/context/recall?q=...&chatId=... ───────────────────────────────
  if (req.method === 'GET' && pathname === '/api/context/recall') {
    const q = url.searchParams.get('q') || '';
    const chatId = url.searchParams.get('chatId') || null;
    try {
      const recalled = await recallContextForQuery(
        q,
        { currentChatId: chatId, maxMemories: 5, maxChatTurns: 3 },
        { baseUrl: provider.baseUrl, apiKey: provider.apiKey }
      );
      jsonResponse(res, 200, { ok: true, ...recalled });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: String(err.message) });
    }
    return true;
  }


  // ── IDE Endpoints ──────────────────────────────────────────────────────────

  // GET /api/ide/info
  if (req.method === 'GET' && pathname === '/api/ide/info') {
    jsonResponse(res, 200, {
      ok: true,
      workspaceRoot: activeWorkspaceRoot,
      cwd: process.cwd(),
      platform: process.platform,
      nodeVersion: process.version,
    });
    return true;
  }

  // POST /api/ide/workspace — Switch active workspace folder
  if (req.method === 'POST' && pathname === '/api/ide/workspace') {
    try {
      const body = await parseJsonBody(req);
      const { path: newPath } = body;
      if (!newPath || typeof newPath !== 'string') {
        jsonResponse(res, 400, { ok: false, error: 'Target workspace directory path is required.' });
        return true;
      }
      const targetDir = path.isAbsolute(newPath)
        ? path.resolve(newPath)
        : path.resolve(activeWorkspaceRoot, newPath);

      if (!fs.existsSync(targetDir)) {
        jsonResponse(res, 404, { ok: false, error: 'Directory does not exist: ' + targetDir });
        return true;
      }
      const stat = fs.statSync(targetDir);
      if (!stat.isDirectory()) {
        jsonResponse(res, 400, { ok: false, error: 'Specified path is not a directory: ' + targetDir });
        return true;
      }

      activeWorkspaceRoot = targetDir;
      jsonResponse(res, 200, {
        ok: true,
        workspaceRoot: activeWorkspaceRoot,
        message: 'Active workspace switched to ' + activeWorkspaceRoot,
      });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // GET /api/ide/list?path=...
  if (req.method === 'GET' && pathname === '/api/ide/list') {
    try {
      const relPath = url.searchParams.get('path') || '';
      const targetDir = resolveSafePath(relPath);

      if (!fs.existsSync(targetDir)) {
        jsonResponse(res, 404, { ok: false, error: 'Directory not found: ' + relPath });
        return true;
      }

      const dirents = fs.readdirSync(targetDir, { withFileTypes: true });
      const items = dirents
        .filter((d) => !d.name.startsWith('.git') && d.name !== 'node_modules')
        .map((d) => {
          const itemPath = path.join(targetDir, d.name);
          const itemRel = path.relative(activeWorkspaceRoot, itemPath);
          const isDir = d.isDirectory();
          let size = 0;
          try {
            if (!isDir) size = fs.statSync(itemPath).size;
          } catch {}
          return {
            name: d.name,
            path: itemRel.replace(/\\/g, '/'),
            isDirectory: isDir,
            size,
            ext: isDir ? '' : path.extname(d.name).slice(1),
          };
        })
        .sort((a, b) => {
          if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
          return a.isDirectory ? -1 : 1;
        });

      jsonResponse(res, 200, {
        ok: true,
        currentPath: path.relative(activeWorkspaceRoot, targetDir).replace(/\\/g, '/'),
        workspaceRoot: activeWorkspaceRoot,
        items,
      });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // GET /api/ide/read?path=...
  if (req.method === 'GET' && pathname === '/api/ide/read') {
    try {
      const relPath = url.searchParams.get('path');
      if (!relPath) {
        jsonResponse(res, 400, { ok: false, error: 'Path parameter required' });
        return true;
      }
      const targetFile = resolveSafePath(relPath);
      if (!fs.existsSync(targetFile)) {
        jsonResponse(res, 404, { ok: false, error: 'File not found: ' + relPath });
        return true;
      }
      const ext = path.extname(targetFile).toLowerCase();
      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg'];
      if (imageExts.includes(ext)) {
        const mime = ext === '.png' ? 'image/png'
          : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.gif' ? 'image/gif'
          : ext === '.webp' ? 'image/webp'
          : ext === '.svg' ? 'image/svg+xml'
          : 'image/x-icon';
        const buffer = fs.readFileSync(targetFile);
        const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
        jsonResponse(res, 200, {
          ok: true,
          path: relPath.replace(/\\/g, '/'),
          isImage: true,
          dataUrl,
          content: `[Image file: ${path.basename(targetFile)} (${buffer.length} bytes)]`,
        });
        return true;
      }
      const content = fs.readFileSync(targetFile, 'utf8');
      jsonResponse(res, 200, {
        ok: true,
        path: relPath.replace(/\\/g, '/'),
        content,
      });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // POST /api/ide/write
  if (req.method === 'POST' && pathname === '/api/ide/write') {
    try {
      const body = await parseJsonBody(req);
      const { path: relPath, content } = body;
      if (!relPath) {
        jsonResponse(res, 400, { ok: false, error: 'Path is required' });
        return true;
      }
      const targetFile = resolveSafePath(relPath);
      const parentDir = path.dirname(targetFile);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(targetFile, content ?? '', 'utf8');
      jsonResponse(res, 200, {
        ok: true,
        path: relPath.replace(/\\/g, '/'),
        savedAt: new Date().toISOString(),
      });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // POST /api/ide/create
  if (req.method === 'POST' && pathname === '/api/ide/create') {
    try {
      const body = await parseJsonBody(req);
      const { path: relPath, isDir } = body;
      if (!relPath) {
        jsonResponse(res, 400, { ok: false, error: 'Path is required' });
        return true;
      }
      const target = resolveSafePath(relPath);
      if (isDir) {
        fs.mkdirSync(target, { recursive: true });
      } else {
        const parentDir = path.dirname(target);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        if (!fs.existsSync(target)) {
          fs.writeFileSync(target, '', 'utf8');
        }
      }
      jsonResponse(res, 200, { ok: true, path: relPath.replace(/\\/g, '/') });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // POST /api/ide/rename
  if (req.method === 'POST' && pathname === '/api/ide/rename') {
    try {
      const body = await parseJsonBody(req);
      const { oldPath, newPath } = body;
      if (!oldPath || !newPath) {
        jsonResponse(res, 400, { ok: false, error: 'Both oldPath and newPath are required' });
        return true;
      }
      const targetOld = resolveSafePath(oldPath);
      const targetNew = resolveSafePath(newPath);
      if (!fs.existsSync(targetOld)) {
        jsonResponse(res, 404, { ok: false, error: 'Source not found: ' + oldPath });
        return true;
      }
      const parentDir = path.dirname(targetNew);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.renameSync(targetOld, targetNew);
      jsonResponse(res, 200, {
        ok: true,
        oldPath: oldPath.replace(/\\/g, '/'),
        newPath: newPath.replace(/\\/g, '/'),
      });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // POST /api/ide/delete
  if (req.method === 'POST' && pathname === '/api/ide/delete') {
    try {
      const body = await parseJsonBody(req);
      const { path: relPath } = body;
      if (typeof relPath !== 'string') {
        jsonResponse(res, 400, { ok: false, error: 'Path is required' });
        return true;
      }
      const trimmed = relPath.trim();
      if (!trimmed || trimmed === '.' || trimmed === '/' || trimmed === '\\') {
        jsonResponse(res, 400, { ok: false, error: 'Cannot delete the active workspace root folder.' });
        return true;
      }
      const target = resolveSafePath(trimmed);
      // Essential safeguard: Prevent deleting the active workspace root itself
      if (
        path.resolve(target) === path.resolve(activeWorkspaceRoot) ||
        !path.relative(activeWorkspaceRoot, target) ||
        path.relative(activeWorkspaceRoot, target) === '.'
      ) {
        jsonResponse(res, 400, { ok: false, error: 'Cannot delete the active workspace root folder.' });
        return true;
      }
      // Essential safeguard: Protect .git metadata repository folder
      const relNorm = path.relative(activeWorkspaceRoot, target).replace(/\\/g, '/');
      if (relNorm === '.git' || relNorm.startsWith('.git/')) {
        jsonResponse(res, 403, { ok: false, error: 'Cannot delete .git repository directory.' });
        return true;
      }
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
      jsonResponse(res, 200, { ok: true, path: relPath.replace(/\\/g, '/') });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // POST /api/ide/exec
  if (req.method === 'POST' && pathname === '/api/ide/exec') {
    try {
      const body = await parseJsonBody(req);
      const { command, cwd: customCwd } = body;
      if (!command) {
        jsonResponse(res, 400, { ok: false, error: 'Command is required' });
        return true;
      }
      const runCwd = customCwd ? resolveSafePath(customCwd) : activeWorkspaceRoot;

      // Essential safeguard: Block catastrophic disk/root wiping operations
      const lowerCmd = command.toLowerCase().trim();
      const dangerousPatterns = [
        /\bformat\s+[a-z]:/i,
        /\b(?:rmdir|del)\s+.*\/s.*[c-z]:\\/i,
        /\brm\s+-rf\s+(?:\/|\/\*|[c-z]:\\)/i,
        /\bremove-item\s+.*(?:-recurse|-r).*(?:-force|-fo).*(?:[c-z]:\\|\/)/i,
        /\bdiskpart\b/i,
      ];
      for (const pattern of dangerousPatterns) {
        if (pattern.test(lowerCmd)) {
          jsonResponse(res, 403, {
            ok: false,
            error: 'Command blocked by safeguard: destructive root or disk-wide operation.',
          });
          return true;
        }
      }

      exec(
        command,
        {
          cwd: runCwd,
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
          shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
        },
        (error, stdout, stderr) => {
          jsonResponse(res, 200, {
            ok: true,
            stdout: stdout || '',
            stderr: stderr || (error ? error.message : ''),
            // error.code can be a string (signal name) or number on Windows — normalise to number
            exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            cwd: runCwd,
          });
        }
      );
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  // GET /api/ide/search?q=...
  if (req.method === 'GET' && pathname === '/api/ide/search') {
    try {
      const q = (url.searchParams.get('q') || '').toLowerCase().trim();
      if (!q) {
        jsonResponse(res, 200, { ok: true, matches: [] });
        return true;
      }
      const matches = [];
      const MAX_MATCHES = 30;

      const scanDirectory = (dir) => {
        if (matches.length >= MAX_MATCHES) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= MAX_MATCHES) break;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(activeWorkspaceRoot, fullPath).replace(/\\/g, '/');

          if (entry.isDirectory()) {
            if (
              entry.name.startsWith('.') ||
              entry.name === 'node_modules' ||
              entry.name === 'dist' ||
              entry.name === 'build'
            ) {
              continue;
            }
            scanDirectory(fullPath);
          } else {
            // Check filename match
            if (entry.name.toLowerCase().includes(q)) {
              matches.push({
                path: relPath,
                type: 'filename',
                line: 0,
                text: entry.name,
              });
            }
            // Check file content match for text files under 2MB
            const ext = path.extname(entry.name).toLowerCase();
            const textExts = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.html', '.css', '.py', '.yml', '.yaml', '.sh', '.rs', '.go'];
            if (textExts.includes(ext)) {
              try {
                const stat = fs.statSync(fullPath);
                if (stat.size < 2 * 1024 * 1024) {
                  const content = fs.readFileSync(fullPath, 'utf8');
                  const lines = content.split('\n');
                  for (let i = 0; i < lines.length; i++) {
                    if (matches.length >= MAX_MATCHES) break;
                    if (lines[i].toLowerCase().includes(q)) {
                      matches.push({
                        path: relPath,
                        type: 'content',
                        line: i + 1,
                        text: lines[i].trim().slice(0, 200),
                      });
                    }
                  }
                }
              } catch {}
            }
          }
        }
      };

      scanDirectory(activeWorkspaceRoot);
      jsonResponse(res, 200, { ok: true, matches });
    } catch (err) {
      jsonResponse(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  return false;
}
