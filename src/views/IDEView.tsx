import React, { useState, useEffect, useCallback } from 'react';
import {
  Files,
  Search,
  Sparkles,
  Terminal,
  FolderOpen,
  Save,
  Plus,
  X,
  FileCode,
  FileText,
  File,
  Check,
  AlertCircle,
  FilePlus,
  FolderPlus,
  Play,
} from 'lucide-react';
import {
  FileItem,
  OpenTab,
  CursorPosition,
  TerminalEntry,
  ActivityBarTab,
  getLanguageFromExt,
} from '../components/ide/types';
import { MonacoCodeEditor } from '../components/ide/MonacoCodeEditor';
import { WorkspaceExplorer } from '../components/ide/WorkspaceExplorer';
import { IntegratedTerminal } from '../components/ide/IntegratedTerminal';
import { SoraAICopilot } from '../components/ide/SoraAICopilot';
import { WorkspaceSwitcherModal } from '../components/ide/WorkspaceSwitcherModal';
import { SaveAsModal } from '../components/ide/SaveAsModal';
import { QuickOpenModal } from '../components/ide/QuickOpenModal';
import {
  getWorkspaceInfo,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  createWorkspaceItem,
  renameWorkspaceItem,
  deleteWorkspaceItem,
  executeTerminalCommand,
} from '../services/chatService';

interface IDEViewProps {
  onAskAssistant?: (prompt: string) => void;
}

export const IDEView: React.FC<IDEViewProps> = ({ onAskAssistant }) => {
  // ── Workspace & Files State ──────────────────────────────────────────────
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('');
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);

  // ── Editor Tabs State ────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string>('');

  // ── Layout & View State ──────────────────────────────────────────────────
  const [activeActivityTab, setActiveActivityTab] = useState<ActivityBarTab>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [copilotOpen, setCopilotOpen] = useState<boolean>(false);
  const [terminalOpen, setTerminalOpen] = useState<boolean>(true);

  // ── Editor Controls ──────────────────────────────────────────────────────
  const [cursorPos, setCursorPos] = useState<CursorPosition>({ line: 1, col: 1 });
  const [wordWrap, setWordWrap] = useState<boolean>(false);
  const [minimapEnabled, setMinimapEnabled] = useState<boolean>(true);

  // ── Terminal State ───────────────────────────────────────────────────────
  const [terminalHistory, setTerminalHistory] = useState<TerminalEntry[]>([]);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  // ── Modals State ─────────────────────────────────────────────────────────
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState<boolean>(false);
  const [saveAsModalOpen, setSaveAsModalOpen] = useState<boolean>(false);
  const [quickOpenModalOpen, setQuickOpenModalOpen] = useState<boolean>(false);
  const [newDialog, setNewDialog] = useState<{
    isOpen: boolean;
    isDir: boolean;
    name: string;
  }>({ isOpen: false, isDir: false, name: '' });
  const [renameDialog, setRenameDialog] = useState<{
    isOpen: boolean;
    item: FileItem | null;
    newName: string;
  }>({ isOpen: false, item: null, newName: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // ── Status Toast ─────────────────────────────────────────────────────────
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: 'success' | 'error';
  } | null>(null);

  const showStatus = (text: string, type: 'success' | 'error' = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 3500);
  };

  const activeTab = tabs.find((t) => t.path === activeTabPath);

  // ── Load Workspace Directory ─────────────────────────────────────────────
  const loadWorkspace = useCallback(async (dirPath: string = '') => {
    setIsLoadingFiles(true);
    try {
      const data = await listWorkspaceFiles(dirPath);
      if (data.ok) {
        setFiles(data.items || []);
        setCurrentPath(data.currentPath || '');
        if (data.workspaceRoot) {
          setWorkspaceRoot(data.workspaceRoot);
        }
      } else {
        showStatus(data.error || 'Failed to list directory', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || 'Error loading directory', 'error');
    } finally {
      setIsLoadingFiles(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // No deps: always uses the freshest dirPath argument

  // Initial load — run once on mount only
  useEffect(() => {
    getWorkspaceInfo().then((info) => {
      if (info.ok && info.workspaceRoot) {
        setWorkspaceRoot(info.workspaceRoot);
      }
    });
    loadWorkspace('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // loadWorkspace identity is stable (empty deps above)

  // ── File Operations ──────────────────────────────────────────────────────

  // Open file into tabs
  const handleOpenFile = async (item: FileItem) => {
    if (item.isDirectory) {
      loadWorkspace(item.path);
      return;
    }

    const existing = tabs.find((t) => t.path === item.path);
    if (existing) {
      setActiveTabPath(item.path);
      return;
    }

    try {
      const res = await readWorkspaceFile(item.path);
      if (res.ok) {
        const lang = getLanguageFromExt(item.ext);
        const newTab: OpenTab = {
          path: item.path,
          name: item.name,
          content: res.content,
          originalContent: res.content,
          isDirty: false,
          language: lang,
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabPath(item.path);
      } else {
        showStatus(res.error || 'Failed to read file', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || 'Error opening file', 'error');
    }
  };

  // Content change inside active tab
  const handleContentChange = (val: string) => {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.path === activeTab.path
          ? { ...t, content: val, isDirty: val !== t.originalContent }
          : t
      )
    );
  };

  // Save current active file
  const handleSaveCurrentFile = useCallback(async () => {
    if (!activeTab) return;
    try {
      const res = await writeWorkspaceFile(activeTab.path, activeTab.content);
      if (res.ok) {
        setTabs((prev) =>
          prev.map((t) =>
            t.path === activeTab.path
              ? { ...t, originalContent: t.content, isDirty: false }
              : t
          )
        );
        showStatus(`Saved ${activeTab.name}`, 'success');
      } else {
        showStatus(res.error || 'Save failed', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || 'Error saving file', 'error');
    }
  }, [activeTab]);

  // Save As
  const handleSaveAs = async (newPath: string) => {
    if (!activeTab) return;
    try {
      const res = await writeWorkspaceFile(newPath, activeTab.content);
      if (res.ok) {
        const ext = newPath.split('.').pop() || '';
        const name = newPath.split(/[/\\]/).pop() || newPath;
        const newTab: OpenTab = {
          path: newPath,
          name,
          content: activeTab.content,
          originalContent: activeTab.content,
          isDirty: false,
          language: getLanguageFromExt(ext),
        };
        // Deduplicate: only add if a tab with this path doesn't already exist
        setTabs((prev) => {
          const exists = prev.find((t) => t.path === newPath);
          if (exists) {
            return prev.map((t) =>
              t.path === newPath ? { ...t, content: activeTab.content, originalContent: activeTab.content, isDirty: false } : t
            );
          }
          return [...prev, newTab];
        });
        setActiveTabPath(newPath);
        loadWorkspace(currentPath);
        showStatus(`Saved as ${name}`, 'success');
      } else {
        throw new Error(res.error || 'Save As failed');
      }
    } catch (err: any) {
      showStatus(err.message || 'Error during Save As', 'error');
      throw err;
    }
  };

  // Close tab
  const handleCloseTab = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const updated = tabs.filter((t) => t.path !== path);
    setTabs(updated);
    if (activeTabPath === path) {
      if (updated.length > 0) {
        setActiveTabPath(updated[updated.length - 1].path);
      } else {
        setActiveTabPath('');
      }
    }
  };

  // Create new file or folder
  const handleCreateNew = async () => {
    if (!newDialog.name.trim()) return;
    const targetPath = currentPath
      ? `${currentPath}/${newDialog.name.trim()}`
      : newDialog.name.trim();

    try {
      const res = await createWorkspaceItem(targetPath, newDialog.isDir);
      if (res.ok) {
        showStatus(
          `Created ${newDialog.isDir ? 'directory' : 'file'}: ${newDialog.name}`,
          'success'
        );
        setNewDialog({ isOpen: false, isDir: false, name: '' });
        loadWorkspace(currentPath);
        if (!newDialog.isDir) {
          handleOpenFile({
            name: newDialog.name.trim(),
            path: targetPath,
            isDirectory: false,
            size: 0,
            ext: newDialog.name.split('.').pop() || '',
          });
        }
      } else {
        showStatus(res.error || 'Creation failed', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || 'Error creating item', 'error');
    }
  };

  // Rename file or folder
  const handleRename = async () => {
    if (!renameDialog.item || !renameDialog.newName.trim()) return;
    const oldPath = renameDialog.item.path;
    const parent = oldPath.split(/[/\\]/).slice(0, -1).join('/');
    const newPath = parent
      ? `${parent}/${renameDialog.newName.trim()}`
      : renameDialog.newName.trim();

    try {
      const res = await renameWorkspaceItem(oldPath, newPath);
      if (res.ok) {
        showStatus(`Renamed to ${renameDialog.newName.trim()}`, 'success');
        setRenameDialog({ isOpen: false, item: null, newName: '' });
        // Update open tabs if open
        setTabs((prev) =>
          prev.map((t) =>
            t.path === oldPath
              ? {
                  ...t,
                  path: newPath,
                  name: renameDialog.newName.trim(),
                  ext: renameDialog.newName.split('.').pop() || '',
                }
              : t
          )
        );
        if (activeTabPath === oldPath) {
          setActiveTabPath(newPath);
        }
        loadWorkspace(currentPath);
      } else {
        showStatus(res.error || 'Rename failed', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || 'Error renaming item', 'error');
    }
  };

  // Delete file or folder
  const handleDelete = async (targetPath: string) => {
    try {
      const res = await deleteWorkspaceItem(targetPath);
      if (res.ok) {
        showStatus(`Deleted: ${targetPath}`, 'success');
        setDeleteConfirm(null);
        handleCloseTab(targetPath);
        loadWorkspace(currentPath);
      } else {
        showStatus(res.error || 'Delete failed', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || 'Error deleting item', 'error');
    }
  };

  // Switch workspace directory
  const handleWorkspaceChanged = (newRoot: string) => {
    setWorkspaceRoot(newRoot);
    setCurrentPath('');
    setTabs([]);
    setActiveTabPath('');
    loadWorkspace('');
    showStatus(`Workspace switched to ${newRoot}`, 'success');
  };

  // ── Terminal Execution ───────────────────────────────────────────────────
  const handleRunTerminalCommand = async (cmd: string) => {
    if (!cmd.trim() || isExecuting) return;
    setIsExecuting(true);
    setTerminalOpen(true);

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

    try {
      const res = await executeTerminalCommand(cmd.trim(), currentPath || undefined);
      const newEntry: TerminalEntry = {
        id: `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        command: cmd.trim(),
        stdout: res.stdout || '',
        stderr: res.stderr || '',
        code: res.exitCode,
        cwd: res.cwd || workspaceRoot,
        timestamp: timeStr,
      };
      setTerminalHistory((prev) => [...prev, newEntry]);
      // If filesystem could be modified, refresh explorer
      loadWorkspace(currentPath);
    } catch (err: any) {
      const newEntry: TerminalEntry = {
        id: `term_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        command: cmd.trim(),
        stdout: '',
        stderr: err.message || 'Command failed',
        code: 1,
        cwd: workspaceRoot,
        timestamp: timeStr,
      };
      setTerminalHistory((prev) => [...prev, newEntry]);
    } finally {
      setIsExecuting(false);
    }
  };

  // ── Global Keyboard Shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveCurrentFile();
      }
      // Ctrl+Shift+S
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setSaveAsModalOpen(true);
      }
      // Ctrl+O
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setQuickOpenModalOpen(true);
      }
      // Ctrl+`
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setTerminalOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, handleSaveCurrentFile]);

  // Tab icon helper
  const getTabIcon = (tab: OpenTab) => {
    const lang = tab.language;
    if (['typescript', 'javascript'].includes(lang)) {
      return <FileCode className="w-3.5 h-3.5 text-[#3178C6] shrink-0" />;
    }
    if (['markdown', 'plaintext'].includes(lang)) {
      return <FileText className="w-3.5 h-3.5 text-[#00D99A] shrink-0" />;
    }
    return <File className="w-3.5 h-3.5 text-[#A1A1AA] shrink-0" />;
  };

  return (
    <div className="flex-1 w-full h-full overflow-hidden flex bg-[#1e1e1e] text-[#cccccc] select-none font-sans">
      {/* ── 1. VS Code Activity Bar (Far Left 48px) ───────────────────────── */}
      <div className="w-12 bg-[#333333] border-r border-[#252526] flex flex-col items-center py-2 justify-between shrink-0 z-40">
        {/* Top icons */}
        <div className="flex flex-col items-center gap-1 w-full">
          {/* Explorer */}
          <button
            onClick={() => {
              if (activeActivityTab === 'explorer' && sidebarOpen) {
                setSidebarOpen(false);
              } else {
                setActiveActivityTab('explorer');
                setSidebarOpen(true);
              }
            }}
            className={`w-full h-11 flex items-center justify-center relative transition-colors cursor-pointer ${
              activeActivityTab === 'explorer' && sidebarOpen
                ? 'text-white'
                : 'text-[#858585] hover:text-white'
            }`}
            title="Explorer (Ctrl+Shift+E)"
          >
            {activeActivityTab === 'explorer' && sidebarOpen && (
              <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-white" />
            )}
            <Files className="w-5 h-5" />
          </button>

          {/* Quick Open / Search */}
          <button
            onClick={() => setQuickOpenModalOpen(true)}
            className="w-full h-11 flex items-center justify-center text-[#858585] hover:text-white transition-colors cursor-pointer"
            title="Quick Open File (Ctrl+O)"
          >
            <Search className="w-5 h-5" />
          </button>

          {/* Sora AI Copilot Toggle */}
          <button
            onClick={() => setCopilotOpen(!copilotOpen)}
            className={`w-full h-11 flex items-center justify-center relative transition-colors cursor-pointer ${
              copilotOpen ? 'text-[#007acc]' : 'text-[#858585] hover:text-white'
            }`}
            title="Sora AI Copilot"
          >
            {copilotOpen && (
              <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#007acc]" />
            )}
            <Sparkles className="w-5 h-5" />
          </button>
        </div>

        {/* Bottom icons */}
        <div className="flex flex-col items-center gap-1 w-full">
          {/* Terminal Toggle */}
          <button
            onClick={() => setTerminalOpen(!terminalOpen)}
            className={`w-full h-10 flex items-center justify-center text-[#858585] hover:text-white transition-colors cursor-pointer ${
              terminalOpen ? 'text-white' : ''
            }`}
            title="Toggle Integrated Terminal (Ctrl+`)"
          >
            <Terminal className="w-4 h-4" />
          </button>

          {/* Switch Workspace */}
          <button
            onClick={() => setWorkspaceModalOpen(true)}
            className="w-full h-10 flex items-center justify-center text-[#858585] hover:text-white transition-colors cursor-pointer"
            title="Switch Workspace Folder"
          >
            <FolderOpen className="w-4 h-4 text-[#007acc]" />
          </button>
        </div>
      </div>

      {/* ── 2. Primary Sidebar (Explorer) ─────────────────────────────────── */}
      {sidebarOpen && (
        <WorkspaceExplorer
          workspaceRoot={workspaceRoot}
          currentPath={currentPath}
          files={files}
          isLoading={isLoadingFiles}
          openTabs={tabs}
          activeTabPath={activeTabPath}
          onOpenFile={handleOpenFile}
          onSelectTab={setActiveTabPath}
          onCloseTab={handleCloseTab}
          onRefresh={() => loadWorkspace(currentPath)}
          onNewFile={() => setNewDialog({ isOpen: true, isDir: false, name: '' })}
          onNewFolder={() => setNewDialog({ isOpen: true, isDir: true, name: '' })}
          onOpenFolder={() => setWorkspaceModalOpen(true)}
          onDelete={(path) => setDeleteConfirm(path)}
          onRename={(item) =>
            setRenameDialog({ isOpen: true, item, newName: item.name })
          }
          onNavigateUp={() => {
            const parts = currentPath.split('/');
            parts.pop();
            loadWorkspace(parts.join('/'));
          }}
        />
      )}

      {/* ── 3. Central Editor & Integrated Terminal ───────────────────────── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#1e1e1e]">
        {/* Editor Top Control Bar (Tabs + Global Actions) */}
        <div className="h-9 bg-[#252526] border-b border-[#1e1e1e] flex items-center justify-between shrink-0 select-none px-1">
          {/* Tabs List */}
          <div className="flex-1 flex items-center overflow-x-auto h-full scrollbar-none">
            {tabs.length === 0 ? (
              <div className="px-3 text-[11px] font-mono text-[#71717A]">
                No files open. Select a file from the explorer or create a new file.
              </div>
            ) : (
              tabs.map((tab) => {
                const isActive = tab.path === activeTabPath;
                return (
                  <div
                    key={tab.path}
                    onClick={() => setActiveTabPath(tab.path)}
                    className={`h-full flex items-center gap-2 px-3 border-r border-[#1e1e1e] cursor-pointer text-xs font-mono transition-colors group shrink-0 ${
                      isActive
                        ? 'bg-[#1e1e1e] text-white border-t-2 border-t-[#007acc] font-medium'
                        : 'bg-[#2d2d2d] text-[#969696] hover:bg-[#1e1e1e]/60 hover:text-[#cccccc]'
                    }`}
                  >
                    {getTabIcon(tab)}
                    <span className="truncate max-w-[140px]">{tab.name}</span>
                    {tab.isDirty && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#FF981F] shrink-0"
                        title="Unsaved changes"
                      />
                    )}
                    <button
                      onClick={(e) => handleCloseTab(tab.path, e)}
                      className="p-0.5 rounded hover:bg-[#454545] text-[#888888] hover:text-white transition-colors"
                      title="Close Tab"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}

            {/* Quick New File plus button in tab bar */}
            <button
              onClick={() => setNewDialog({ isOpen: true, isDir: false, name: '' })}
              className="p-1.5 hover:bg-[#333333] rounded text-[#858585] hover:text-white transition-colors ml-1 cursor-pointer"
              title="New File"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Editor Right Toolbar Actions */}
          <div className="flex items-center gap-1.5 px-2 shrink-0">
            {/* Status Toast in Toolbar */}
            {statusMessage && (
              <div
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono ${
                  statusMessage.type === 'success'
                    ? 'bg-[#00D99A]/15 text-[#00D99A] border border-[#00D99A]/30'
                    : 'bg-[#FF384C]/15 text-[#FF384C] border border-[#FF384C]/30'
                }`}
              >
                {statusMessage.type === 'success' ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <AlertCircle className="w-3 h-3" />
                )}
                <span>{statusMessage.text}</span>
              </div>
            )}

            {/* Open File Button */}
            <button
              onClick={() => setQuickOpenModalOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-[#333333] hover:bg-[#3d3d3d] text-[#cccccc] hover:text-white text-[11px] font-mono transition-colors cursor-pointer"
              title="Open File (Ctrl+O)"
            >
              <FileText className="w-3 h-3 text-[#00D99A]" />
              <span className="hidden sm:inline">Open File</span>
            </button>

            {/* Open Folder Button */}
            <button
              onClick={() => setWorkspaceModalOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-[#333333] hover:bg-[#3d3d3d] text-[#cccccc] hover:text-white text-[11px] font-mono transition-colors cursor-pointer"
              title="Open Folder / Switch Workspace"
            >
              <FolderOpen className="w-3 h-3 text-[#FF981F]" />
              <span className="hidden sm:inline">Open Folder</span>
            </button>

            {/* Save Button */}
            {activeTab && (
              <button
                onClick={handleSaveCurrentFile}
                disabled={!activeTab.isDirty}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-colors cursor-pointer ${
                  activeTab.isDirty
                    ? 'bg-[#007acc] hover:bg-[#0062a3] text-white shadow-sm'
                    : 'bg-[#2a2a2a] text-[#666666] cursor-not-allowed border border-[#333333]'
                }`}
                title="Save (Ctrl+S)"
              >
                <Save className="w-3 h-3" />
                <span>Save</span>
              </button>
            )}

            {/* Save As Button */}
            {activeTab && (
              <button
                onClick={() => setSaveAsModalOpen(true)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#333333] hover:bg-[#3d3d3d] text-[#cccccc] hover:text-white text-[11px] font-mono transition-colors cursor-pointer"
                title="Save As (Ctrl+Shift+S)"
              >
                <span>Save As</span>
              </button>
            )}

            {/* Run File in Terminal Button */}
            {activeTab && (
              <button
                onClick={() => {
                  const ext = activeTab.language;
                  if (ext === 'javascript') {
                    handleRunTerminalCommand(`node "${activeTab.path}"`);
                  } else if (ext === 'typescript') {
                    handleRunTerminalCommand(`npx tsx "${activeTab.path}"`);
                  } else if (ext === 'python') {
                    handleRunTerminalCommand(`python "${activeTab.path}"`);
                  } else {
                    handleRunTerminalCommand(`cat "${activeTab.path}"`);
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#333333] hover:bg-[#3d3d3d] text-[#00D99A] hover:text-white text-[11px] font-mono transition-colors cursor-pointer"
                title="Execute active file in terminal"
              >
                <Play className="w-3 h-3" />
                <span className="hidden md:inline">Run</span>
              </button>
            )}

            {/* Sora Copilot Toggle */}
            <button
              onClick={() => setCopilotOpen(!copilotOpen)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-mono transition-colors cursor-pointer border ${
                copilotOpen
                  ? 'bg-[#007acc] text-white border-[#007acc]'
                  : 'bg-[#252526] hover:bg-[#333333] text-[#cccccc] border-[#333333]'
              }`}
              title="Toggle Sora AI Copilot"
            >
              <Sparkles className="w-3 h-3 text-[#00D5FF]" />
              <span>Sora AI</span>
            </button>
          </div>
        </div>

        {/* Monaco Editor Canvas */}
        <div className="flex-1 flex overflow-hidden relative">
          <MonacoCodeEditor
            activeTab={activeTab}
            onContentChange={handleContentChange}
            onSave={handleSaveCurrentFile}
            onSaveAs={() => setSaveAsModalOpen(true)}
            onOpenFile={() => setQuickOpenModalOpen(true)}
            onOpenFolder={() => setWorkspaceModalOpen(true)}
            onNewFile={() => setNewDialog({ isOpen: true, isDir: false, name: '' })}
            onToggleTerminal={() => setTerminalOpen((prev) => !prev)}
            onAskCopilot={(snippet) => {
              setCopilotOpen(true);
              if (onAskAssistant && snippet) {
                // optionally pass snippet
              }
            }}
            cursorPos={cursorPos}
            setCursorPos={setCursorPos}
            wordWrap={wordWrap}
            setWordWrap={setWordWrap}
            minimapEnabled={minimapEnabled}
            setMinimapEnabled={setMinimapEnabled}
          />
        </div>

        {/* Integrated Terminal Panel */}
        {terminalOpen && (
          <IntegratedTerminal
            workspaceRoot={workspaceRoot}
            terminalHistory={terminalHistory}
            isExecuting={isExecuting}
            onRunCommand={handleRunTerminalCommand}
            onClear={() => setTerminalHistory([])}
            onClose={() => setTerminalOpen(false)}
          />
        )}
      </div>

      {/* ── 4. Sora AI Copilot Right Sidebar ──────────────────────────────── */}
      {copilotOpen && (
        <SoraAICopilot
          workspaceRoot={workspaceRoot}
          activeTab={activeTab}
          onOpenFile={(filePath) => {
            handleOpenFile({
              name: filePath.split(/[/\\]/).pop() || filePath,
              path: filePath,
              isDirectory: false,
              size: 0,
              ext: filePath.split('.').pop() || '',
            });
          }}
          onApplyCodeToEditor={(code) => handleContentChange(code)}
          onRunTerminalCommand={handleRunTerminalCommand}
          onRefreshExplorer={() => loadWorkspace(currentPath)}
          onClose={() => setCopilotOpen(false)}
        />
      )}

      {/* ── 5. Modals & Dialogs ───────────────────────────────────────────── */}

      {/* Workspace Switcher / Open Folder Modal */}
      <WorkspaceSwitcherModal
        currentWorkspace={workspaceRoot}
        isOpen={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        onWorkspaceChanged={handleWorkspaceChanged}
      />

      {/* Save As Modal */}
      <SaveAsModal
        currentPath={activeTab?.path || ''}
        isOpen={saveAsModalOpen}
        onClose={() => setSaveAsModalOpen(false)}
        onSaveAs={handleSaveAs}
      />

      {/* Quick Open Modal */}
      <QuickOpenModal
        files={files}
        isOpen={quickOpenModalOpen}
        onClose={() => setQuickOpenModalOpen(false)}
        onSelectFile={handleOpenFile}
      />

      {/* New File / Folder Modal */}
      {newDialog.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#1e1e1e] border border-[#333333] rounded-xl max-w-sm w-full p-5 text-[#cccccc] shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white uppercase font-mono">
              {newDialog.isDir ? (
                <FolderPlus className="w-4 h-4 text-[#FF981F]" />
              ) : (
                <FilePlus className="w-4 h-4 text-[#007acc]" />
              )}
              <span>{newDialog.isDir ? 'Create Folder' : 'Create File'}</span>
            </div>
            <input
              type="text"
              autoFocus
              value={newDialog.name}
              onChange={(e) =>
                setNewDialog((prev) => ({ ...prev, name: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateNew();
                if (e.key === 'Escape')
                  setNewDialog({ isOpen: false, isDir: false, name: '' });
              }}
              placeholder={
                newDialog.isDir ? 'e.g. components, utils' : 'e.g. index.ts, style.css'
              }
              className="w-full bg-[#141414] border border-[#333333] focus:border-[#007acc] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-[#555555] outline-none"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() =>
                  setNewDialog({ isOpen: false, isDir: false, name: '' })
                }
                className="px-3 py-1.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#aaaaaa] text-xs font-mono"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNew}
                disabled={!newDialog.name.trim()}
                className="px-4 py-1.5 rounded bg-[#007acc] hover:bg-[#0062a3] text-white text-xs font-mono font-semibold disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameDialog.isOpen && renameDialog.item && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#1e1e1e] border border-[#333333] rounded-xl max-w-sm w-full p-5 text-[#cccccc] shadow-2xl space-y-4">
            <h4 className="text-sm font-bold font-mono uppercase text-white">
              Rename {renameDialog.item.isDirectory ? 'Folder' : 'File'}
            </h4>
            <input
              type="text"
              autoFocus
              value={renameDialog.newName}
              onChange={(e) =>
                setRenameDialog((prev) => ({ ...prev, newName: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape')
                  setRenameDialog({ isOpen: false, item: null, newName: '' });
              }}
              className="w-full bg-[#141414] border border-[#333333] focus:border-[#007acc] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-[#555555] outline-none"
            />
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() =>
                  setRenameDialog({ isOpen: false, item: null, newName: '' })
                }
                className="px-3 py-1.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#aaaaaa] text-xs font-mono"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={!renameDialog.newName.trim()}
                className="px-4 py-1.5 rounded bg-[#007acc] hover:bg-[#0062a3] text-white text-xs font-mono font-semibold disabled:opacity-40"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#1e1e1e] border border-[#333333] rounded-xl max-w-sm w-full p-5 text-[#cccccc] shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold font-mono text-[#FF384C]">
              <AlertCircle className="w-4 h-4" />
              <span>Confirm Delete</span>
            </div>
            <p className="text-xs font-mono text-[#aaaaaa] leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="text-white">{deleteConfirm}</strong>? This action
              cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-3 py-1.5 rounded bg-[#252526] hover:bg-[#2d2d2d] text-[#aaaaaa] text-xs font-mono"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-1.5 rounded bg-[#FF384C] hover:bg-[#d62839] text-white text-xs font-mono font-semibold"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
