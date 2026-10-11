export interface PersistedIdeTab {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
}
export interface PersistedIdeSession {
  workspaceRoot: string;
  currentPath: string;
  tabs: PersistedIdeTab[];
  activeTabPath: string;
  activeActivityTab: 'explorer' | 'search' | 'copilot' | 'terminal';
  sidebarOpen: boolean;
  copilotOpen: boolean;
  terminalOpen: boolean;
  cursorPos: { line: number; col: number };
  wordWrap: boolean;
  minimapEnabled: boolean;
  terminalHistory: Array<Record<string, any>>;
}
export function normalizeIdeSession(value: unknown): PersistedIdeSession | null;
export function readIdeSession(storage?: Storage): PersistedIdeSession | null;
export function writeIdeSession(session: Partial<PersistedIdeSession>, storage?: Storage): boolean;
export function readCopilotSession(workspaceRoot: string, storage?: Storage): any[];
export function writeCopilotSession(workspaceRoot: string, messages: any[], storage?: Storage): boolean;
