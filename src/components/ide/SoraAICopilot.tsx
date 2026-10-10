import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  StopCircle,
  Folder,
  FileText,
  FileCode,
  Terminal,
  Search,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Bot,
  Zap,
  Image as ImageIcon,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChatMessage,
  streamChatMessage,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
  createWorkspaceItem,
  renameWorkspaceItem,
  deleteWorkspaceItem,
  searchWorkspaceFiles,
} from '../../services/chatService';
import { OpenTab } from './types';

export interface AgentToolCall {
  id: string;
  tool:
    | 'list_dir'
    | 'read_file'
    | 'write_file'
    | 'create_item'
    | 'rename_item'
    | 'delete_item'
    | 'run_command'
    | 'search_workspace';
  args: Record<string, any>;
  status: 'running' | 'done' | 'error';
  result?: any;
  error?: string;
  durationMs?: number;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: AgentToolCall[];
}

interface SoraAICopilotProps {
  workspaceRoot: string;
  activeTab?: OpenTab;
  onOpenFile?: (path: string) => void;
  onApplyCodeToEditor: (code: string) => void;
  onRunTerminalCommand: (command: string) => Promise<any>;
  onRefreshExplorer: () => void;
  onClose?: () => void;
}

export const SoraAICopilot: React.FC<SoraAICopilotProps> = ({
  workspaceRoot,
  activeTab,
  onOpenFile,
  onApplyCodeToEditor,
  onRunTerminalCommand,
  onRefreshExplorer,
}) => {
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `👋 **Sora AI Autonomous Agent initialized.**\n\nI operate directly on your workspace \`${workspaceRoot}\`. I can autonomously **inspect files, read code, write/create files, search, and execute terminal commands** step-by-step just like Antigravity.`,
    },
  ]);
  const [userInput, setUserInput] = useState<string>('');
  const [attachedImage, setAttachedImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState<boolean>(false);
  const [agentPhase, setAgentPhase] = useState<string>('Ready');
  const [expandedToolCalls, setExpandedToolCalls] = useState<Record<string, boolean>>({});

  const abortControllerRef = useRef<AbortController | null>(null);
  const isAgentActiveRef = useRef<boolean>(false);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAttachedImage({ name: file.name, dataUrl: reader.result as string });
    };
    reader.readAsDataURL(file);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            setAttachedImage({
              name: `screenshot_${Date.now()}.png`,
              dataUrl: reader.result as string,
            });
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          break;
        }
      }
    }
  };

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAgentRunning, agentPhase]);

  const toggleToolCallExpand = (id: string) => {
    setExpandedToolCalls((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // ── Real Tool Execution Engine ───────────────────────────────────────────
  const executeTool = async (
    tool: string,
    args: Record<string, any>
  ): Promise<{ ok: boolean; data?: any; error?: string }> => {
    const startTime = Date.now();
    try {
      if (tool === 'list_dir') {
        const path = args.path || '';
        const res = await listWorkspaceFiles(path);
        if (res.ok) {
          const summary = res.items.map((it) => ({
            name: it.name,
            type: it.isDirectory ? 'dir' : 'file',
            ext: it.ext,
            size: it.size,
          }));
          return {
            ok: true,
            data: {
              currentPath: res.currentPath || '/',
              itemCount: res.items.length,
              items: summary,
            },
          };
        }
        return { ok: false, error: res.error || 'Failed to list directory' };
      }

      if (tool === 'read_file') {
        const path = args.path;
        if (!path) return { ok: false, error: 'Path argument is required' };
        const res = await readWorkspaceFile(path);
        if (res.ok) {
          const content = res.content;
          const snippet =
            content.length > 6000
              ? content.slice(0, 6000) + `\n...[truncated ${content.length - 6000} chars]`
              : content;
          return {
            ok: true,
            data: { path, totalLines: content.split('\n').length, content: snippet },
          };
        }
        return { ok: false, error: res.error || `File not found: ${path}` };
      }

      if (tool === 'write_file') {
        const path = args.path;
        const content = args.content ?? '';
        if (!path) return { ok: false, error: 'Path argument is required' };
        const res = await writeWorkspaceFile(path, content);
        if (res.ok) {
          onRefreshExplorer();
          if (onOpenFile) {
            onOpenFile(path);
          }
          return {
            ok: true,
            data: {
              path,
              savedAt: res.savedAt,
              message: `File written successfully (${content.length} chars).`,
            },
          };
        }
        return { ok: false, error: res.error || `Failed to write file: ${path}` };
      }

      if (tool === 'create_item') {
        const path = args.path;
        const isDir = Boolean(args.isDir);
        if (!path) return { ok: false, error: 'Path argument is required' };
        const res = await createWorkspaceItem(path, isDir);
        if (res.ok) {
          onRefreshExplorer();
          return {
            ok: true,
            data: { path, isDir, message: `Created ${isDir ? 'directory' : 'file'}: ${path}` },
          };
        }
        return { ok: false, error: res.error || `Failed to create item: ${path}` };
      }

      if (tool === 'rename_item') {
        const oldPath = args.oldPath;
        const newPath = args.newPath;
        if (!oldPath || !newPath) return { ok: false, error: 'Both oldPath and newPath are required' };
        const res = await renameWorkspaceItem(oldPath, newPath);
        if (res.ok) {
          onRefreshExplorer();
          return {
            ok: true,
            data: { oldPath, newPath, message: `Renamed ${oldPath} to ${newPath}` },
          };
        }
        return { ok: false, error: res.error || `Failed to rename item: ${oldPath}` };
      }

      if (tool === 'delete_item') {
        const path = args.path;
        if (!path) return { ok: false, error: 'Path argument is required' };
        const res = await deleteWorkspaceItem(path);
        if (res.ok) {
          onRefreshExplorer();
          return {
            ok: true,
            data: { path, message: `Deleted ${path}` },
          };
        }
        return { ok: false, error: res.error || `Failed to delete item: ${path}` };
      }

      if (tool === 'run_command') {
        const command = args.command;
        if (!command) return { ok: false, error: 'Command argument is required' };
        // Single execution: onRunTerminalCommand runs in workspaceRoot and mirrors in terminal history
        const res = await onRunTerminalCommand(command);
        return {
          ok: (res?.exitCode ?? 0) === 0,
          data: {
            command,
            exitCode: res?.exitCode ?? 0,
            stdout: res?.stdout ? res.stdout.slice(0, 4000) : '',
            stderr: res?.stderr ? res.stderr.slice(0, 2000) : '',
            cwd: res?.cwd,
          },
        };
      }

      if (tool === 'search_workspace') {
        const query = args.query || '';
        if (!query) return { ok: false, error: 'Query argument is required' };
        const res = await searchWorkspaceFiles(query);
        return {
          ok: true,
          data: { query, matchCount: res.matches.length, matches: res.matches.slice(0, 15) },
        };
      }

      return { ok: false, error: `Unknown tool: ${tool}` };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Tool execution error' };
    } finally {
      const elapsed = Date.now() - startTime;
      console.debug(`[Agent Tool] ${tool} executed in ${elapsed}ms`);
    }
  };

  // ── Parse Tool Call from Agent Output ────────────────────────────────────
  const parseToolCallFromText = (
    text: string
  ): { tool: string; args: Record<string, any>; rawBlock: string } | null => {
    // 1. Look for <tool_call>...</tool_call>
    const matchTag = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
    if (matchTag) {
      try {
        const parsed = JSON.parse(matchTag[1].trim());
        if (parsed.tool) {
          return { tool: parsed.tool, args: parsed.args || {}, rawBlock: matchTag[0] };
        }
      } catch {}
    }

    // 2. Look for ```tool_call ... ```
    const matchCodeBlock = text.match(/```(?:tool_call|json)\s*\n([\s\S]*?)\n```/i);
    if (matchCodeBlock) {
      try {
        const parsed = JSON.parse(matchCodeBlock[1].trim());
        if (parsed.tool) {
          return { tool: parsed.tool, args: parsed.args || {}, rawBlock: matchCodeBlock[0] };
        }
      } catch {}
    }

    return null;
  };

  // ── Autonomous Multi-Step Agent Loop ─────────────────────────────────────
  const runAgentTask = useCallback(
    async (taskPrompt: string) => {
      if (!taskPrompt.trim() || isAgentRunning) return;

      setUserInput('');
      setIsAgentRunning(true);
      isAgentActiveRef.current = true;
      setAgentPhase('Analyzing goal & planning actions...');

      const currentImage = attachedImage;
      setAttachedImage(null);

      const userDisplayPrompt = currentImage
        ? `${taskPrompt || 'Analyze this attached image'}\n[Attached Image: ${currentImage.name}]`
        : taskPrompt;

      const userMsgId = `user_${Date.now()}`;
      const assistantMsgId = `asst_${Date.now()}`;

      // Append user message
      const updatedHistory: AgentMessage[] = [
        ...messages,
        { id: userMsgId, role: 'user', content: userDisplayPrompt },
        { id: assistantMsgId, role: 'assistant', content: '', toolCalls: [] },
      ];
      setMessages(updatedHistory);

      const systemPrompt: ChatMessage = {
        role: 'system',
        content: `You are Sora AI Autonomous Agent, embedded in the user's workspace on Windows.
Active Workspace Root: "${workspaceRoot}".
Active File: "${activeTab ? activeTab.path : 'None'}".

You have FULL WORKSPACE FREEDOM and TERMINAL FREEDOM:
- You can inspect, read, create, edit, rename, and delete files/folders across all subfolders.
- You can run terminal commands (npm test, npm install, build scripts, git commands, python, etc.) to debug and build autonomously.
- Retain safeguards against catastrophic system wipes.
- NEVER pretend, guess, or hallucinate files. Always use tools to verify real files!

AVAILABLE TOOLS:
1. list_dir: List files and folders.
   args: {"path": ""}
2. read_file: Read file content.
   args: {"path": "src/App.tsx"}
3. write_file: Create or update file content.
   args: {"path": "src/App.tsx", "content": "..."}
4. create_item: Create a new file or directory.
   args: {"path": "src/components/MyDir", "isDir": true}
5. rename_item: Rename or move a file/directory.
   args: {"oldPath": "old.ts", "newPath": "new.ts"}
6. delete_item: Delete a file or directory.
   args: {"path": "temp.txt"}
7. run_command: Run a shell command in the integrated PowerShell terminal.
   args: {"command": "npm test"}
8. search_workspace: Search file names or text.
   args: {"query": "search term"}

TOOL CALL PROTOCOL:
When you need to perform an action, output your reasoning followed by a single tool call formatted exactly like:
<tool_call>
{"tool": "<tool_name>", "args": { ... }}
</tool_call>

After you output a <tool_call>, STOP and wait for the system to execute it.
You will receive the tool result in a <tool_result> block.
When completely finished, provide your final answer with no further tool calls.`,
      };

      const userPayloadContent: ChatMessage['content'] = currentImage
        ? [
            { type: 'text', text: taskPrompt || 'Please inspect and analyze this image:' },
            { type: 'image_url', image_url: { url: currentImage.dataUrl } },
          ]
        : taskPrompt;

      // Internal agent conversation memory for multi-step execution
      const internalChat: ChatMessage[] = [
        systemPrompt,
        ...messages
          .filter((m) => m.id !== 'welcome')
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userPayloadContent },
      ];

      let stepCount = 0;
      const MAX_STEPS = 8;
      let finalAssistantText = '';

      while (stepCount < MAX_STEPS && isAgentActiveRef.current) {
        stepCount++;
        setAgentPhase(`Agent Step ${stepCount}: Reasoning...`);

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        let stepResponseText = '';

        // Stream next step from LLM
        await new Promise<void>((resolve) => {
          streamChatMessage(internalChat, {
            signal: abortController.signal,
            onToken: (token) => {
              stepResponseText += token;
              // Live update the current assistant message content in the UI
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === 'assistant') {
                  const cleanText = stepResponseText
                    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
                    .trim();
                  last.content = cleanText;
                }
                return copy;
              });
            },
            onDone: () => resolve(),
            onError: (err) => {
              stepResponseText += `\n\n⚠️ Error: ${err}`;
              resolve();
            },
          });
        });

        if (!isAgentActiveRef.current) break;

        // Check if the model emitted a tool call
        const toolCall = parseToolCallFromText(stepResponseText);

        if (toolCall) {
          const callId = `tc_${Date.now()}_${stepCount}`;
          const newToolCall: AgentToolCall = {
            id: callId,
            tool: toolCall.tool as any,
            args: toolCall.args,
            status: 'running',
          };

          setAgentPhase(`Executing tool: ${toolCall.tool}...`);

          // Append tool call card to UI message
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') {
              last.toolCalls = [...(last.toolCalls || []), newToolCall];
            }
            return copy;
          });

          // Execute tool on real filesystem / shell
          const toolStart = Date.now();
          const toolResult = await executeTool(toolCall.tool, toolCall.args);
          const toolDuration = Date.now() - toolStart;

          // Update tool call card status in UI
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.toolCalls) {
              const tc = last.toolCalls.find((t) => t.id === callId);
              if (tc) {
                tc.status = toolResult.ok ? 'done' : 'error';
                tc.result = toolResult.data;
                tc.error = toolResult.error;
                tc.durationMs = toolDuration;
              }
            }
            return copy;
          });

          // Feed tool result back to internal conversation
          internalChat.push({
            role: 'assistant',
            content: stepResponseText,
          });

          internalChat.push({
            role: 'user',
            content: `<tool_result>\n${JSON.stringify(
              toolResult.ok ? toolResult.data : { error: toolResult.error },
              null,
              2
            )}\n</tool_result>\n(Please inspect this result and proceed to the next action or give final answer.)`,
          });
        } else {
          // No more tool calls: task completed!
          finalAssistantText = stepResponseText;
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === 'assistant') {
              last.content = finalAssistantText;
            }
            return copy;
          });
          break;
        }
      }

      setAgentPhase('Ready');
      setIsAgentRunning(false);
      isAgentActiveRef.current = false;
      abortControllerRef.current = null;
    },
    [
      messages,
      isAgentRunning,
      workspaceRoot,
      activeTab,
      onOpenFile,
      onRefreshExplorer,
      onRunTerminalCommand,
    ]
  );

  const handleStopAgent = () => {
    isAgentActiveRef.current = false;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAgentRunning(false);
    setAgentPhase('Stopped');
  };

  const getToolIcon = (tool: string) => {
    switch (tool) {
      case 'list_dir':
        return <Folder className="w-3.5 h-3.5 text-[#E5A84B]" />;
      case 'read_file':
        return <FileText className="w-3.5 h-3.5 text-[#00D99A]" />;
      case 'write_file':
        return <FileCode className="w-3.5 h-3.5 text-[#007acc]" />;
      case 'run_command':
        return <Terminal className="w-3.5 h-3.5 text-[#B36CFF]" />;
      case 'search_workspace':
        return <Search className="w-3.5 h-3.5 text-[#00D5FF]" />;
      default:
        return <Zap className="w-3.5 h-3.5 text-[#E4E4E7]" />;
    }
  };

  const getToolTitle = (tc: AgentToolCall) => {
    switch (tc.tool) {
      case 'list_dir':
        return `List Directory: "${tc.args.path || '.'}"`;
      case 'read_file':
        return `Read File: "${tc.args.path}"`;
      case 'write_file':
        return `Write File: "${tc.args.path}"`;
      case 'run_command':
        return `Terminal: "${tc.args.command}"`;
      case 'search_workspace':
        return `Search: "${tc.args.query}"`;
      default:
        return tc.tool;
    }
  };

  return (
    <div className="w-96 bg-[#181818] border-l border-[#2d2d2d] flex flex-col h-full select-none text-[#cccccc] font-sans shrink-0 z-30">
      {/* ── Copilot Agent Header ─────────────────────────────────────────── */}
      <div className="h-10 px-3 border-b border-[#2d2d2d] flex items-center justify-between bg-[#202020] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[#007acc]/20 border border-[#007acc]/50 flex items-center justify-center text-[#007acc] shadow-sm">
            <Bot className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white tracking-wider">
                SORA AGENT
              </span>
              <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-mono bg-[#00D99A]/15 text-[#00D99A] border border-[#00D99A]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00D99A] animate-pulse" />
                AUTONOMOUS
              </span>
            </div>
          </div>
        </div>

        {/* Status or Stop Agent button */}
        {isAgentRunning && (
          <button
            onClick={handleStopAgent}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#FF384C]/20 hover:bg-[#FF384C]/40 border border-[#FF384C]/50 text-[#FF384C] text-[10px] font-mono transition-colors cursor-pointer"
            title="Stop autonomous agent"
          >
            <StopCircle className="w-3 h-3" />
            <span>Stop</span>
          </button>
        )}
      </div>

      {/* Agent Activity Bar Status Banner */}
      <div className="px-3 py-1 bg-[#141414] border-b border-[#252526] flex items-center justify-between text-[10px] font-mono text-[#858585]">
        <div className="flex items-center gap-1.5 truncate max-w-[240px]">
          <span className="text-[#71717A]">STATUS:</span>
          <span className={isAgentRunning ? 'text-[#007acc] font-semibold animate-pulse' : 'text-[#A1A1AA]'}>
            {agentPhase}
          </span>
        </div>
        <span className="text-[#555555]">Antigravity Loop</span>
      </div>

      {/* ── Messages & Agent Steps Stream ─────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5 select-text text-xs leading-relaxed custom-scrollbar bg-[#161616]">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
            >
              {/* Message Bubble */}
              <div
                className={`max-w-[96%] rounded-lg p-3 text-xs font-sans ${
                  isUser
                    ? 'bg-[#007acc] text-white shadow-sm'
                    : 'bg-[#212121] text-[#e1e1e1] border border-[#2f2f2f]'
                }`}
              >
                {/* Agent Tool Execution Cards */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-2 mb-3">
                    <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-[#888888] flex items-center gap-1">
                      <Zap className="w-3 h-3 text-[#007acc]" />
                      Autonomous Tool Calls ({msg.toolCalls.length})
                    </span>

                    {msg.toolCalls.map((tc) => {
                      const isExpanded = expandedToolCalls[tc.id] ?? false;
                      return (
                        <div
                          key={tc.id}
                          className="rounded-md bg-[#181818] border border-[#2f2f2f] overflow-hidden text-[11px] font-mono shadow-xs"
                        >
                          {/* Tool Header */}
                          <div
                            onClick={() => toggleToolCallExpand(tc.id)}
                            className="px-2.5 py-1.5 bg-[#1f1f1f] border-b border-[#2a2a2a] flex items-center justify-between cursor-pointer hover:bg-[#252526] transition-colors"
                          >
                            <div className="flex items-center gap-2 truncate">
                              {getToolIcon(tc.tool)}
                              <span className="text-white font-medium truncate">
                                {getToolTitle(tc)}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0 ml-2">
                              {tc.status === 'running' && (
                                <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] bg-[#007acc]/20 text-[#007acc]">
                                  <span className="w-2 h-2 border-2 border-[#007acc] border-t-transparent rounded-full animate-spin" />
                                  Running
                                </span>
                              )}
                              {tc.status === 'done' && (
                                <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] bg-[#00D99A]/15 text-[#00D99A]">
                                  <Check className="w-2.5 h-2.5" />
                                  {tc.durationMs ? `${tc.durationMs}ms` : 'Done'}
                                </span>
                              )}
                              {tc.status === 'error' && (
                                <span className="flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] bg-[#FF384C]/15 text-[#FF384C]">
                                  <AlertCircle className="w-2.5 h-2.5" />
                                  Failed
                                </span>
                              )}
                              {isExpanded ? (
                                <ChevronDown className="w-3 h-3 text-[#71717A]" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-[#71717A]" />
                              )}
                            </div>
                          </div>

                          {/* Expanded Tool Details */}
                          {isExpanded && (
                            <div className="p-2 space-y-1.5 bg-[#121212] border-t border-[#262626] text-[10px]">
                              {/* Args */}
                              <div>
                                <span className="text-[#71717A]">Arguments:</span>
                                <pre className="p-1.5 bg-[#181818] rounded text-[#cccccc] whitespace-pre-wrap mt-0.5">
                                  {JSON.stringify(tc.args, null, 2)}
                                </pre>
                              </div>

                              {/* Result */}
                              {tc.result && (
                                <div>
                                  <span className="text-[#00D99A]">Result Output:</span>
                                  <pre className="p-1.5 bg-[#181818] rounded text-[#00D5FF] whitespace-pre-wrap max-h-40 overflow-y-auto mt-0.5">
                                    {typeof tc.result === 'string'
                                      ? tc.result
                                      : JSON.stringify(tc.result, null, 2)}
                                  </pre>
                                </div>
                              )}

                              {/* Error */}
                              {tc.error && (
                                <div>
                                  <span className="text-[#FF384C]">Error:</span>
                                  <pre className="p-1.5 bg-[#FF384C]/10 text-[#FF7080] rounded whitespace-pre-wrap mt-0.5">
                                    {tc.error}
                                  </pre>
                                </div>
                              )}

                              {/* Quick Action for File Tools */}
                              {tc.tool === 'write_file' && onOpenFile && tc.args.path && (
                                <button
                                  onClick={() => onOpenFile(tc.args.path)}
                                  className="mt-1 flex items-center gap-1 text-[10px] text-[#007acc] hover:underline"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span>Open {tc.args.path} in Monaco</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Markdown text response */}
                {isUser ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                ) : (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      code: ({ className, children }: any) => {
                        const codeText = String(children).replace(/\n$/, '');
                        if (!className) {
                          return (
                            <code className="px-1 py-0.5 rounded bg-[#141414] text-[#00D5FF] font-mono text-[11px] border border-[#2d2d2d]">
                              {children}
                            </code>
                          );
                        }
                        return (
                          <div className="my-2 rounded bg-[#121212] border border-[#2a2a2a] p-2 overflow-x-auto text-[#00D5FF] font-mono text-[11px]">
                            <code>{codeText}</code>
                          </div>
                        );
                      },
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                )}
              </div>
            </div>
          );
        })}
        <div ref={chatBottomRef} />
      </div>

      {/* ── Preset Autonomous Agent Prompts ──────────────────────────────── */}
      <div className="p-2 border-t border-[#262626] bg-[#1a1a1a] flex flex-wrap gap-1">
        <button
          onClick={() =>
            runAgentTask(
              'Inspect and explain this workspace: list all files and directories, read the README or key config files, and summarize what this project is.'
            )
          }
          disabled={isAgentRunning}
          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-[#aaaaaa] hover:text-white text-[10px] font-mono transition-colors disabled:opacity-30 cursor-pointer flex items-center gap-1"
        >
          <Folder className="w-3 h-3 text-[#E5A84B]" />
          <span>Explore Workspace</span>
        </button>

        <button
          onClick={() =>
            runAgentTask(
              'Run the test suite in the terminal (npm test), analyze the results, and report if any tests failed.'
            )
          }
          disabled={isAgentRunning}
          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-[#aaaaaa] hover:text-white text-[10px] font-mono transition-colors disabled:opacity-30 cursor-pointer flex items-center gap-1"
        >
          <Terminal className="w-3 h-3 text-[#B36CFF]" />
          <span>Run Tests</span>
        </button>

        <button
          onClick={() =>
            runAgentTask(
              'Read package.json, list the installed dependencies, and explain the available npm scripts.'
            )
          }
          disabled={isAgentRunning}
          className="px-2 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-[#aaaaaa] hover:text-white text-[10px] font-mono transition-colors disabled:opacity-30 cursor-pointer flex items-center gap-1"
        >
          <FileCode className="w-3 h-3 text-[#007acc]" />
          <span>Check Dependencies</span>
        </button>
      </div>

      {/* ── Prompt Input Form ────────────────────────────────────────────── */}
      <div className="p-2.5 border-t border-[#2d2d2d] bg-[#202020] shrink-0">
        {/* Attached image preview */}
        {attachedImage && (
          <div className="mb-2 flex items-center gap-2 p-1.5 rounded-lg bg-[#141414] border border-[#333333] max-w-fit">
            <img
              src={attachedImage.dataUrl}
              alt="attachment"
              className="w-10 h-10 object-cover rounded"
            />
            <span className="text-[11px] font-mono text-[#cccccc] truncate max-w-[140px]">
              {attachedImage.name}
            </span>
            <button
              onClick={() => setAttachedImage(null)}
              className="p-1 text-[#888888] hover:text-[#FF384C] cursor-pointer"
              title="Remove image"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />

        <div className="relative flex items-center">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isAgentRunning}
            className="absolute left-2.5 bottom-2.5 p-1 rounded hover:bg-[#333333] text-[#71717A] hover:text-[#00D5FF] transition-colors cursor-pointer disabled:opacity-30"
            title="Attach image/screenshot for analysis"
          >
            <ImageIcon className="w-4 h-4" />
          </button>
          <textarea
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runAgentTask(userInput);
              }
            }}
            disabled={isAgentRunning}
            placeholder={
              isAgentRunning
                ? 'Agent is autonomously executing tasks...'
                : 'Give Sora Agent a task (or paste/attach an image)...'
            }
            rows={2}
            className="w-full bg-[#141414] border border-[#333333] focus:border-[#007acc] rounded-lg pl-9 pr-9 p-2 text-xs font-mono text-white placeholder-[#666666] outline-none resize-none leading-relaxed"
          />
          {isAgentRunning ? (
            <button
              onClick={handleStopAgent}
              className="absolute right-2 bottom-2.5 p-1 rounded-md bg-[#FF384C] text-white hover:bg-[#d62839] transition-colors cursor-pointer"
              title="Stop Agent"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => runAgentTask(userInput)}
              disabled={!userInput.trim() && !attachedImage}
              className="absolute right-2 bottom-2.5 p-1 rounded-md bg-[#007acc] text-white hover:bg-[#0062a3] transition-colors disabled:opacity-30 cursor-pointer"
              title="Run Agent Task"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
