import React, { useState, useRef, useEffect } from 'react';
import {
  Terminal,
  Play,
  RotateCcw,
  X,
  Maximize2,
  Minimize2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { TerminalEntry } from './types';

interface IntegratedTerminalProps {
  workspaceRoot: string;
  terminalHistory: TerminalEntry[];
  isExecuting: boolean;
  onRunCommand: (cmd: string) => Promise<void>;
  onClear: () => void;
  onClose: () => void;
}

export const IntegratedTerminal: React.FC<IntegratedTerminalProps> = ({
  workspaceRoot,
  terminalHistory,
  isExecuting,
  onRunCommand,
  onClear,
  onClose,
}) => {
  const [commandInput, setCommandInput] = useState<string>('');
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);
  const terminalBottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    terminalBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalHistory, isExecuting]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!commandInput.trim() || isExecuting) return;
    const cmd = commandInput.trim();
    setCommandInput('');
    setHistoryIndex(-1);
    await onRunCommand(cmd);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (terminalHistory.length === 0) return;
      const nextIdx =
        historyIndex === -1
          ? terminalHistory.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setCommandInput(terminalHistory[nextIdx].command);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIdx = historyIndex + 1;
      if (nextIdx >= terminalHistory.length) {
        setHistoryIndex(-1);
        setCommandInput('');
      } else {
        setHistoryIndex(nextIdx);
        setCommandInput(terminalHistory[nextIdx].command);
      }
    }
  };

  const quickPills = [
    { label: 'npm test', cmd: 'npm test' },
    { label: 'git status', cmd: 'git status' },
    { label: 'typecheck', cmd: 'npx tsc --noEmit' },
    { label: 'dir', cmd: 'dir' },
    { label: 'npm run build', cmd: 'npm run build' },
  ];

  return (
    <div
      className={`bg-[#181818] border-t border-[#2a2a2a] flex flex-col shrink-0 select-text font-mono transition-all duration-200 ${
        isMaximized ? 'h-[75vh]' : 'h-64'
      }`}
    >
      {/* Terminal Title Bar */}
      <div className="h-8 px-3 bg-[#1e1e1e] border-b border-[#2a2a2a] flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#cccccc]">
          <Terminal className="w-3.5 h-3.5 text-[#00D99A]" />
          <span>TERMINAL</span>
          <span className="text-[10px] text-[#71717A] px-1.5 py-0.2 rounded bg-[#252526] border border-[#333333]">
            PowerShell
          </span>
          <span className="text-[10px] text-[#888888] truncate max-w-xs hidden sm:inline">
            CWD: {workspaceRoot}
          </span>
        </div>

        {/* Quick action buttons & window controls */}
        <div className="flex items-center gap-2">
          {/* Quick pills */}
          <div className="hidden md:flex items-center gap-1 mr-2">
            {quickPills.map((pill) => (
              <button
                key={pill.label}
                onClick={() => onRunCommand(pill.cmd)}
                disabled={isExecuting}
                className="px-2 py-0.5 rounded text-[10px] bg-[#252526] hover:bg-[#333333] text-[#cccccc] hover:text-white border border-[#333333] transition-colors disabled:opacity-40 cursor-pointer"
              >
                {pill.label}
              </button>
            ))}
          </div>

          <button
            onClick={onClear}
            className="p-1 hover:bg-[#333333] rounded text-[#858585] hover:text-white transition-colors cursor-pointer"
            title="Clear Terminal Output"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1 hover:bg-[#333333] rounded text-[#858585] hover:text-white transition-colors cursor-pointer"
            title={isMaximized ? 'Restore Terminal' : 'Maximize Terminal'}
          >
            {isMaximized ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[#333333] rounded text-[#858585] hover:text-white transition-colors cursor-pointer"
            title="Close Terminal"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Output Log */}
      <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-3 bg-[#141414] text-[#d4d4d8]">
        {terminalHistory.length === 0 ? (
          <div className="text-[#666666] flex flex-col gap-1">
            <p>Windows PowerShell Integrated Terminal initialized.</p>
            <p className="text-[10px]">
              Type shell commands like `npm test`, `git status`, `dir`, or click quick actions above.
            </p>
          </div>
        ) : (
          terminalHistory.map((entry) => (
            <div key={entry.id} className="space-y-1">
              {/* Command Prompt Line */}
              <div className="flex items-center justify-between text-[#888888] text-[10px]">
                <div className="flex items-center gap-1.5 text-[#00D99A]">
                  <span className="text-[#3178C6] font-bold">PS</span>
                  <span className="text-[#666666]">{entry.cwd || workspaceRoot}&gt;</span>
                  <span className="text-white font-bold">{entry.command}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-[#666666]">
                    <Clock className="w-3 h-3" />
                    {entry.timestamp}
                  </span>
                  <span
                    className={`flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] ${
                      entry.code === 0
                        ? 'bg-[#00D99A]/15 text-[#00D99A] border border-[#00D99A]/30'
                        : 'bg-[#FF384C]/15 text-[#FF384C] border border-[#FF384C]/30'
                    }`}
                  >
                    {entry.code === 0 ? (
                      <CheckCircle2 className="w-2.5 h-2.5" />
                    ) : (
                      <AlertCircle className="w-2.5 h-2.5" />
                    )}
                    <span>Exit {entry.code}</span>
                  </span>
                </div>
              </div>

              {/* Stdout Output */}
              {entry.stdout && (
                <pre className="text-[#e4e4e7] whitespace-pre-wrap pl-3 leading-normal font-mono bg-[#181818]/60 p-2 rounded border border-[#222222]">
                  {entry.stdout}
                </pre>
              )}

              {/* Stderr Output */}
              {entry.stderr && (
                <pre className="text-[#FF7080] whitespace-pre-wrap pl-3 leading-normal font-mono bg-[#FF384C]/5 p-2 rounded border border-[#FF384C]/20">
                  {entry.stderr}
                </pre>
              )}
            </div>
          ))
        )}

        {isExecuting && (
          <div className="flex items-center gap-2 text-[#007acc] text-xs py-1">
            <span className="w-3 h-3 border-2 border-[#007acc] border-t-transparent rounded-full animate-spin" />
            <span>Executing command in workspace...</span>
          </div>
        )}

        <div ref={terminalBottomRef} />
      </div>

      {/* Terminal Input Form */}
      <form
        onSubmit={handleSubmit}
        className="h-9 px-3 bg-[#1e1e1e] border-t border-[#2a2a2a] flex items-center gap-2 shrink-0"
      >
        <span className="text-[#00D99A] font-bold text-xs select-none">
          PS {workspaceRoot.split(/[/\\]/).filter(Boolean).pop()}&gt;
        </span>
        <input
          ref={inputRef}
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isExecuting}
          placeholder={
            isExecuting
              ? 'Command running...'
              : 'Enter PowerShell command (e.g. npm test, git status)...'
          }
          className="flex-1 bg-transparent text-[#e4e4e7] text-xs font-mono placeholder-[#555555] focus:outline-none"
        />
        <button
          type="submit"
          disabled={isExecuting || !commandInput.trim()}
          className="px-2.5 py-1 rounded bg-[#007acc] hover:bg-[#0062a3] text-white text-[11px] font-mono flex items-center gap-1 transition-colors disabled:opacity-30 cursor-pointer"
        >
          <Play className="w-3 h-3" />
          <span>Run</span>
        </button>
      </form>
    </div>
  );
};
