export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | MessageContentPart[];
}

export interface GatewayHealth {
  ok: boolean;
  status: string;
  baseUrl?: string;
  model?: string;
  availableModels?: string[];
  error?: string;
  apiKeyConfigured?: boolean;
}

export async function checkGatewayHealth(): Promise<GatewayHealth> {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    return {
      ok: Boolean(data?.ok),
      status: data?.status || (data?.ok ? 'connected' : 'error'),
      baseUrl: data?.baseUrl,
      model: data?.model || 'auto',
      availableModels: data?.availableModels || [],
      error: data?.error,
      apiKeyConfigured: Boolean(data?.apiKeyConfigured),
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 'error',
      error: err?.message || 'Cannot reach backend server. Ensure Vite dev server is running.',
      apiKeyConfigured: false,
    };
  }
}

export async function fetchAvailableModels(): Promise<string[]> {
  const res = await fetch('/api/models');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Model discovery failed (HTTP ${res.status}).`);
  }
  if (!Array.isArray(data?.models)) {
    throw new Error('The gateway returned an invalid available-model list.');
  }
  return data.models.filter((model: unknown): model is string => typeof model === 'string' && model.trim().length > 0);
}

export interface GatewaySettings {
  baseUrl: string;
  apiKeyMasked: string;
  apiKeySet: boolean;
  model: string;
  autoDeleteChats: boolean;
  chatRetentionDays: number;
  systemPromptVersion?: string;
  defaultIdentity?: string;
  permissionAllowance?: 'full_access' | 'sandbox' | 'strict';
}

export { parseReasoningAndAnswer, deduplicateAnswer } from '../utils/responseParser';
export type { ParsedResponse } from '../utils/responseParser';
export { prepareSpeechText } from '../utils/speechPreparation';
export type { SpeechPreparationOptions } from '../utils/speechPreparation';

export async function getSettings(): Promise<GatewaySettings> {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) return { baseUrl: '', apiKeyMasked: '', apiKeySet: false, model: '', autoDeleteChats: false, chatRetentionDays: 30, permissionAllowance: 'full_access' };
    const data = await res.json();
    return {
      baseUrl: data.baseUrl || '',
      apiKeyMasked: data.apiKeyMasked || '',
      apiKeySet: Boolean(data.apiKeySet),
      model: data.model || '',
      autoDeleteChats: Boolean(data.autoDeleteChats),
      chatRetentionDays: Number(data.chatRetentionDays) || 30,
      systemPromptVersion: data.systemPromptVersion || '2026.1.0',
      defaultIdentity: data.defaultIdentity || 'Sora',
      permissionAllowance: data.permissionAllowance || 'full_access',
    };
  } catch {
    return { baseUrl: '', apiKeyMasked: '', apiKeySet: false, model: '', autoDeleteChats: false, chatRetentionDays: 30, permissionAllowance: 'full_access' };
  }
}

export async function saveSettings(settings: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  autoDeleteChats?: boolean;
  chatRetentionDays?: number;
  permissionAllowance?: 'full_access' | 'sandbox' | 'strict';
}): Promise<boolean> {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface RecalledContextPayload {
  memories: MemoryItem[];
  excerpts: Array<{
    chatId: string;
    chatTitle: string;
    date: string;
    userQuery: string;
    assistantExcerpt: string;
    codeSnippet?: string;
    score: number;
  }>;
}

export interface StreamChatOptions {
  model?: string;
  signal?: AbortSignal;
  recallMemory?: boolean;
  currentChatId?: string | null;
  onModel?: (model: string) => void;
  onRoutedVia?: (route: string) => void;
  onRecall?: (recalled: RecalledContextPayload) => void;
  onMemorySaved?: (memories: MemoryItem[]) => void;
  onReasoning?: (thought: string) => void;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (errorMsg: string) => void;
}

export async function streamChatMessage(
  messages: ChatMessage[],
  options: StreamChatOptions
): Promise<void> {
  const {
    model,
    signal,
    recallMemory = true,
    currentChatId = null,
    onModel,
    onRoutedVia,
    onRecall,
    onMemorySaved,
    onReasoning,
    onToken,
    onDone,
    onError,
  } = options;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model,
        stream: true,
        recallMemory,
        currentChatId,
      }),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      let msg = `HTTP ${response.status}`;
      try {
        const p = JSON.parse(errText);
        msg = p.error || msg;
      } catch {
        /* fallback */
      }
      onError(msg);
      return;
    }

    if (!response.body) {
      onError('No response body received from server.');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let doneCalled = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const payloadStr = trimmed.slice(5).trim();
        try {
          const payload = JSON.parse(payloadStr);
          if (payload.error) {
            onError(payload.error);
            return;
          }
          if (typeof payload.selectedModel === 'string' && payload.selectedModel) {
            onModel?.(payload.selectedModel);
          }
          if (typeof payload.routedVia === 'string' && payload.routedVia) {
            onRoutedVia?.(payload.routedVia);
          }
          if (payload.recalled && onRecall) {
            onRecall(payload.recalled);
          }
          if (payload.memorySaved && onMemorySaved) {
            onMemorySaved(payload.memorySaved);
          }
          if (payload.reasoning && onReasoning) {
            onReasoning(payload.reasoning);
          }
          if (payload.token) {
            onToken(payload.token);
          }
          if (payload.done && !doneCalled) {
            doneCalled = true;
            onDone();
            return;
          }
        } catch {
          /* ignore malformed chunk */
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      const payloadStr = buffer.trim().slice(5).trim();
      try {
        const payload = JSON.parse(payloadStr);
        if (payload.error) {
          onError(payload.error);
          return;
        }
        if (payload.recalled && onRecall) {
          onRecall(payload.recalled);
        }
        if (payload.memorySaved && onMemorySaved) {
          onMemorySaved(payload.memorySaved);
        }
        if (payload.reasoning && onReasoning) {
          onReasoning(payload.reasoning);
        }
        if (payload.token) {
          onToken(payload.token);
        }
      } catch {
        /* ignore */
      }
    }

    if (!doneCalled) {
      onDone();
    }
  } catch (err: any) {
    if (signal?.aborted) return;
    onError(err?.message || 'Stream connection failed.');
  }
}

// ─── Chat History (Vector DB) ────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
  summary: string;
}

/** Fetch all saved chat sessions ordered by most-recent first */
export async function listChatHistory(): Promise<ChatSession[]> {
  try {
    const res = await fetch('/api/chats');
    if (!res.ok) return [];
    const data = await res.json();
    return data?.chats ?? [];
  } catch {
    return [];
  }
}

/** Get a single chat session by ID */
export async function getChatSession(id: string): Promise<ChatSession | null> {
  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.chat ?? null;
  } catch {
    return null;
  }
}

/** Save (create or update) a chat session. Pass id to update an existing one. */
export async function saveChatSession(session: {
  id?: string;
  title?: string;
  messages: ChatMessage[];
}): Promise<ChatSession | null> {
  try {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.chat ?? null;
  } catch {
    return null;
  }
}

/** Delete all persisted chat sessions; memories and files are unaffected. */
export async function deleteAllChatHistory(): Promise<{ ok: boolean; deletedCount?: number; error?: string }> {
  try {
    const res = await fetch('/api/chats', { method: 'DELETE' });
    const data = await res.json();
    return { ok: res.ok && Boolean(data?.ok), deletedCount: data?.deletedCount, error: data?.error };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Could not delete chat history.' };
  }
}

/** Delete a chat session by ID */
export async function deleteChatSession(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Semantic vector search across all chats */
export async function searchChatHistory(query: string): Promise<ChatSession[]> {
  try {
    const res = await fetch(`/api/chats/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.chats ?? [];
  } catch {
    return [];
  }
}

// ─── Real-time Web Search & Site Reader ─────────────────────────────────────

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
  content?: string;
  preview?: string;
  siteName?: string;
  wordCount?: number;
  readSuccess?: boolean;
}

/** Execute a live web search query with deep site reading */
export async function fetchWebSearch(query: string, readSites = true): Promise<WebSearchResult[]> {
  try {
    const res = await fetch(`/api/web-search?q=${encodeURIComponent(query)}&read=${readSites}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.results ?? [];
  } catch {
    return [];
  }
}

/** Deeply fetch and read any target website URL directly */
export async function readSiteUrl(url: string): Promise<WebSearchResult | null> {
  try {
    const res = await fetch(`/api/read-site?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data ?? null;
  } catch {
    return null;
  }
}

// ─── Long-Term Memory & Knowledge Bank ──────────────────────────────────────

export interface MemoryItem {
  id: string;
  type: 'instruction' | 'code' | 'fact' | 'message';
  title: string;
  content: string;
  tags?: string[];
  source?: string;
  pinned?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContextRecallResult {
  ok: boolean;
  formattedContext: string;
  memoriesRecalled: MemoryItem[];
  chatExcerptsRecalled: Array<{
    chatId: string;
    chatTitle: string;
    date: string;
    userQuery: string;
    assistantExcerpt: string;
    codeSnippet?: string;
    score: number;
  }>;
}

/** List all memories with optional filters */
export async function listMemories(params?: {
  type?: string;
  pinnedOnly?: boolean;
  query?: string;
}): Promise<MemoryItem[]> {
  try {
    const url = new URL('/api/memories', window.location.origin);
    if (params?.type) url.searchParams.set('type', params.type);
    if (params?.pinnedOnly) url.searchParams.set('pinnedOnly', 'true');
    if (params?.query) url.searchParams.set('q', params.query);

    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return data?.memories ?? [];
  } catch {
    return [];
  }
}

/** Get a single memory by ID */
export async function getMemory(id: string): Promise<MemoryItem | null> {
  try {
    const res = await fetch(`/api/memories/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.memory ?? null;
  } catch {
    return null;
  }
}

/** Save (create or update) a memory item */
export async function saveMemory(memory: Partial<MemoryItem>): Promise<MemoryItem | null> {
  try {
    const res = await fetch('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(memory),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.memory ?? null;
  } catch {
    return null;
  }
}

/** Delete a memory by ID */
export async function deleteMemory(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Search memories with semantic & keyword matching */
export async function searchMemories(query: string, type?: string): Promise<MemoryItem[]> {
  try {
    const url = new URL('/api/memories/search', window.location.origin);
    url.searchParams.set('q', query);
    if (type) url.searchParams.set('type', type);

    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return data?.memories ?? [];
  } catch {
    return [];
  }
}

/** Recall memories & relevant past conversations for a user query */
export async function recallContext(
  query: string,
  chatId?: string | null
): Promise<ContextRecallResult | null> {
  try {
    const url = new URL('/api/context/recall', window.location.origin);
    url.searchParams.set('q', query);
    if (chatId) url.searchParams.set('chatId', chatId);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    return data ?? null;
  } catch {
    return null;
  }
}

/** Detect memory candidates from text */
export async function detectMemoriesInText(
  text: string
): Promise<Array<{ type: string; title: string; content: string; tags: string[] }>> {
  try {
    const res = await fetch('/api/memories/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.detected ?? [];
  } catch {
    return [];
  }
}

// ── Workspace & IDE Client Functions ──────────────────────────────────────────

export interface WorkspaceFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  ext: string;
}

export interface WorkspaceInfo {
  ok: boolean;
  workspaceRoot: string;
  cwd?: string;
  platform?: string;
  nodeVersion?: string;
  error?: string;
}

export interface TerminalExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd?: string;
  error?: string;
}

export async function getWorkspaceInfo(): Promise<WorkspaceInfo> {
  try {
    const res = await fetch('/api/ide/info');
    return await res.json();
  } catch (err: any) {
    return { ok: false, workspaceRoot: '', error: err.message };
  }
}

export async function setWorkspaceRoot(newPath: string): Promise<{ ok: boolean; workspaceRoot?: string; error?: string }> {
  try {
    const res = await fetch('/api/ide/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function listWorkspaceFiles(relPath = ''): Promise<{ ok: boolean; items: WorkspaceFileItem[]; currentPath: string; workspaceRoot: string; error?: string }> {
  try {
    const res = await fetch(`/api/ide/list?path=${encodeURIComponent(relPath)}`);
    return await res.json();
  } catch (err: any) {
    return { ok: false, items: [], currentPath: '', workspaceRoot: '', error: err.message };
  }
}

export async function readWorkspaceFile(filePath: string): Promise<{ ok: boolean; content: string; path: string; isImage?: boolean; dataUrl?: string; error?: string }> {
  try {
    const res = await fetch(`/api/ide/read?path=${encodeURIComponent(filePath)}`);
    return await res.json();
  } catch (err: any) {
    return { ok: false, content: '', path: filePath, error: err.message };
  }
}

export async function writeWorkspaceFile(filePath: string, content: string): Promise<{ ok: boolean; path: string; savedAt?: string; error?: string }> {
  try {
    const send = (confirmed = false) => fetch('/api/ide/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content, confirmed }),
    });
    let res = await send();
    let data = await res.json();
    if (res.status === 409 && data?.requiresConfirmation && typeof window !== 'undefined') {
      const approved = window.confirm(`Sora wants to overwrite an existing file that may contain settings or sensitive data:\n\n${filePath}\n\nOnly continue if you have reviewed the change and want to replace this file's contents.`);
      if (!approved) return { ...data, ok: false, path: filePath, error: 'Save cancelled by user. The original file was not changed.' };
      res = await send(true);
      data = await res.json();
    }
    return { ...data, ok: Boolean(data?.ok), path: data?.path || filePath };
  } catch (err: any) {
    return { ok: false, path: filePath, error: err.message };
  }
}

export async function createWorkspaceItem(filePath: string, isDir: boolean): Promise<{ ok: boolean; path: string; error?: string }> {
  try {
    const res = await fetch('/api/ide/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, isDir }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, path: filePath, error: err.message };
  }
}

export async function renameWorkspaceItem(oldPath: string, newPath: string): Promise<{ ok: boolean; oldPath: string; newPath: string; error?: string }> {
  try {
    const send = (confirmed = false) => fetch('/api/ide/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath, confirmed }),
    });
    let res = await send();
    let data = await res.json();
    if (res.status === 409 && data?.requiresConfirmation && typeof window !== 'undefined') {
      const approved = window.confirm(`Confirm file rename/move:\n\n${oldPath}\n→ ${newPath}\n\nRenaming configuration or JSON files can make app settings unavailable.`);
      if (!approved) return { ...data, ok: false, oldPath, newPath, error: 'Rename cancelled by user. The original file was not moved.' };
      res = await send(true);
      data = await res.json();
    }
    return { ...data, ok: Boolean(data?.ok), oldPath, newPath };
  } catch (err: any) {
    return { ok: false, oldPath, newPath, error: err.message };
  }
}

export async function deleteWorkspaceItem(filePath: string): Promise<{ ok: boolean; path: string; error?: string }> {
  try {
    const send = (confirmed = false) => fetch('/api/ide/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, confirmed }),
    });
    let res = await send();
    let data = await res.json();
    if (res.status === 409 && data?.requiresConfirmation && typeof window !== 'undefined') {
      const approved = window.confirm(`Confirm permanent deletion:\n\n${filePath}\n\nThis may delete JSON settings or configuration data. Continue only if you are certain.`);
      if (!approved) return { ...data, ok: false, path: filePath, error: 'Deletion cancelled by user. The file was not deleted.' };
      res = await send(true);
      data = await res.json();
    }
    return { ...data, ok: Boolean(data?.ok), path: data?.path || filePath };
  } catch (err: any) {
    return { ok: false, path: filePath, error: err.message };
  }
}

export async function executeTerminalCommand(command: string, cwd?: string): Promise<TerminalExecResult> {
  try {
    const res = await fetch('/api/ide/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, cwd }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, stdout: '', stderr: err.message, exitCode: 1 };
  }
}

export interface WorkspaceSearchMatch {
  path: string;
  type: 'filename' | 'content';
  line: number;
  text: string;
}

export async function searchWorkspaceFiles(query: string): Promise<{ ok: boolean; matches: WorkspaceSearchMatch[]; error?: string }> {
  try {
    const res = await fetch(`/api/ide/search?q=${encodeURIComponent(query)}`);
    return await res.json();
  } catch (err: any) {
    return { ok: false, matches: [], error: err.message };
  }
}



