const IDE_SESSION_KEY = 'sora_ide_session_v1';
const COPILOT_SESSION_PREFIX = 'sora_ide_copilot_v1:';

function safeParse(value) {
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function normalizeIdeSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tabs = Array.isArray(value.tabs)
    ? value.tabs.filter((tab) => tab && typeof tab.path === 'string' && typeof tab.content === 'string')
      .slice(-30)
      .map((tab) => ({
        path: tab.path,
        name: typeof tab.name === 'string' ? tab.name : tab.path.split(/[\\/]/).pop() || tab.path,
        content: tab.content,
        originalContent: typeof tab.originalContent === 'string' ? tab.originalContent : tab.content,
        isDirty: Boolean(tab.isDirty),
        language: typeof tab.language === 'string' ? tab.language : 'plaintext',
      }))
    : [];
  const paths = new Set(tabs.map((tab) => tab.path));
  return {
    workspaceRoot: typeof value.workspaceRoot === 'string' ? value.workspaceRoot : '',
    currentPath: typeof value.currentPath === 'string' ? value.currentPath : '',
    tabs,
    activeTabPath: paths.has(value.activeTabPath) ? value.activeTabPath : (tabs.at(-1)?.path || ''),
    activeActivityTab: ['explorer', 'search', 'copilot', 'terminal'].includes(value.activeActivityTab) ? value.activeActivityTab : 'explorer',
    sidebarOpen: value.sidebarOpen !== false,
    copilotOpen: Boolean(value.copilotOpen),
    terminalOpen: value.terminalOpen !== false,
    cursorPos: {
      line: Math.max(1, Number(value.cursorPos?.line) || 1),
      col: Math.max(1, Number(value.cursorPos?.col) || 1),
    },
    wordWrap: Boolean(value.wordWrap),
    minimapEnabled: value.minimapEnabled !== false,
    terminalHistory: Array.isArray(value.terminalHistory)
      ? value.terminalHistory.filter((entry) => entry && typeof entry.command === 'string').slice(-40).map((entry) => ({
          ...entry,
          stdout: typeof entry.stdout === 'string' ? entry.stdout.slice(-12000) : '',
          stderr: typeof entry.stderr === 'string' ? entry.stderr.slice(-6000) : '',
        }))
      : [],
  };
}

export function readIdeSession(storage = globalThis.localStorage) {
  try {
    return normalizeIdeSession(safeParse(storage?.getItem(IDE_SESSION_KEY)));
  } catch {
    return null;
  }
}

export function writeIdeSession(session, storage = globalThis.localStorage) {
  try {
    const normalized = normalizeIdeSession(session);
    if (!normalized || !storage) return false;
    storage.setItem(IDE_SESSION_KEY, JSON.stringify({ ...normalized, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    // Storage can be unavailable or full; never crash the IDE because persistence failed.
    return false;
  }
}

export function readCopilotSession(workspaceRoot, storage = globalThis.localStorage) {
  try {
    const key = COPILOT_SESSION_PREFIX + String(workspaceRoot || 'default');
    const value = safeParse(storage?.getItem(key));
    if (!Array.isArray(value)) return [];
    return value.filter((message) => message && typeof message.id === 'string' && ['user', 'assistant', 'system'].includes(message.role))
      .slice(-80)
      .map((message) => ({
        ...message,
        content: typeof message.content === 'string' ? message.content : '',
        toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls.map((call) => call.status === 'running'
          ? { ...call, status: 'error', error: 'Interrupted by an app reload before completion.' }
          : call) : [],
      }));
  } catch {
    return [];
  }
}

export function writeCopilotSession(workspaceRoot, messages, storage = globalThis.localStorage) {
  try {
    const key = COPILOT_SESSION_PREFIX + String(workspaceRoot || 'default');
    const safeMessages = Array.isArray(messages) ? messages.slice(-80).map((message) => ({
      ...message,
      content: typeof message.content === 'string' ? message.content.slice(-30000) : '',
      toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls.slice(-30).map((call) => ({
        ...call,
        result: undefined,
      })) : [],
    })) : [];
    storage?.setItem(key, JSON.stringify(safeMessages));
    return Boolean(storage);
  } catch {
    return false;
  }
}
