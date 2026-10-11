import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIdeSession,
  readIdeSession,
  writeIdeSession,
  readCopilotSession,
  writeCopilotSession,
} from '../src/utils/ideSessionState.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

describe('IDE session recovery', () => {
  it('normalizes and restores open tabs, dirty buffers, layout, and terminal history', () => {
    const storage = createStorage();
    const session = {
      workspaceRoot: 'D:/workspace',
      currentPath: 'src',
      tabs: [{ path: 'src/App.tsx', name: 'App.tsx', content: 'unsaved edit', originalContent: 'old', isDirty: true, language: 'typescript' }],
      activeTabPath: 'src/App.tsx',
      activeActivityTab: 'copilot',
      sidebarOpen: false,
      copilotOpen: true,
      terminalOpen: true,
      cursorPos: { line: 17, col: 4 },
      wordWrap: true,
      minimapEnabled: false,
      terminalHistory: [{ id: '1', command: 'npm test', stdout: 'passed', stderr: '', code: 0, timestamp: '12:00:00' }],
    };
    assert.equal(writeIdeSession(session, storage), true);
    const restored = readIdeSession(storage);
    assert.equal(restored.workspaceRoot, 'D:/workspace');
    assert.equal(restored.tabs[0].content, 'unsaved edit');
    assert.equal(restored.tabs[0].isDirty, true);
    assert.equal(restored.activeTabPath, 'src/App.tsx');
    assert.equal(restored.copilotOpen, true);
    assert.equal(restored.cursorPos.line, 17);
    assert.equal(restored.terminalHistory[0].command, 'npm test');
  });

  it('rejects malformed session data and ignores invalid active tab paths', () => {
    const storage = createStorage({ sora_ide_session_v1: '{not-json' });
    assert.equal(readIdeSession(storage), null);
    const normalized = normalizeIdeSession({ tabs: [{ path: 'a.js', content: 'x' }], activeTabPath: 'missing.js' });
    assert.equal(normalized.activeTabPath, 'a.js');
    assert.equal(normalizeIdeSession(null), null);
  });

  it('does not throw when storage is unavailable or full', () => {
    const brokenStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
    assert.equal(readIdeSession(brokenStorage), null);
    assert.equal(writeIdeSession({ tabs: [] }, brokenStorage), false);
    assert.equal(writeCopilotSession('workspace', [], brokenStorage), false);
    assert.deepEqual(readCopilotSession('workspace', brokenStorage), []);
  });

  it('restores Copilot messages and marks interrupted tool calls as interrupted', () => {
    const storage = createStorage();
    const messages = [{
      id: 'assistant-1',
      role: 'assistant',
      content: 'Running tests',
      toolCalls: [{ id: 'tool-1', tool: 'run_command', args: { command: 'npm test' }, status: 'running' }],
    }];
    assert.equal(writeCopilotSession('D:/workspace', messages, storage), true);
    const restored = readCopilotSession('D:/workspace', storage);
    assert.equal(restored[0].content, 'Running tests');
    assert.equal(restored[0].toolCalls[0].status, 'error');
    assert.match(restored[0].toolCalls[0].error, /Interrupted by an app reload/);
  });

  it('keeps Copilot histories isolated by workspace', () => {
    const storage = createStorage();
    writeCopilotSession('workspace-a', [{ id: 'a', role: 'user', content: 'A' }], storage);
    writeCopilotSession('workspace-b', [{ id: 'b', role: 'user', content: 'B' }], storage);
    assert.equal(readCopilotSession('workspace-a', storage)[0].content, 'A');
    assert.equal(readCopilotSession('workspace-b', storage)[0].content, 'B');
  });
});
