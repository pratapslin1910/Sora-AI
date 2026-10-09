export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  ext: string;
}

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
}

export interface CursorPosition {
  line: number;
  col: number;
}

export interface TerminalEntry {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  code: number;
  cwd?: string;
  timestamp: string;
}

export type ActivityBarTab = 'explorer' | 'search' | 'copilot' | 'terminal';

export function getLanguageFromExt(ext: string): string {
  const cleanExt = ext.toLowerCase().replace(/^\./, '');
  switch (cleanExt) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'html':
    case 'htm':
    case 'svg':
      return 'html';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'py':
    case 'pyw':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'c':
    case 'h':
      return 'c';
    case 'cpp':
    case 'hpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'java':
      return 'java';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    case 'ps1':
    case 'psm1':
      return 'powershell';
    case 'sql':
      return 'sql';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'xml':
      return 'xml';
    case 'dockerfile':
      return 'dockerfile';
    default:
      return 'plaintext';
  }
}
