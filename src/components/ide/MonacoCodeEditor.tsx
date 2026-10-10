import React, { useRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import {
  Code2,
  FolderOpen,
  FilePlus,
  Terminal,
  Sparkles,
  AlignLeft,
  WrapText,
  Map,
  FileText,
} from 'lucide-react';
import { OpenTab, CursorPosition } from './types';

interface MonacoCodeEditorProps {
  activeTab?: OpenTab;
  onContentChange: (newContent: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onNewFile: () => void;
  onToggleTerminal: () => void;
  onAskCopilot: (snippet?: string) => void;
  cursorPos: CursorPosition;
  setCursorPos: (pos: CursorPosition) => void;
  wordWrap: boolean;
  setWordWrap: (val: boolean | ((prev: boolean) => boolean)) => void;
  minimapEnabled: boolean;
  setMinimapEnabled: (val: boolean | ((prev: boolean) => boolean)) => void;
}

export const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  activeTab,
  onContentChange,
  onSave,
  onSaveAs,
  onOpenFile,
  onOpenFolder,
  onNewFile,
  onToggleTerminal,
  onAskCopilot,
  cursorPos,
  setCursorPos,
  wordWrap,
  setWordWrap,
  minimapEnabled,
  setMinimapEnabled,
}) => {
  const editorRef = useRef<any>(null);

  // Setup Monaco mount handlers
  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Track cursor movements
    editor.onDidChangeCursorPosition((e: any) => {
      setCursorPos({
        line: e.position.lineNumber,
        col: e.position.column,
      });
    });

    // Bind Ctrl+S for saving
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
    });

    // Bind Ctrl+Shift+S for Save As
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
      () => {
        onSaveAs();
      }
    );

    // Focus editor
    editor.focus();
  };

  // Format code action
  const handleFormatCode = () => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument')?.run();
    }
  };

  // Ask Copilot about selected code snippet
  const handleAskSelectedCode = () => {
    if (editorRef.current) {
      const selection = editorRef.current.getSelection();
      const model = editorRef.current.getModel();
      const selectedText = model?.getValueInRange(selection);
      onAskCopilot(selectedText || activeTab?.content);
    } else {
      onAskCopilot(activeTab?.content);
    }
  };

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateOptions({
        wordWrap: wordWrap ? 'on' : 'off',
        minimap: { enabled: minimapEnabled },
      });
    }
  }, [wordWrap, minimapEnabled]);

  if (!activeTab) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#181818] text-[#cccccc] select-none p-6 text-center">
        <div className="max-w-md w-full bg-[#1e1e1e] border border-[#2d2d2d] rounded-xl p-8 shadow-2xl space-y-6">
          <div className="flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl bg-[#007acc]/10 border border-[#007acc]/30 flex items-center justify-center text-[#007acc] mb-3 shadow-lg shadow-[#007acc]/10">
              <Code2 className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-white tracking-wide">
              Sora AI Code Studio
            </h2>
            <p className="text-xs text-[#858585] mt-1 font-mono">
              Professional Monaco IDE with Sora Workspace Intelligence
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-left text-xs font-mono">
            <button
              onClick={onNewFile}
              className="flex items-center gap-2.5 p-3 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#333333] hover:border-[#007acc] text-[#e1e1e1] hover:text-white transition-all group cursor-pointer"
            >
              <FilePlus className="w-4 h-4 text-[#007acc] group-hover:scale-110 transition-transform" />
              <span>New File</span>
            </button>

            <button
              onClick={onOpenFile}
              className="flex items-center gap-2.5 p-3 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#333333] hover:border-[#007acc] text-[#e1e1e1] hover:text-white transition-all group cursor-pointer"
            >
              <FileText className="w-4 h-4 text-[#00D99A] group-hover:scale-110 transition-transform" />
              <span>Open File</span>
            </button>

            <button
              onClick={onOpenFolder}
              className="flex items-center gap-2.5 p-3 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#333333] hover:border-[#007acc] text-[#e1e1e1] hover:text-white transition-all group cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 text-[#FF981F] group-hover:scale-110 transition-transform" />
              <span>Open Folder</span>
            </button>

            <button
              onClick={onToggleTerminal}
              className="flex items-center gap-2.5 p-3 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] border border-[#333333] hover:border-[#007acc] text-[#e1e1e1] hover:text-white transition-all group cursor-pointer"
            >
              <Terminal className="w-4 h-4 text-[#B36CFF] group-hover:scale-110 transition-transform" />
              <span>Terminal</span>
            </button>
          </div>

          <div className="pt-3 border-t border-[#2a2a2a] flex items-center justify-between text-[11px] text-[#71717A] font-mono">
            <span>Ask Sora for help:</span>
            <button
              onClick={() => onAskCopilot()}
              className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#007acc]/15 hover:bg-[#007acc]/25 border border-[#007acc]/40 text-[#007acc] hover:text-white transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Launch Copilot</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-[#1e1e1e] relative">
      {/* Monaco Editor Container */}
      <div className="flex-1 w-full h-full overflow-hidden relative">
        <Editor
          height="100%"
          // Use a stable, extension-preserving model URI so Monaco parses TSX/JSX files
          // correctly and doesn't carry diagnostics between unrelated file tabs.
          path={activeTab.path.replace(/\\/g, '/')}
          language={activeTab.language}
          value={activeTab.content}
          theme="vs-dark"
          onChange={(val) => onContentChange(val ?? '')}
          onMount={handleEditorDidMount}
          options={{
            fontFamily:
              '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, "Courier New", monospace',
            fontSize: 13,
            lineHeight: 20,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
            tabSize: 2,
            insertSpaces: true,
            renderWhitespace: 'selection',
            wordWrap: wordWrap ? 'on' : 'off',
            minimap: { enabled: minimapEnabled },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
            guides: {
              bracketPairs: true,
              indentation: true,
            },
            padding: { top: 8, bottom: 8 },
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'on',
          }}
        />

        {/* Quick floating action pill in editor */}
        <div className="absolute top-2 right-4 z-10 flex items-center gap-1.5 bg-[#252526]/90 backdrop-blur-xs border border-[#333333] rounded-lg px-2 py-1 shadow-lg opacity-80 hover:opacity-100 transition-opacity">
          <button
            onClick={handleAskSelectedCode}
            className="flex items-center gap-1 text-[10px] font-mono text-[#007acc] hover:text-white hover:bg-[#007acc]/20 px-1.5 py-0.5 rounded transition-colors"
            title="Ask Sora AI about selected code"
          >
            <Sparkles className="w-3 h-3 text-[#007acc]" />
            <span>Ask Sora</span>
          </button>
          <span className="text-[#3c3c3c]">|</span>
          <button
            onClick={handleFormatCode}
            className="p-1 text-[#858585] hover:text-white rounded hover:bg-[#333333] transition-colors"
            title="Format Document"
          >
            <AlignLeft className="w-3 h-3" />
          </button>
          <button
            onClick={() => setWordWrap((prev) => !prev)}
            className={`p-1 rounded transition-colors ${
              wordWrap
                ? 'text-[#007acc] bg-[#007acc]/15'
                : 'text-[#858585] hover:text-white hover:bg-[#333333]'
            }`}
            title="Toggle Word Wrap"
          >
            <WrapText className="w-3 h-3" />
          </button>
          <button
            onClick={() => setMinimapEnabled((prev) => !prev)}
            className={`p-1 rounded transition-colors ${
              minimapEnabled
                ? 'text-[#007acc] bg-[#007acc]/15'
                : 'text-[#858585] hover:text-white hover:bg-[#333333]'
            }`}
            title="Toggle Minimap"
          >
            <Map className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Editor Status Bar Footer (VS Code style footer) */}
      <div className="h-6 bg-[#007acc] text-white px-3 flex items-center justify-between text-[11px] font-mono select-none shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold">{activeTab.name}</span>
            {activeTab.isDirty && (
              <span className="text-[10px] bg-white/20 px-1 rounded">● Unsaved</span>
            )}
          </div>
          <span className="opacity-75">
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span className="opacity-75 hidden sm:inline">Spaces: 2</span>
          <span className="opacity-75 hidden md:inline">UTF-8</span>
          <span className="opacity-75 hidden lg:inline">CRLF</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setWordWrap((prev) => !prev)}
            className="hover:underline cursor-pointer opacity-90 hover:opacity-100 hidden sm:inline"
            title="Toggle word wrap"
          >
            Wrap: {wordWrap ? 'On' : 'Off'}
          </button>
          <span className="font-semibold uppercase tracking-wider bg-black/20 px-1.5 py-0.2 rounded text-[10px]">
            {activeTab.language}
          </span>
        </div>
      </div>
    </div>
  );
};
