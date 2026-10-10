import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Container,
  IconButton,
  Avatar,
  List,
  ListItemButton,
  ListItemText,
  Tooltip,
  CircularProgress,
  Dialog,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';
import AddIcon from '@mui/icons-material/Add';
import MicIcon from '@mui/icons-material/Mic';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SearchIcon from '@mui/icons-material/Search';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ChatBubbleOutlinedIcon from '@mui/icons-material/ChatBubbleOutlined';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import PsychologyIcon from '@mui/icons-material/Psychology';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PsychologyAltIcon from '@mui/icons-material/PsychologyAlt';
import BookmarkAddIcon from '@mui/icons-material/BookmarkAdd';
import BookmarkRemoveIcon from '@mui/icons-material/BookmarkRemove';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import CloseIcon from '@mui/icons-material/Close';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SettingsIcon from '@mui/icons-material/Settings';
import ExtensionIcon from '@mui/icons-material/Extension';
import { ExtensionsManagerView } from './components/settings/ExtensionsManagerView';
import { executeExtensionTool } from './services/extensionService';
import { parseToolCallFromText, stripToolCallsFromText, sanitizeContentForModel } from './utils/toolParser';
import {
  GatewayHealth,
  ChatSession,
  WebSearchResult,
  MemoryItem,
  RecalledContextPayload,
  checkGatewayHealth,
  streamChatMessage,
  listChatHistory,
  saveChatSession,
  deleteChatSession,
  deleteAllChatHistory,
  searchChatHistory,
  fetchWebSearch,
  readSiteUrl,
  listMemories,
  saveMemory,
  deleteMemory,
  getSettings,
  saveSettings,
  parseReasoningAndAnswer,
  prepareSpeechText,
} from './services/chatService';

export interface AttachedFileInfo {
  id: string;
  name: string;
  size: number;
  content: string;
  type: string;
  dataUrl?: string;
  isImage?: boolean;
}

interface MessageWithThinking {
  role: 'user' | 'assistant' | 'system';
  content: string | import('./services/chatService').MessageContentPart[];
  thinkingLog?: string[];
  thoughtDuration?: number;
  isThinkingOpen?: boolean;
  attachedFiles?: Array<{ name: string; size: number; dataUrl?: string; isImage?: boolean }>;
  webSources?: WebSearchResult[];
  isWebSourcesOpen?: boolean;
}

/** Format ISO timestamp to a readable relative/absolute label */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

/** Format file byte size into readable unit */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Rich Markdown renderer with enlarged, elegant typography & clear lists */
const MarkdownContent = ({ content }: { content: string }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="mb-3.5 last:mb-0 leading-[1.85] text-[16px] text-slate-100 font-normal">
            {children}
          </p>
        ),
        strong: ({ children }) => (
          <strong className="font-bold text-white tracking-wide">
            {children}
          </strong>
        ),
        em: ({ children }) => (
          <em className="italic text-slate-200">
            {children}
          </em>
        ),
        ul: ({ children }) => (
          <ul className="my-3.5 pl-6 list-disc space-y-2 text-[16px] text-slate-100 marker:text-blue-400 marker:font-bold">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-3.5 pl-6 list-decimal space-y-2 text-[16px] text-slate-100 marker:text-blue-400 marker:font-bold">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="leading-relaxed pl-1 text-[16px] text-slate-200">
            {children}
          </li>
        ),
        h1: ({ children }) => (
          <h1 className="text-2xl font-bold text-white mt-5 mb-2.5 tracking-tight">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-xl font-bold text-blue-200 mt-4 mb-2 tracking-tight">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-lg font-semibold text-cyan-200 mt-3 mb-1.5">
            {children}
          </h3>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-3 pl-4 border-l-2 border-blue-400/60 italic text-slate-300 bg-blue-500/[0.04] py-1.5 rounded-r-lg">
            {children}
          </blockquote>
        ),
        code: ({ className, children, ...props }: any) => {
          const isInline = !className && typeof children === 'string' && !children.includes('\n');
          if (isInline) {
            return (
              <code className="px-1.5 py-0.5 rounded bg-blue-950/40 text-cyan-300 font-mono text-[14px] border border-blue-500/20">
                {children}
              </code>
            );
          }
          return (
            <div className="my-3.5 rounded-xl bg-[#080b13] border border-white/[0.08] overflow-hidden text-[13.5px]">
              <pre className="p-4 overflow-x-auto font-mono text-cyan-200 leading-relaxed selection:bg-blue-500/30">
                <code {...props}>{children}</code>
              </pre>
            </div>
          );
        },
        hr: () => <hr className="my-4 border-white/[0.08]" />,
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto rounded-xl border border-white/[0.08]">
            <table className="w-full text-left text-sm border-collapse">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="p-2.5 bg-white/[0.04] border-b border-white/[0.08] font-semibold text-white">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="p-2.5 border-b border-white/[0.04] text-slate-300">
            {children}
          </td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
};


export interface SoraChatProps {
  initialPrompt?: string;
  onClearInitialPrompt?: () => void;
  settingsOpen?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
}

const SoraChat = ({ initialPrompt, onClearInitialPrompt, settingsOpen = false, onSettingsOpenChange = () => {} }: SoraChatProps = {}) => {
  const [messages, setMessages] = useState<MessageWithThinking[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt);
      onClearInitialPrompt?.();
    }
  }, [initialPrompt, onClearInitialPrompt]);

  const [isStreaming, setIsStreaming] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayHealth>({
    ok: false,
    status: 'checking',
    model: 'auto',
  });

  // Real-time Web Search toggle state
  const [webSearchEnabled, setWebSearchEnabled] = useState<boolean>(false);

  // ── Memory Bank state ────────────────────────────────────────────────────
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryInput, setMemoryInput] = useState('');
  const [memorySaveType, setMemorySaveType] = useState<MemoryItem['type']>('instruction');
  const [lastRecalled, setLastRecalled] = useState<RecalledContextPayload | null>(null);

  const loadMemories = useCallback(async () => {
    try {
      const list = await listMemories();
      setMemories(list);
    } catch {
      setMemories([]);
    }
  }, []);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  // Detail Site Preview state
  const [previewSite, setPreviewSite] = useState<WebSearchResult | null>(null);
  const [siteCopied, setSiteCopied] = useState<boolean>(false);

  // File Attachments state
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileInfo[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: AttachedFileInfo[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        let textContent = '';
        let dataUrl: string | undefined = undefined;
        const isImage = file.type.startsWith('image/');

        if (isImage) {
          textContent = `[Attached Image: ${file.name} (${formatFileSize(file.size)})]`;
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        } else {
          // Read up to 256KB text content
          textContent = await file.text();
          if (textContent.length > 250000) {
            textContent = textContent.slice(0, 250000) + '\n...[truncated large file content]';
          }
        }

        newAttachments.push({
          id: `file_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          size: file.size,
          content: textContent,
          type: file.type || 'text/plain',
          dataUrl,
          isImage,
        });
      } catch (err) {
        console.error('File read error:', err);
      }
    }

    setAttachedFiles((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleInputPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            setAttachedFiles((prev) => [
              ...prev,
              {
                id: `file_${Date.now()}_paste`,
                name: `screenshot_${Date.now()}.png`,
                size: file.size,
                content: `[Attached Image: screenshot_${Date.now()}.png (${formatFileSize(file.size)})]`,
                type: file.type || 'image/png',
                dataUrl,
                isImage: true,
              },
            ]);
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          break;
        }
      }
    }
  };

  const removeAttachedFile = (id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Active chat session ID (null = new/unsaved chat)
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const isSavingRef = useRef<boolean>(false);

  // Vector DB chat history
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pinned chats stored in localStorage
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('sora_pinned_chats');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const togglePinChat = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      try {
        localStorage.setItem('sora_pinned_chats', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const [isListening, setIsListening] = useState(false);
  // Use a ref so the value can be mutated inside the speech API useEffect without stale closures
  const speechSupportedRef = useRef<boolean>(
    typeof window !== 'undefined' &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
  );
  const speechRecognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);

  // Web Speech API TTS State
    const [speakingMessageIndex, setSpeakingMessageIndex] = useState<number | null>(null);


  // Live reasoning state — populated by actual actions, never fabricated
  const [thinkingTimer, setThinkingTimer] = useState(0);
  const thinkingIntervalRef = useRef<any>(null);
  const [currentThinkingPhase, setCurrentThinkingPhase] = useState<string>('Analyzing your request...');

  // Copied message state
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // ── Load chat history from vector DB ──────────────────────────────────────
  const loadHistory = useCallback(async (query?: string) => {
    setHistoryLoading(true);
    try {
      const chats = query?.trim()
        ? await searchChatHistory(query.trim())
        : await listChatHistory();
      setChatHistory(chats);
    } catch {
      setChatHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Debounced search handler
  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => loadHistory(q || undefined), 350);
  };

  // Delete a chat from the sidebar and DB
  const handleDeleteChat = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (activeChatIdRef.current === id || activeChatId === id) {
      activeChatIdRef.current = null;
      setActiveChatId(null);
      setMessages([]);
    }
    setPinnedIds((prev) => {
      const next = prev.filter((p) => p !== id);
      try {
        localStorage.setItem('sora_pinned_chats', JSON.stringify(next));
      } catch {}
      return next;
    });
    await deleteChatSession(id);
    await loadHistory(searchQuery || undefined);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentThinkingPhase]);

  const refreshHealth = async () => {
    try {
      const health = await checkGatewayHealth();
      if (health && typeof health === 'object') {
        setGatewayStatus(health);
      }
    } catch {
      setGatewayStatus({
        ok: false,
        status: 'error',
        error: 'Connection check failed',
        model: 'auto',
      });
    }
  };


  useEffect(() => {
    let isMounted = true;
    checkGatewayHealth()
      .then((health) => {
        if (isMounted && health) setGatewayStatus(health);
      })
      .catch(() => {});

    const interval = setInterval(() => {
      checkGatewayHealth()
        .then((health) => {
          if (isMounted && health) setGatewayStatus(health);
        })
        .catch(() => {});
    }, 20000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // ── AI Gateway Settings (Personalized endpoint & API Key) ────────────────
  const [settingsBaseUrl, setSettingsBaseUrl] = useState('');
  const [settingsApiKey, setSettingsApiKey] = useState('');
  const [settingsModel, setSettingsModel] = useState('');
  const [settingsApiKeySet, setSettingsApiKeySet] = useState(false);
  const [autoDeleteChats, setAutoDeleteChats] = useState(false);
  const [chatRetentionDays, setChatRetentionDays] = useState(30);
  const [permissionAllowance, setPermissionAllowance] = useState<'full_access' | 'sandbox' | 'strict'>('full_access');
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const [historyActionMsg, setHistoryActionMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaveMsg, setSettingsSaveMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [settingsTab, setSettingsTab] = useState<'general' | 'extensions'>('general');

  const loadSettingsData = useCallback(async () => {
    try {
      const s = await getSettings();
      setSettingsBaseUrl(s.baseUrl || '');
      setSettingsApiKey(s.apiKeyMasked || '');
      setSettingsApiKeySet(Boolean(s.apiKeySet));
      setSettingsModel(s.model || '');
      setAutoDeleteChats(Boolean(s.autoDeleteChats));
      setChatRetentionDays(Math.max(1, Number(s.chatRetentionDays) || 30));
      setPermissionAllowance(s.permissionAllowance || 'full_access');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (settingsOpen) {
      void loadSettingsData();
    }
  }, [settingsOpen, loadSettingsData]);

  const handleSaveSettings = async () => {
    setSettingsSaving(true);
    setSettingsSaveMsg(null);
    try {
      const ok = await saveSettings({
        baseUrl: settingsBaseUrl.trim(),
        apiKey: settingsApiKey.trim(),
        model: settingsModel.trim(),
        autoDeleteChats,
        chatRetentionDays,
        permissionAllowance,
      });
      if (ok) {
        setSettingsSaveMsg({ text: 'Settings saved successfully.' });
        await refreshHealth();
        await loadSettingsData();
        await loadHistory();
        setTimeout(() => {
          setSettingsSaveMsg(null);
        }, 3000);
      } else {
        setSettingsSaveMsg({ text: 'Failed to save settings.', error: true });
      }
    } catch (err: any) {
      setSettingsSaveMsg({ text: err?.message || 'Error saving settings.', error: true });
    } finally {
      setSettingsSaving(false);
    }
  };

  // ── Personalized KPI suggestion cards derived from user's chat history ──
  const personalizedCards = useMemo(() => {
    const FALLBACK = [
      { label: 'Get Started', text: 'What can you help me with?' },
      { label: 'Code Help', text: 'Help me write a clean function in Python or TypeScript' },
      { label: 'Explain', text: 'Explain how async/await works under the hood' },
      { label: 'System Design', text: 'How do I architect a scalable real-time application?' },
    ];
    if (!chatHistory || chatHistory.length === 0) return FALLBACK;

    const userQuestions: string[] = [];
    for (const session of chatHistory) {
      if (session.messages && Array.isArray(session.messages)) {
        for (const m of session.messages) {
          if (m.role === 'user') {
            const text = typeof m.content === 'string'
              ? m.content.trim()
              : Array.isArray(m.content)
                ? (m.content as any[]).filter((p) => p?.type === 'text').map((p) => p.text).join(' ').trim()
                : '';
            if (text && text.length >= 6 && text.length <= 150) {
              userQuestions.push(text);
            }
          }
        }
      } else if (session.title && session.title !== 'New Chat' && session.title.length >= 6) {
        userQuestions.push(session.title);
      }
    }

    if (userQuestions.length === 0) return FALLBACK;

    // Track frequency of normalized queries to prioritize repeated questions
    const counts: Record<string, { count: number; sample: string }> = {};
    for (const q of userQuestions) {
      const key = q.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 40).trim();
      if (!key) continue;
      if (!counts[key]) {
        counts[key] = { count: 1, sample: q };
      } else {
        counts[key].count += 1;
      }
    }

    const sorted = Object.values(counts).sort((a, b) => b.count - a.count);

    const result = sorted.slice(0, 4).map((item) => {
      const lower = item.sample.toLowerCase();
      let label = item.count > 1 ? 'Frequent' : 'Recent';
      if (/code|python|react|typescript|javascript|func|bug|error|test|api/i.test(lower)) {
        label = item.count > 1 ? 'Frequent Code' : 'Coding';
      } else if (/explain|how|why|what is|architecture|design/i.test(lower)) {
        label = item.count > 1 ? 'Frequent Topic' : 'Deep Dive';
      } else if (/data|analyze|summary|review|model/i.test(lower)) {
        label = 'Analysis';
      }
      return {
        label,
        text: item.sample,
      };
    });

    if (result.length < 4) {
      for (const fb of FALLBACK) {
        if (result.length >= 4) break;
        if (!result.some((r) => r.text === fb.text)) {
          result.push(fb);
        }
      }
    }

    return result.slice(0, 4);
  }, [chatHistory]);

  // Initialize Web Speech API for hands-free audio input
  useEffect(() => {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = true;
      recognition.interimResults = true;
      // Dynamic language matching: en-IN natively supports English & Roman Hinglish
      recognition.lang = 'en-IN';

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item.isFinal) {
            finalTranscript += item[0].transcript;
          }
        }
        if (finalTranscript.trim()) {
          setInput((prev) => {
            const separator = prev && !prev.endsWith(' ') ? ' ' : '';
            return prev + separator + finalTranscript.trim();
          });
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setIsListening(false);
          isListeningRef.current = false;
        }
      };

      recognition.onend = () => {
        // If still supposed to be listening, automatically restart (ambient dictation)
        if (isListeningRef.current) {
          try {
            recognition.start();
          } catch {
            // ignore
          }
        } else {
          setIsListening(false);
        }
      };

      speechRecognitionRef.current = recognition;
    } catch {
      // If the recognition object fails to instantiate, mark as unsupported
      speechSupportedRef.current = false;
    }

    return () => {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {}
      }
    };
  }, []);

  const toggleListening = () => {
    if (!speechSupportedRef.current || !speechRecognitionRef.current) {
      alert('Speech recognition is not supported in this browser. You can type directly into the input.');
      return;
    }

    if (isListening) {
      isListeningRef.current = false;
      setIsListening(false);
      try {
        speechRecognitionRef.current.stop();
      } catch {}
    } else {
      // User is starting to speak: interrupt any active TTS playback immediately
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setSpeakingMessageIndex(null);
      

      isListeningRef.current = true;
      setIsListening(true);
      try {
        speechRecognitionRef.current.start();
      } catch {
        isListeningRef.current = false;
        setIsListening(false);
      }
    }
  };

  const handleStop = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageIndex(null);
    

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (thinkingIntervalRef.current) {
      clearInterval(thinkingIntervalRef.current);
    }
    setIsStreaming(false);
  };

  const handleSend = async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && attachedFiles.length === 0) || isStreaming) return;

    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeakingMessageIndex(null);
    

    // Build the user message prompt content and metadata
    let promptContent = trimmedInput;
    if (attachedFiles.length > 0) {
      const attachmentsBlock = attachedFiles
        .map((f) => `[ATTACHED FILE: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');
      promptContent = trimmedInput
        ? `${trimmedInput}\n\n${attachmentsBlock}`
        : `Please inspect and analyze the attached file(s):\n\n${attachmentsBlock}`;
    }

    const currentAttachments = attachedFiles.map((f) => ({
      name: f.name,
      size: f.size,
      dataUrl: f.dataUrl,
      isImage: f.isImage,
    }));
    const imageFiles = attachedFiles.filter((f) => f.isImage && f.dataUrl);

    let userMessageContent: string | import('./services/chatService').MessageContentPart[] = promptContent;
    if (imageFiles.length > 0) {
      userMessageContent = [
        { type: 'text', text: promptContent || 'Please inspect and analyze this image:' },
        ...imageFiles.map((f) => ({
          type: 'image_url' as const,
          image_url: { url: f.dataUrl! },
        })),
      ];
    }

    const userMsg: MessageWithThinking = {
      role: 'user',
      content: userMessageContent,
      attachedFiles: currentAttachments.length ? currentAttachments : undefined,
    };
    const newHistory = [...messages, userMsg];

    // Clear input and attached files tray immediately
    setInput('');
    setAttachedFiles([]);
    setIsStreaming(true);
    setThinkingTimer(0);

    // Genuine AI introspective thoughts — first-person, based on what Sora actually understands
    const reasoningSteps: string[] = [];

    // Generate a genuine first-person AI thought about what the user wants
    const hasImages = imageFiles.length > 0;
    const hasAttachments = currentAttachments.length > 0 && !hasImages;
    const inputLower = trimmedInput.toLowerCase();
    const topic = trimmedInput.slice(0, 60) + (trimmedInput.length > 60 ? '…' : '');

    let primaryThought = '';

    if (hasImages) {
      primaryThought = imageFiles.length > 1
        ? `The user wants me to analyze ${imageFiles.length} images — I'll examine each carefully and describe what I see`
        : `The user wants me to look at this image and understand its content — I'll apply vision reasoning`;
    } else if (hasAttachments) {
      primaryThought = currentAttachments.length > 1
        ? `The user has shared ${currentAttachments.length} files — I need to read through them and respond based on their content`
        : `The user wants me to work with this file — I'll read it carefully before responding`;
    } else if (webSearchEnabled) {
      primaryThought = `The user wants me to search the web for current information about "${topic}" — I should find and synthesize the most relevant sources`;
    } else if (inputLower.includes('workspace') || inputLower.includes('project') || inputLower.includes('codebase') || inputLower.includes('directory') || inputLower.includes('folder')) {
      primaryThought = `The user wants me to analyse this workspace — I'll look at the project structure and files to give an informed answer`;
    } else if (inputLower.includes('fix') || inputLower.includes('debug') || inputLower.includes('error') || inputLower.includes('bug') || inputLower.includes('broken')) {
      primaryThought = `The user wants me to find and fix a problem — I'll think through what might be causing this and how to resolve it`;
    } else if (inputLower.includes('create') || inputLower.includes('build') || inputLower.includes('make') || inputLower.includes('generate')) {
      primaryThought = `The user wants me to create something — I'll think about the best approach and build it step by step`;
    } else if (inputLower.includes('write') || inputLower.includes('draft') || inputLower.includes('compose')) {
      primaryThought = `The user wants me to write something — I'll focus on clarity, tone, and making it genuinely useful`;
    } else if (inputLower.includes('explain') || inputLower.includes('what is') || inputLower.includes('how does') || inputLower.includes('what are') || inputLower.includes('why')) {
      primaryThought = `The user wants me to explain something — I'll break this down clearly without oversimplifying`;
    } else if (inputLower.includes('summarize') || inputLower.includes('summary') || inputLower.includes('tldr') || inputLower.includes('brief')) {
      primaryThought = `The user wants a concise summary — I'll extract the key points and present them clearly`;
    } else if (inputLower.includes('refactor') || inputLower.includes('improve') || inputLower.includes('optimize') || inputLower.includes('clean')) {
      primaryThought = `The user wants me to improve existing code or content — I'll review it carefully and suggest meaningful changes`;
    } else if (inputLower.includes('test') || inputLower.includes('check') || inputLower.includes('verify') || inputLower.includes('validate')) {
      primaryThought = `The user wants me to test or verify something — I'll think through what needs checking and how to approach it`;
    } else if (inputLower.includes('list') || inputLower.includes('show me') || inputLower.includes('give me') || inputLower.includes('what') ) {
      primaryThought = `The user wants information or a list — I'll put together a thorough, well-organised response`;
    } else if (inputLower.includes('help') || inputLower.includes('how to') || inputLower.includes('how do i') || inputLower.includes('how can')) {
      primaryThought = `The user needs my help with something — I'll think through the best way to guide them`;
    } else if (trimmedInput.endsWith('?')) {
      primaryThought = `The user is asking me a question — I'll think through the answer carefully before responding`;
    } else {
      primaryThought = `The user wants me to respond to this — I'm reading it carefully to understand exactly what they need`;
    }

    reasoningSteps.push(primaryThought);
    setCurrentThinkingPhase(primaryThought);

    // Live elapsed timer — only tracks time, no fake phase cycling
    const startTime = Date.now();
    thinkingIntervalRef.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 100) / 10;
      setThinkingTimer(elapsed);
    }, 100);

    // 1. Detect explicit URLs in user prompt (e.g., "read https://...", "summarize https://...")
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`]+)/gi;
    const explicitUrls = trimmedInput.match(urlRegex) || [];

    // Execute live web search or deep site reading
    let foundWebSources: WebSearchResult[] = [];

    // If explicit URLs are detected in user input, read them directly
    if (explicitUrls.length > 0) {
      try {
        const readDirect = await Promise.allSettled(
          explicitUrls.slice(0, 3).map((u) => readSiteUrl(u))
        );
        for (const res of readDirect) {
          if (res.status === 'fulfilled' && res.value) {
            foundWebSources.push(res.value);
          }
        }
      } catch (err) {
        console.warn('Direct site reading error:', err);
      }
    }

    // If web search is enabled, execute search with deep site reading
    if (webSearchEnabled && trimmedInput) {
      try {
        const searchResults = await fetchWebSearch(trimmedInput, true);
        for (const sr of searchResults) {
          if (!foundWebSources.some((existing) => existing.url === sr.url)) {
            foundWebSources.push(sr);
          }
        }
      } catch (err) {
        console.warn('Web search error:', err);
      }
    }

    const sitesReadCount = foundWebSources.filter((s) => s.readSuccess && s.content).length;
    const totalWordsRead = foundWebSources.reduce((acc, s) => acc + (s.wordCount || 0), 0);

    // Record web search outcome as genuine AI thought
    if (foundWebSources.length > 0) {
      reasoningSteps.push(
        sitesReadCount > 0
          ? `I found ${foundWebSources.length} relevant source${foundWebSources.length > 1 ? 's' : ''} — I've read through ${sitesReadCount > 1 ? `${sitesReadCount} of them` : 'it'} (${totalWordsRead.toLocaleString()} words) and I'll synthesize the key information`
          : `I found ${foundWebSources.length} source${foundWebSources.length > 1 ? 's' : ''} — I'll use these to inform my answer`
      );
    } else if (webSearchEnabled) {
      reasoningSteps.push(`I searched the web but didn't find strong sources — I'll rely on my own knowledge to answer`);
    }

    // Update live phase: Sora is now composing its answer
    setCurrentThinkingPhase(`I have what I need — composing my response now…`);

    const assistantPlaceholder: MessageWithThinking = {
      role: 'assistant',
      content: '',
      thinkingLog: [...reasoningSteps],
      thoughtDuration: 0,
      isThinkingOpen: true,
      webSources: foundWebSources.length ? foundWebSources : undefined,
      isWebSourcesOpen: true,
    };

    setMessages([...newHistory, assistantPlaceholder]);

    // Prepare messages to send to LLM with full site reading context
    const messagesToSend = newHistory.map((m) => ({ role: m.role, content: m.content }));
    if (foundWebSources.length > 0) {
      const sourcesContext = foundWebSources
        .map((s, idx) => {
          if (s.readSuccess && s.content) {
            return `[SOURCE ${idx + 1} - SITE READ SUCCESSFULLY]: ${s.title}\nURL: ${s.url}\nSite: ${s.siteName || ''}\nExtracted Word Count: ${s.wordCount || ''}\nACTUAL EXTRACTED PAGE CONTENT:\n${s.content}`;
          }
          return `[SOURCE ${idx + 1}]: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet || s.preview || ''}`;
        })
        .join('\n\n---\n\n');

      const lastIdx = messagesToSend.length - 1;
      const targetContent = messagesToSend[lastIdx].content;
      if (typeof targetContent === 'string') {
        messagesToSend[lastIdx] = {
          role: 'user',
          content: `${targetContent}\n\n[REAL-TIME LIVE WEB INTELLIGENCE & DEEP SITE CONTENT]:\n${sourcesContext}\n\n(Instruction: Synthesize the deeply read website facts and data above to give an accurate, detailed, and comprehensive answer, quoting specific details from the sources and citing source URLs.)`,
        };
      } else if (Array.isArray(targetContent)) {
        const textPart = targetContent.find((p) => p && p.type === 'text') as { type: 'text'; text: string } | undefined;
        if (textPart) {
          textPart.text = `${textPart.text}\n\n[REAL-TIME LIVE WEB INTELLIGENCE & DEEP SITE CONTENT]:\n${sourcesContext}\n\n(Instruction: Synthesize the deeply read website facts and data above to give an accurate, detailed, and comprehensive answer, quoting specific details from the sources and citing source URLs.)`;
        }
      }
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const finishChatTurn = (finalDuration: number) => {
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current);
      }
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = { ...updated[lastIdx], thoughtDuration: finalDuration };
        }
        // Auto-save the completed conversation to vector DB
        const cleanMessages = updated.map((m) => {
          let content = typeof m.content === 'string' ? m.content : (m.content ?? '');
          if (typeof content === 'string') {
            // Strip raw tool call syntax and [Called tool: ...] markers from saved history
            content = content.replace(/\[Called tool:[^\]]*\]/g, '').trim();
            content = stripToolCallsFromText(content);
          }
          return { role: m.role, content };
        });
        const currentId = activeChatIdRef.current;
        if (!isSavingRef.current) {
          isSavingRef.current = true;
          saveChatSession({ id: currentId ?? undefined, messages: cleanMessages })
            .then((saved) => {
              if (saved) {
                activeChatIdRef.current = saved.id;
                setActiveChatId(saved.id);
              }
              loadHistory();
            })
            .catch(() => {})
            .finally(() => {
              setTimeout(() => {
                isSavingRef.current = false;
              }, 600);
            });
        }
        return updated;
      });
      setIsStreaming(false);
      abortControllerRef.current = null;
    };

    let accumulatedContent = '';

    // Send history to backend
    await streamChatMessage(
      messagesToSend,
      {
        signal: abortController.signal,
        recallMemory: true,
        currentChatId: activeChatIdRef.current,
        onRecall: (recalled) => {
          setLastRecalled(recalled);
          const totalRecalled = (recalled?.memories?.length || 0) + (recalled?.excerpts?.length || 0);
          if (totalRecalled > 0) {
            // Genuinely surface what was recalled as an AI thought
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                const logs = updated[lastIdx].thinkingLog || [];
                const memCount = recalled?.memories?.length || 0;
                const excerptCount = recalled?.excerpts?.length || 0;
                let recallThought = '';
                if (memCount > 0 && excerptCount > 0) {
                  recallThought = `I remember things about this from our past conversations — I'll factor those in`;
                } else if (memCount > 0) {
                  recallThought = `I have ${memCount} saved memory${memCount > 1 ? ' entries' : ''} relevant to this — I'll use that context`;
                } else {
                  recallThought = `I found ${excerptCount} relevant excerpt${excerptCount > 1 ? 's' : ''} from past conversations — this helps me stay consistent`;
                }
                if (!logs.includes(recallThought)) {
                  updated[lastIdx] = { ...updated[lastIdx], thinkingLog: [...logs, recallThought] };
                }
              }
              return updated;
            });
          }
        },
        onMemorySaved: () => {
          // Silently refresh memory list when new memories are auto-saved
          loadMemories();
        },
        onReasoning: (reasoningChunk) => {
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              const logs = [...(updated[lastIdx].thinkingLog || [])];
              const lastLog = logs[logs.length - 1];
              if (lastLog && !lastLog.startsWith('✓') && !lastLog.startsWith('I remember') && !lastLog.startsWith('I found') && !lastLog.startsWith('The user')) {
                logs[logs.length - 1] = lastLog + reasoningChunk;
              } else {
                logs.push(reasoningChunk);
              }
              updated[lastIdx] = {
                ...updated[lastIdx],
                thinkingLog: logs,
              };
            }
            return updated;
          });
        },
        onToken: (token) => {
          accumulatedContent += token;
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              const prevContent = updated[lastIdx].content;
              const nextContent = (typeof prevContent === 'string' ? prevContent : '') + token;
              // Strip ALL raw tool_call syntax (closed/unclosed tags, code blocks, bare JSON)
              const cleanedContent = stripToolCallsFromText(nextContent);
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: cleanedContent !== '' ? cleanedContent : nextContent,
              };
            }
            return updated;
          });
        },
        onDone: async () => {
          const finalDuration = Math.round((Date.now() - startTime) / 100) / 10;

          // Strip any raw tool call text from the displayed bubble immediately
          const strippedDisplay = stripToolCallsFromText(accumulatedContent);
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              const cur = typeof updated[lastIdx].content === 'string' ? updated[lastIdx].content : '';
              const stripped = stripToolCallsFromText(cur);
              if (stripped !== cur) {
                updated[lastIdx] = { ...updated[lastIdx], content: stripped };
              }
            }
            return updated;
          });

          // Check for autonomous tool execution
          const toolCall = parseToolCallFromText(accumulatedContent);
          if (toolCall) {
            // Update thinking log with requested action
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                const logs = [...(updated[lastIdx].thinkingLog || [])];
                logs.push(`Invoking tool: ${toolCall.tool}...`);
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: '*Executing ' + toolCall.tool + '...*',
                  thinkingLog: logs,
                };
              }
              return updated;
            });

            // Execute the tool through extension service
            let toolRes: any;
            try {
              toolRes = await executeExtensionTool(toolCall.tool, toolCall.args);
            } catch (err: any) {
              toolRes = { ok: false, error: err?.message || 'Tool execution failed' };
            }

            // Update thinking log with tool result
            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                const logs = [...(updated[lastIdx].thinkingLog || [])];
                if (toolRes?.ok) {
                  logs.push(`✓ Executed ${toolCall.tool} successfully`);
                } else {
                  logs.push(`⚠️ ${toolCall.tool}: ${toolRes?.error || 'Failed'}`);
                }
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: '', // Clear so Sora's conversational confirmation streams in cleanly
                  thinkingLog: logs,
                };
              }
              return updated;
            });

            // Follow-up stream turn for Sora's conversational confirmation.
            // Sanitize ALL messages in the history so the model never sees raw tool call
            // text (including [Called tool: ...] markers from earlier turns) and is not
            // tempted to echo them back in its response.
            const sanitizedPriorMessages = messagesToSend.map((m) => {
              if (m.role === 'assistant') {
                const raw = typeof m.content === 'string' ? m.content : '';
                const cleaned = sanitizeContentForModel(raw);
                return { ...m, content: cleaned || '(Thinking…)' };
              }
              return m;
            });

            const followUpMessages = [
              ...sanitizedPriorMessages,
              {
                role: 'assistant',
                content: `I used the ${toolCall.tool} tool to carry out the action.`,
              },
              {
                role: 'user',
                content: `<tool_result>\n${JSON.stringify(
                  toolRes?.ok ? toolRes.data : { error: toolRes?.error },
                  null,
                  2
                )}\n</tool_result>\n\nIn one or two warm, natural sentences, tell the user what you just did in your Sora persona. Output only conversational text — no <tool_call> blocks, no [Called tool:] markers, no JSON, no markdown code fences.`,
              },
            ];

            // Accumulate follow-up stream separately so we can strip before display
            let followUpAccumulated = '';

            await streamChatMessage(
              followUpMessages as any,
              {
                signal: abortController.signal,
                recallMemory: false,
                currentChatId: activeChatIdRef.current,
                onToken: (tok) => {
                  followUpAccumulated += tok;
                  // Defer display update via a separate setMessages call
                  const displayText = sanitizeContentForModel(followUpAccumulated);
                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                      updated[lastIdx] = {
                        ...updated[lastIdx],
                        // Show displayText if stripping produced something; otherwise
                        // show nothing (prevents partial [Called tool: text flickering)
                        content: displayText,
                      };
                    }
                    return updated;
                  });
                },
                onDone: () => {
                  // Final clean pass on the complete follow-up response
                  const finalClean = sanitizeContentForModel(followUpAccumulated);
                  setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                      updated[lastIdx] = { ...updated[lastIdx], content: finalClean };
                    }
                    return updated;
                  });
                  finishChatTurn(finalDuration);
                },
                onError: () => finishChatTurn(finalDuration),
              }
            );
            return;
          }

          finishChatTurn(finalDuration);
        },
        onError: (errMsg) => {
          if (thinkingIntervalRef.current) {
            clearInterval(thinkingIntervalRef.current);
          }
          setMessages((prev) => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
              const currentContent = updated[lastIdx].content;
              updated[lastIdx] = {
                ...updated[lastIdx],
                content: currentContent
                  ? `${currentContent}\n\n⚠️ ${errMsg}`
                  : `⚠️ ${errMsg}`,
              };
            }
            return updated;
          });
          setIsStreaming(false);
          abortControllerRef.current = null;
          refreshHealth();
        },
      }
    );
  };

  const handleNewChat = () => {
    if (isStreaming) {
      handleStop();
    }
    activeChatIdRef.current = null;
    setActiveChatId(null);
    setMessages([]);
    setInput('');
  };

  const handleSelectHistoryChat = (chatItem: ChatSession) => {
    if (isStreaming) handleStop();
    activeChatIdRef.current = chatItem.id;
    setActiveChatId(chatItem.id);
    setMessages(chatItem.messages || []);
    setInput('');
  };

  const toggleThinkingLog = (index: number) => {
    setMessages((prev) => {
      const updated = [...prev];
      if (updated[index]) {
        updated[index] = {
          ...updated[index],
          isThinkingOpen: !updated[index].isThinkingOpen,
        };
      }
      return updated;
    });
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // ── Web Speech API TTS — Permanent Feminine Voice ────────────────────────
  /** Select the best available warm feminine Indian-English or Hindi voice. */
  const getFemaleVoice = (
    voices: SpeechSynthesisVoice[],
    langPref = 'auto',
    specificURI = ''
  ): SpeechSynthesisVoice | null => {
    if (specificURI) {
      const m = voices.find((v) => v.voiceURI === specificURI);
      if (m) return m;
    }
    const inFemaleRegex = /neerja|swara|heera|kalpana|ananya|priya|aditi|shruti|geeta|lekhika/i;
    const inVoices = voices.filter((v) => v.lang.startsWith('en-IN') || v.lang.startsWith('hi'));
    const inFemale = inVoices.find((v) => inFemaleRegex.test(v.name) || inFemaleRegex.test(v.voiceURI));
    if (inFemale) return inFemale;

    if (langPref === 'hi' || langPref === 'hinglish' || langPref === 'auto') {
      const inAnyFemale = inVoices.find((v) => /female|woman/i.test(v.name) || inFemaleRegex.test(v.name));
      if (inAnyFemale) return inAnyFemale;
    }

    const femaleNameRegex = /neerja|swara|jenny|aria|zira|samantha|victoria|karen|female|woman/i;
    const exactFemale = voices.find((v) => femaleNameRegex.test(v.name) || femaleNameRegex.test(v.voiceURI));
    if (exactFemale) return exactFemale;

    return voices[0] || null;
  };

  const speakMessage = (text: string, index?: number) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // Toggle off if already speaking this same message
    if (speakingMessageIndex !== null && speakingMessageIndex === index) {
      window.speechSynthesis.cancel();
      setSpeakingMessageIndex(null);
      
      return;
    }

    // Stop any current speech
    window.speechSynthesis.cancel();
    setSpeakingMessageIndex(null);
    

    // Clean text for natural speech (strips code fences, markdown symbols, formatting)
    const cleanSpeech = prepareSpeechText(text, { language: 'en' });
    if (!cleanSpeech) return;

    const voices = window.speechSynthesis.getVoices();
    const voice = getFemaleVoice(voices, 'auto');

    const utterance = new SpeechSynthesisUtterance(cleanSpeech);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-IN';
    utterance.rate = 1.05;   // slightly faster, natural
    utterance.pitch = 1.1;   // warm, feminine
    utterance.volume = 1.0;

    utterance.onstart = () => {
      if (index !== undefined) setSpeakingMessageIndex(index);
      
    };
    utterance.onend = () => {
      setSpeakingMessageIndex(null);
      
    };
    utterance.onerror = () => {
      setSpeakingMessageIndex(null);
      
    };

    window.speechSynthesis.speak(utterance);
  };


  // Format-aware helper to extract reasoning and clean user-facing content
  const parseThinkingContent = (content: any) => {
    const parsed = parseReasoningAndAnswer(content, { isStreaming });
    return {
      extractedThought: parsed.thought,
      cleanContent: parsed.answer,
    };
  };

  return (
    <div className="flex h-full w-full bg-[#080808] text-[#e4e4e7] overflow-hidden">
      {/* Sidebar with Obsidian Black & Charcoal styling */}
      <aside className="relative z-10 flex-shrink-0 w-64 bg-[#0a0a0a] border-r border-[#222222] flex flex-col h-full select-none">
        {/* Top: New Chat Button & Search */}
        <div className="p-3 pb-2 flex flex-col gap-2 shrink-0">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-[#383838] text-[#FFFFFF] transition-all shadow-sm group"
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-[#222222] flex items-center justify-center text-[#FFFFFF] group-hover:scale-105 transition-transform">
                <AddIcon sx={{ fontSize: 15 }} />
              </div>
              <span className="text-xs font-semibold text-[#FFFFFF]">
                New Chat
              </span>
            </div>
            <span className="text-[10px] text-[#71717A] font-mono">⌘N</span>
          </button>

          {/* Search bar */}
          <div className="relative">
            <SearchIcon
              sx={{ fontSize: 14, position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
              className="text-[#71717A]"
            />
            <input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search chats..."
              className="w-full bg-[#121212] border border-[#222222] focus:border-[#383838] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#E4E4E7] placeholder-[#71717A] outline-none transition-colors"
            />
          </div>
        </div>

        {/* Chat Navigation: Live Vector DB History (expands in middle) */}
        <div className="flex-1 overflow-y-auto px-2 min-h-0 space-y-1 custom-scrollbar">
          {!historyLoading && chatHistory.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ChatBubbleOutlinedIcon sx={{ fontSize: 24 }} className="text-[#52525B] mb-2" />
              <p className="text-[11px] text-[#71717A]">
                {searchQuery ? 'No matching chats found' : 'No saved chats yet'}
              </p>
              <p className="text-[10px] text-[#52525B] mt-1">Start a conversation to save it</p>
            </div>
          )}

          {/* Helper renderer for individual chat item */}
          {(() => {
            const renderChatItem = (chat: ChatSession, isPinned: boolean) => {
              const isActive = activeChatId === chat.id;
              return (
                <ListItemButton
                  key={chat.id}
                  onClick={() => handleSelectHistoryChat(chat)}
                  sx={{
                    px: 1.5,
                    py: 0.8,
                    borderRadius: '8px',
                    backgroundColor: isActive ? '#1c1c1c' : 'transparent',
                    border: isActive ? '1px solid #383838' : '1px solid transparent',
                    '&:hover': {
                      backgroundColor: isActive ? '#222222' : '#141414',
                      '& .item-actions': { opacity: 1 },
                    },
                    mb: 0.3,
                  }}
                  className="group transition-all duration-150"
                >
                  <ListItemText
                    primary={
                      <div className="flex items-center justify-between gap-1 w-full">
                        <div className="flex flex-col min-w-0 flex-1 mr-1">
                          <span
                            className={`text-xs font-medium truncate ${
                              isActive ? 'text-white font-semibold' : 'text-[#A1A1AA] group-hover:text-white'
                            }`}
                          >
                            {chat.title}
                          </span>
                          <span className="text-[10px] text-[#71717A] font-mono mt-0.5">
                            {formatDate(chat.updated_at)}
                          </span>
                        </div>

                        {/* Action buttons (Pin + Delete) */}
                        <div className="item-actions opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity flex-shrink-0">
                          <Tooltip title={isPinned ? 'Unpin chat' : 'Pin chat'} arrow placement="top">
                            <span
                              className="p-1 rounded hover:bg-white/[0.08] cursor-pointer inline-flex items-center justify-center transition-colors"
                              onClick={(e) => togglePinChat(e, chat.id)}
                            >
                              {isPinned ? (
                                <PushPinIcon sx={{ fontSize: 13, color: '#A1A1AA' }} />
                              ) : (
                                <PushPinOutlinedIcon sx={{ fontSize: 13, color: '#71717A', '&:hover': { color: '#FFFFFF' } }} />
                              )}
                            </span>
                          </Tooltip>

                          <Tooltip title="Delete chat" arrow placement="top">
                            <span
                              className="p-1 rounded hover:bg-rose-500/10 cursor-pointer inline-flex items-center justify-center transition-colors"
                              onClick={(e) => handleDeleteChat(e, chat.id)}
                            >
                              <DeleteOutlineIcon
                                sx={{ fontSize: 13, color: 'rgba(248,113,113,0.7)', '&:hover': { color: '#f87171' } }}
                              />
                            </span>
                          </Tooltip>
                        </div>
                      </div>
                    }
                    disableTypography
                  />
                </ListItemButton>
              );
            };

            // When user is searching via vector search
            if (searchQuery.trim()) {
              return (
                <div>
                  <div className="flex items-center gap-1.5 px-1 py-1 mb-1">
                    <SearchIcon sx={{ fontSize: 13 }} className="text-[#A1A1AA]" />
                    <span className="text-[10px] font-bold text-[#71717A] uppercase tracking-widest">
                      Matches ({chatHistory.length})
                    </span>
                    {historyLoading && <CircularProgress size={10} sx={{ color: '#A1A1AA', ml: 'auto' }} />}
                  </div>
                  <List component="nav" disablePadding>
                    {chatHistory.map((chat) => renderChatItem(chat, pinnedIds.includes(chat.id)))}
                  </List>
                </div>
              );
            }

            const pinnedList = chatHistory.filter((c) => pinnedIds.includes(c.id));
            const recentList = chatHistory.filter((c) => !pinnedIds.includes(c.id));

            return (
              <>
                {/* Pinned section if any pinned */}
                {pinnedList.length > 0 && (
                  <div className="mb-2">
                    <div className="flex items-center gap-1.5 px-1 py-1 mb-1">
                      <PushPinIcon sx={{ fontSize: 12 }} className="text-[#A1A1AA] rotate-45" />
                      <span className="text-[10px] font-bold text-[#71717A] uppercase tracking-widest">
                        Pinned
                      </span>
                    </div>
                    <List component="nav" disablePadding>
                      {pinnedList.map((chat) => renderChatItem(chat, true))}
                    </List>
                  </div>
                )}

                {/* Recent section */}
                {recentList.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-1 py-1 mb-1">
                      <ChatBubbleOutlinedIcon sx={{ fontSize: 12 }} className="text-[#52525B]" />
                      <span className="text-[10px] font-bold text-[#71717A] uppercase tracking-widest">
                        Recent
                      </span>
                      {historyLoading && <CircularProgress size={10} sx={{ color: '#A1A1AA', ml: 'auto' }} />}
                    </div>
                    <List component="nav" disablePadding>
                      {recentList.map((chat) => renderChatItem(chat, false))}
                    </List>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Settings shortcut */}
        <div className="p-2.5 border-t border-[#222222] bg-[#0c0c0c] shrink-0 space-y-2">
          <div>
            <button
              onClick={() => onSettingsOpenChange(true)}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#141414] hover:bg-[#1a1a1a] border border-[#27272a] hover:border-[#383838] transition-all group"
            >
              <SettingsIcon sx={{ fontSize: 15 }} className="text-[#A1A1AA] group-hover:text-white flex-shrink-0" />
              <span className="text-xs text-[#D4D4D8] font-medium group-hover:text-white">Settings</span>
            </button>
          </div>

          <div className="flex items-center justify-between px-1 text-[10px] font-mono-terminal text-[#71717A]">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${gatewayStatus.ok ? 'bg-[#00D99A]' : 'bg-[#FF981F]'}`} />
              <span className="truncate max-w-[130px]">{gatewayStatus.model || 'auto'}</span>
            </div>
            <span className={gatewayStatus.ok ? 'text-[#00D99A]' : 'text-[#FF981F]'}>
              {gatewayStatus.ok ? 'Online' : 'Standby'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Chat Interface */}
      <main className="relative z-10 flex-1 flex flex-col h-full bg-[#08090e]/95 backdrop-blur-xl overflow-hidden">
        {/* Messages Stream Container */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          <Container maxWidth="md" disableGutters>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[58vh] text-center px-4 animate-fade-in my-auto">
                {/* Ambient Neutral Center Icon */}
                <div className="relative mb-6 mt-8">
                  <div className="w-14 h-14 rounded-2xl bg-[#141414] border border-[#262626] shadow-lg flex items-center justify-center">
                    <SmartToyIcon sx={{ fontSize: 28 }} className="text-[#E4E4E7]" />
                  </div>
                </div>

                <h2 className="text-2xl font-bold text-white tracking-tight mb-2">
                  {chatHistory.length > 0 ? "What can I help you with today?" : "How can Sora assist you today?"}
                </h2>
                <p className="text-sm text-[#A1A1AA] max-w-md leading-relaxed mb-8">
                  {chatHistory.length > 0
                    ? "Pick up from your frequent topics or ask anything new across coding, reasoning, and research."
                    : "Ask anything — software engineering, system architecture, data analysis, or deep reasoning."}
                </p>

                {/* Quick prompt suggestion cards personalized to user interest */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg text-left">
                  {personalizedCards.map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setInput(item.text);
                      }}
                      className="p-3.5 rounded-xl bg-[#101010] hover:bg-[#181818] border border-[#222222] hover:border-[#383838] text-left transition-all group flex flex-col justify-between"
                    >
                      <span className="text-[10px] font-semibold text-[#A1A1AA] tracking-wider uppercase mb-1">
                        {item.label}
                      </span>
                      <span className="text-xs text-[#D4D4D8] group-hover:text-white line-clamp-2">
                        {item.text}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => {
                const isAssistant = msg.role === 'assistant';
                const { extractedThought, cleanContent } = isAssistant
                  ? parseThinkingContent(msg.content)
                  : {
                      extractedThought: null,
                      cleanContent: typeof msg.content === 'string'
                        ? msg.content
                        : Array.isArray(msg.content)
                        ? (msg.content as any[]).filter((p) => p?.type === 'text').map((p) => p.text || '').join('\n')
                        : '',
                    };

              const hasThinkingContent =
                isAssistant &&
                (msg.thinkingLog?.length || extractedThought || (isStreaming && i === messages.length - 1));

              return (
                <div
                  key={i}
                  className={`flex w-full mb-6 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
                >
                  <div
                    className={`flex items-start gap-3.5 ${
                      msg.role === 'user' ? 'flex-row-reverse max-w-[85%]' : 'w-full max-w-full'
                    }`}
                  >
                    {/* User / Assistant Avatar */}
                    <Avatar
                      sx={{
                        width: 38,
                        height: 38,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                        border: isAssistant ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                      }}
                      className={
                        isAssistant
                          ? 'bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-600'
                          : 'bg-gradient-to-br from-slate-700 to-slate-800'
                      }
                    >
                      {isAssistant ? (
                        <SmartToyIcon sx={{ fontSize: 20 }} className="text-white" />
                      ) : (
                        <PersonIcon sx={{ fontSize: 20 }} className="text-slate-300" />
                      )}
                    </Avatar>

                    {/* Bubble Column */}
                    <div className="flex flex-col gap-2 flex-1 min-w-0">
                      {/* Name / Timestamp Tag */}
                      <div
                        className={`flex items-center gap-2 px-1 text-[11px] font-medium text-slate-400 ${
                          msg.role === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <span className="font-semibold text-slate-300">
                          {isAssistant ? 'Sora' : 'You'}
                        </span>
                        {isAssistant && msg.thoughtDuration ? (
                          <span className="text-[10px] text-blue-400/80 font-mono">
                            • {msg.thoughtDuration}s thinking
                          </span>
                        ) : null}
                      </div>

                      {/* SORA THINKING LOG - PURE TEXT ONLY (No Box, No Border, Ultra-Elegant) */}
                      {hasThinkingContent ? (
                        <div className="w-full my-1 text-xs select-none">
                          <button
                            type="button"
                            onClick={() => toggleThinkingLog(i)}
                            className="inline-flex items-center gap-2 text-slate-400 hover:text-blue-300 transition-colors py-1 cursor-pointer bg-transparent border-0 p-0 text-left"
                          >
                            <PsychologyIcon sx={{ fontSize: 16 }} className="text-blue-400" />
                            <span className="font-medium text-slate-300 hover:text-blue-300 text-[13px]">
                              {isStreaming && i === messages.length - 1
                                ? `Reasoning (${thinkingTimer}s)…`
                                : `Reasoned for ${msg.thoughtDuration || 1}s`}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {msg.isThinkingOpen !== false ? '• hide details' : '• view details'}
                            </span>
                            {msg.isThinkingOpen !== false ? (
                              <ExpandLessIcon sx={{ fontSize: 15 }} className="text-slate-500" />
                            ) : (
                              <ExpandMoreIcon sx={{ fontSize: 15 }} className="text-slate-500" />
                            )}
                          </button>

                          {/* Expanded Plain Text Details (Text only, subtle left accent line) */}
                          {msg.isThinkingOpen !== false && (
                            <div className="mt-1.5 ml-1 pl-3 border-l-2 border-blue-500/20 space-y-1 text-slate-400 text-[12.5px]">
                              {msg.thinkingLog && msg.thinkingLog.length > 0 ? (
                                msg.thinkingLog.map((step, sIdx) => (
                                  <div key={sIdx} className="flex items-start gap-2 text-slate-300">
                                    <span className="text-emerald-400 font-bold select-none text-[11px]">✓</span>
                                    <span>{step}</span>
                                  </div>
                                ))
                              ) : null}

                              {/* Live current action step while streaming — reflects actual operation in progress */}
                              {isStreaming && i === messages.length - 1 && (
                                <div className="flex items-center gap-2 text-blue-400 animate-pulse pt-0.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                                  <span className="text-blue-300">{currentThinkingPhase}</span>
                                </div>
                              )}

                              {/* Model's internal <think> chain if emitted */}
                              {extractedThought && (
                                <div className="mt-2 text-slate-400/90 text-[12px] italic leading-relaxed whitespace-pre-wrap">
                                  {extractedThought}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : null}

                      {/* User Attached Files Badges (if any files were attached) */}
                      {msg.role === 'user' && msg.attachedFiles && msg.attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 justify-end mb-1">
                          {msg.attachedFiles.map((af, afIdx) => (
                            <div
                              key={afIdx}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-blue-900/40 border border-blue-400/30 text-xs text-blue-200 shadow-sm"
                            >
                              <InsertDriveFileOutlinedIcon sx={{ fontSize: 14, color: '#93c5fd' }} />
                              <span className="font-semibold">{af.name}</span>
                              <span className="text-[10px] text-blue-300/70 font-mono">({formatFileSize(af.size)})</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Assistant Collapsible Live Web Sources & Site Reader (Text-first, no bulky card) */}
                      {isAssistant && msg.webSources && msg.webSources.length > 0 && (
                        <div className="w-full my-2 text-xs select-none">
                          <button
                            type="button"
                            onClick={() => {
                              setMessages((prev) => {
                                const updated = [...prev];
                                if (updated[i]) {
                                  updated[i] = {
                                    ...updated[i],
                                    isWebSourcesOpen: updated[i].isWebSourcesOpen === false ? true : false,
                                  };
                                }
                                return updated;
                              });
                            }}
                            className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 transition-colors py-1 cursor-pointer bg-transparent border-0 p-0 text-left"
                          >
                            <TravelExploreIcon sx={{ fontSize: 16 }} className="text-cyan-400" />
                            <span className="font-semibold text-cyan-300 text-[12.5px]">
                              Live Web & Site Reader ({msg.webSources.length} sources
                              {msg.webSources.filter((s) => s.readSuccess).length > 0
                                ? ` • ${msg.webSources.filter((s) => s.readSuccess).length} fully read`
                                : ''})
                            </span>
                            <span className="text-[11px] text-cyan-500">
                              {msg.isWebSourcesOpen !== false ? '• hide' : '• view details'}
                            </span>
                            {msg.isWebSourcesOpen !== false ? (
                              <ExpandLessIcon sx={{ fontSize: 15 }} className="text-cyan-500" />
                            ) : (
                              <ExpandMoreIcon sx={{ fontSize: 15 }} className="text-cyan-500" />
                            )}
                          </button>

                          {msg.isWebSourcesOpen !== false && (
                            <div className="mt-2 ml-1 pl-3 border-l-2 border-cyan-500/25 space-y-2.5">
                              {msg.webSources.map((source, sIdx) => (
                                <div key={sIdx} className="space-y-1 text-left">
                                  {/* Title row + Badges */}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <a
                                      href={source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-cyan-200 hover:text-cyan-100 transition-colors group"
                                    >
                                      <OpenInNewIcon sx={{ fontSize: 12 }} className="text-cyan-400/70 group-hover:text-cyan-300 flex-shrink-0" />
                                      <span className="underline underline-offset-2">{source.title}</span>
                                    </a>

                                    {/* Domain badge */}
                                    {source.siteName && (
                                      <span className="px-1.5 py-0.5 rounded bg-white/[0.05] text-[10.5px] text-slate-400 font-mono">
                                        {source.siteName}
                                      </span>
                                    )}

                                    {/* Read Status badge */}
                                    {source.readSuccess ? (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300 font-medium">
                                        <CheckIcon sx={{ fontSize: 10 }} />
                                        <span>Read ({source.wordCount?.toLocaleString()} words)</span>
                                      </span>
                                    ) : null}

                                    {/* Detail Preview button */}
                                    <button
                                      type="button"
                                      onClick={() => setPreviewSite(source)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-950/60 hover:bg-cyan-900/80 border border-cyan-500/30 text-[11px] text-cyan-300 hover:text-cyan-100 transition-all cursor-pointer select-none ml-auto"
                                    >
                                      <MenuBookIcon sx={{ fontSize: 11 }} />
                                      <span>Detail Preview</span>
                                    </button>
                                  </div>

                                  {/* Detailed preview snippet */}
                                  <p className="text-[11.5px] text-slate-400 leading-relaxed line-clamp-2 pl-4">
                                    {source.preview || source.snippet}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Attached images preview inside user message bubble */}
                      {msg.role === 'user' && msg.attachedFiles && msg.attachedFiles.some((f) => f.dataUrl && f.isImage) && (
                        <div className="self-end flex flex-wrap gap-2 mb-1.5">
                          {msg.attachedFiles
                            .filter((f) => f.dataUrl && f.isImage)
                            .map((f, fIdx) => (
                              <img
                                key={fIdx}
                                src={f.dataUrl}
                                alt={f.name}
                                className="max-w-[280px] max-h-56 rounded-xl border border-white/20 object-cover shadow-lg"
                              />
                            ))}
                        </div>
                      )}

                      {/* Main Message Content */}
                      {(cleanContent || (isStreaming && i === messages.length - 1)) && (
                        msg.role === 'user' ? (
                          <div className="self-end px-4 py-2.5 rounded-2xl rounded-tr-sm bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white shadow-md shadow-blue-500/10 border border-blue-400/20 text-[15.5px] leading-relaxed whitespace-pre-wrap break-words max-w-full">
                            {cleanContent}
                          </div>
                        ) : (
                          <div className="w-full text-slate-100 break-words py-1">
                            {cleanContent ? (
                              <MarkdownContent content={cleanContent} />
                            ) : (
                              <div className="flex items-center gap-2 text-slate-400 py-1">
                                <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                                <span className="text-[14px]">Formulating response...</span>
                              </div>
                            )}
                          </div>
                        )
                      )}

                      {/* Assistant action bar (Copy, Female Voice Text-to-speech speaker) */}
                      {isAssistant && cleanContent && cleanContent.trim().length > 0 && (
                        <div className="flex items-center gap-2 px-1 text-slate-500">
                          <Tooltip title={copiedIndex === i ? 'Copied!' : 'Copy response'} arrow>
                            <IconButton
                              size="small"
                              onClick={() => copyToClipboard(cleanContent, i)}
                              sx={{
                                color: copiedIndex === i ? '#34d399' : 'rgba(255,255,255,0.4)',
                                '&:hover': { color: '#fff', backgroundColor: 'rgba(255,255,255,0.06)' },
                                padding: '3px',
                              }}
                            >
                              {copiedIndex === i ? (
                                <CheckIcon sx={{ fontSize: 15 }} />
                              ) : (
                                <ContentCopyIcon sx={{ fontSize: 15 }} />
                              )}
                            </IconButton>
                          </Tooltip>

                          <Tooltip title={speakingMessageIndex === i ? 'Stop voice playback' : 'Read response aloud'} arrow>
                            <IconButton
                              size="small"
                              onClick={() => speakMessage(cleanContent, i)}
                              sx={{
                                color: speakingMessageIndex === i ? '#38bdf8' : 'rgba(255,255,255,0.4)',
                                '&:hover': { color: speakingMessageIndex === i ? '#67e8f9' : '#60a5fa', backgroundColor: 'rgba(255,255,255,0.06)' },
                                padding: '3px',
                              }}
                            >
                              {speakingMessageIndex === i ? (
                                <VolumeOffIcon sx={{ fontSize: 16, color: '#38bdf8' }} />
                              ) : (
                                <VolumeUpIcon sx={{ fontSize: 16 }} />
                              )}
                            </IconButton>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </Container>
        </div>

        {/* Ambient Voice Active Banner (shows when voice dictation is on) */}
        {isListening && (
          <div className="px-6 py-1.5 bg-blue-950/40 border-t border-blue-500/20 flex items-center justify-between text-xs text-blue-300">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-1">
                <span className="w-1 h-3 bg-blue-400 rounded-full audio-bar-1" />
                <span className="w-1 h-4 bg-cyan-400 rounded-full audio-bar-2" />
                <span className="w-1 h-2.5 bg-indigo-400 rounded-full audio-bar-3" />
              </span>
              <span className="font-medium">
                Ambient Voice Dictation Active • Speak and type simultaneously (no need to stop recording)
              </span>
            </div>
            <button
              onClick={toggleListening}
              className="px-2 py-0.5 rounded text-[11px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-500/30 font-medium"
            >
              Mute Mic
            </button>
          </div>
        )}

        {/* Ultra-Premium Glass Floating Command Bar Input Area */}
        <div className="p-4 sm:p-6 bg-gradient-to-t from-[#06070a] via-[#07090e]/95 to-transparent border-t border-white/[0.04]">
          <Container maxWidth="md" disableGutters>
            {/* Attached files preview tray */}
            {attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2 px-1 animate-fade-in">
                {attachedFiles.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-950/50 border border-blue-500/30 text-xs text-blue-200 shadow-sm"
                  >
                    {f.isImage && f.dataUrl ? (
                      <img
                        src={f.dataUrl}
                        alt={f.name}
                        className="w-5 h-5 rounded object-cover border border-blue-400/40"
                      />
                    ) : (
                      <InsertDriveFileOutlinedIcon sx={{ fontSize: 15, color: '#60a5fa' }} />
                    )}
                    <span className="font-semibold truncate max-w-[180px]">{f.name}</span>
                    <span className="text-[10px] text-blue-300/60 font-mono">({formatFileSize(f.size)})</span>
                    <button
                      type="button"
                      onClick={() => removeAttachedFile(f.id)}
                      className="ml-1 p-0.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      <CloseIcon sx={{ fontSize: 13 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.csv,.json,.pdf,.log,.py,.mq4,.mq5,.js,.ts,.md,.png,.jpg,.jpeg"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div
              className={`relative flex items-center bg-[#101010] rounded-xl border transition-all duration-200 px-3 py-1.5 shadow-lg ${
                isListening
                  ? 'border-[#71717A] shadow-none'
                  : 'border-[#262626] focus-within:border-[#444444]'
              }`}
            >
              {/* Attachment Button */}
              <Tooltip title="Attach file or image (code, data, text, documents, images)" arrow>
                <IconButton
                  size="medium"
                  onClick={() => fileInputRef.current?.click()}
                  sx={{
                    color: attachedFiles.length > 0 ? '#FFFFFF' : '#71717A',
                    backgroundColor: attachedFiles.length > 0 ? '#222222' : 'transparent',
                    border: attachedFiles.length > 0 ? '1px solid #383838' : '1px solid transparent',
                    '&:hover': { color: '#FFFFFF', backgroundColor: '#1c1c1c' },
                  }}
                >
                  <AttachFileIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>

              {/* Live Web Search Toggle Button - Icon only */}
              <Tooltip
                title={
                  webSearchEnabled
                    ? 'Web Search is ON — Sora will fetch live real-time web results before answering'
                    : 'Web Search is OFF — Click to enable live web search & real-time information'
                }
                arrow
              >
                <button
                  type="button"
                  onClick={() => setWebSearchEnabled((prev) => !prev)}
                  aria-label="Toggle Live Web Search"
                  className={`flex items-center justify-center p-2 rounded-lg text-xs font-semibold transition-all duration-200 select-none ml-1 cursor-pointer ${
                    webSearchEnabled
                      ? 'bg-[#222222] text-[#FFFFFF] border border-[#444444]'
                      : 'bg-[#141414] text-[#71717A] hover:text-[#D4D4D8] hover:bg-[#1c1c1c] border border-[#222222]'
                  }`}
                >
                  <TravelExploreIcon
                    sx={{ fontSize: 17 }}
                    className={webSearchEnabled ? 'text-[#FFFFFF]' : 'text-[#71717A]'}
                  />
                  {webSearchEnabled && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#00D99A] live-blink ml-1.5" />
                  )}
                </button>
              </Tooltip>

              {/* Natural Input Field (User can type while speaking) */}
              <input
                className="flex-1 bg-transparent border-none outline-none text-white px-3 py-3 text-sm placeholder-slate-400 font-sans"
                onPaste={handleInputPaste}
                placeholder={
                  isListening
                    ? 'Listening... Speak or type your message freely...'
                    : 'Ask Sora anything, paste code, or type a request...'
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={isStreaming}
              />

              {/* Ambient Hands-Free Audio Input Button */}
              <Tooltip
                title={
                  isListening
                    ? 'Mic is active (listening continuously). Click to turn off.'
                    : 'Enable live voice dictation (hands-free, type & speak simultaneously)'
                }
                arrow
              >
                <IconButton
                  size="medium"
                  onClick={toggleListening}
                  sx={{
                    color: isListening ? '#38bdf8' : 'rgba(255, 255, 255, 0.45)',
                    backgroundColor: isListening ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                    border: isListening ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
                    '&:hover': {
                      color: '#38bdf8',
                      backgroundColor: 'rgba(56, 189, 248, 0.2)',
                    },
                    marginRight: '4px',
                  }}
                >
                  {isListening ? (
                    <GraphicEqIcon sx={{ fontSize: 19 }} className="animate-pulse" />
                  ) : (
                    <MicIcon sx={{ fontSize: 19 }} />
                  )}
                </IconButton>
              </Tooltip>

              {/* Send / Stop Button */}
              {isStreaming ? (
                <Tooltip title="Stop generating" arrow>
                  <IconButton
                    size="medium"
                    onClick={handleStop}
                    sx={{
                      color: '#f43f5e',
                      backgroundColor: 'rgba(244, 63, 94, 0.1)',
                      '&:hover': {
                        backgroundColor: 'rgba(244, 63, 94, 0.2)',
                      },
                    }}
                  >
                    <StopIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              ) : (
                <Tooltip title="Send message (Enter)" arrow>
                  <span>
                    <IconButton
                      size="medium"
                      onClick={handleSend}
                      disabled={!input.trim()}
                      sx={{
                        color: '#fff',
                        backgroundColor: input.trim() ? '#2563eb' : 'transparent',
                        '&:hover': {
                          backgroundColor: input.trim() ? '#1d4ed8' : 'transparent',
                        },
                        '&.Mui-disabled': {
                          color: 'rgba(255, 255, 255, 0.2)',
                        },
                        transition: 'all 0.2s',
                      }}
                    >
                      <SendIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </div>

            {/* Quick Helper Subtext */}
            <div className="flex items-center justify-between px-2 pt-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <AutoAwesomeIcon sx={{ fontSize: 12 }} className="text-blue-400" />
                <span>Powered by FreeLLMAPI Unified Gateway</span>
              </span>
              <span className="font-mono text-[10px]">Press Enter to send • Shift+Enter for newline</span>
            </div>
          </Container>
        </div>
      </main>

      {/* Detailed Site Reader Modal / Dialog */}
      <Dialog
        open={Boolean(previewSite)}
        onClose={() => setPreviewSite(null)}
        maxWidth="md"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              backgroundColor: '#0a0d18',
              backgroundImage: 'radial-gradient(circle at top right, rgba(56, 189, 248, 0.08), transparent 70%)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '16px',
              color: '#f1f5f9',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
            },
          },
        }}
      >
        {previewSite && (
          <>
            <div className="flex items-center justify-between p-4 border-b border-white/[0.08] bg-white/[0.02]">
              <div className="flex items-center gap-2.5 min-w-0 pr-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                  <MenuBookIcon sx={{ fontSize: 18, color: '#38bdf8' }} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-cyan-400 uppercase tracking-wider">
                      {previewSite.siteName || 'Website Reader'}
                    </span>
                    {previewSite.readSuccess ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10.5px] font-medium border border-emerald-500/30">
                        ✓ Full Site Content Extracted ({previewSite.wordCount?.toLocaleString()} words)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10.5px] font-medium border border-blue-500/30">
                        Summary Preview
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-white truncate max-w-lg mt-0.5">
                    {previewSite.title}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={previewSite.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-300 hover:text-white transition-colors"
                >
                  <OpenInNewIcon sx={{ fontSize: 13 }} />
                  <span>Open URL</span>
                </a>
                <IconButton
                  size="small"
                  onClick={() => setPreviewSite(null)}
                  sx={{ color: '#94a3b8', '&:hover': { color: '#fff' } }}
                >
                  <CloseIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </div>
            </div>

            <div className="p-5 max-h-[65vh] overflow-y-auto space-y-4 text-slate-200">
              {/* Site URL bar + Quick Action */}
              <div className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/[0.06] text-xs font-mono text-slate-400 break-all select-all flex items-center justify-between">
                <span className="truncate pr-2">{previewSite.url}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(previewSite.content || previewSite.preview || previewSite.url);
                    setSiteCopied(true);
                    setTimeout(() => setSiteCopied(false), 2000);
                  }}
                  className="text-cyan-400 hover:text-cyan-300 text-[11px] font-sans flex-shrink-0 font-medium cursor-pointer"
                >
                  {siteCopied ? 'Copied Content!' : 'Copy Text'}
                </button>
              </div>

              {/* Extracted Content Body with Markdown Rendering */}
              <div className="max-w-none text-sm leading-relaxed">
                {previewSite.content ? (
                  <MarkdownContent content={previewSite.content} />
                ) : (
                  <p className="text-slate-300 whitespace-pre-wrap leading-relaxed text-[15px]">
                    {previewSite.preview || previewSite.snippet || 'No extracted body text available.'}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </Dialog>

      {/* Unified Settings Dialog */}
      <Dialog
        open={settingsOpen}
        onClose={() => onSettingsOpenChange(false)}
        maxWidth="md"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              maxHeight: '90vh',
              backgroundColor: '#0d0d12',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '16px',
              color: '#f8fafc',
            },
          },
        }}
      >
        <div className="p-6 space-y-5 max-h-[85vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center border border-cyan-500/25">
                <SettingsIcon sx={{ fontSize: 18 }} className="text-cyan-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Settings</h3>
                <p className="text-xs text-slate-400">Manage your connection, chat history, and saved memory.</p>
              </div>
            </div>
            <IconButton onClick={() => onSettingsOpenChange(false)} size="small" sx={{ color: '#94a3b8' }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </div>

          {/* Settings Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-white/[0.04] rounded-xl border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setSettingsTab('general')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all ${
                settingsTab === 'general'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              General & Gateway
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('extensions')}
              className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                settingsTab === 'extensions'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ExtensionIcon sx={{ fontSize: 14 }} />
              Extensions & Tools
            </button>
          </div>

          {settingsTab === 'extensions' ? (
            <ExtensionsManagerView />
          ) : (
          <div className="space-y-4 text-xs">
            {/* Base URL */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Gateway Base URL
              </label>
              <input
                type="text"
                value={settingsBaseUrl}
                onChange={(e) => setSettingsBaseUrl(e.target.value)}
                placeholder="http://127.0.0.1:31415 or https://api.openai.com/v1"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500/60 font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Default: <code className="text-slate-400">http://127.0.0.1:31415</code>. Compatible with any OpenAI-style gateway or remote provider on any system.
              </p>
            </div>

            {/* API Key */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                API Key
              </label>
              <input
                type="password"
                value={settingsApiKey}
                onChange={(e) => setSettingsApiKey(e.target.value)}
                placeholder={settingsApiKeySet ? "Key configured (enter new key to replace)" : "Enter API key or leave blank for local gateway"}
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500/60 font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                {settingsApiKeySet
                  ? "✓ A custom API key is currently saved. Re-type to replace, or leave untouched."
                  : "Optional for local free gateways; required when using paid cloud models (OpenAI, DeepSeek, etc.)."}
              </p>
            </div>

            {/* Model Name */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Model Name (Optional)
              </label>
              <input
                type="text"
                value={settingsModel}
                onChange={(e) => setSettingsModel(e.target.value)}
                placeholder="e.g. gpt-4o, claude-3-5-sonnet, deepseek-chat, or leave blank"
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500/60 font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Leave blank or set to &apos;auto&apos; to let the gateway automatically select the model.
              </p>
            </div>

            {/* Permission Allowance (PA) */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                    Permission Allowance (Security Policy)
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Controls autonomous tool execution for both SORA Assistant chat and IDE Copilot.
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  permissionAllowance === 'full_access'
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : permissionAllowance === 'sandbox'
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                }`}>
                  {permissionAllowance === 'full_access' ? 'Full Access' : permissionAllowance === 'sandbox' ? 'Sandbox' : 'Strict'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
                {/* Full access */}
                <button
                  type="button"
                  onClick={() => setPermissionAllowance('full_access')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    permissionAllowance === 'full_access'
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 shadow-sm'
                      : 'bg-black/30 border-white/5 text-slate-400 hover:border-white/15 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white">Full access</span>
                    {permissionAllowance === 'full_access' && <span className="text-emerald-400 text-xs font-bold">✓</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Unrestricted tool access. Automates Chrome, launches apps, and runs terminal commands freely.
                  </p>
                </button>

                {/* Sandbox */}
                <button
                  type="button"
                  onClick={() => setPermissionAllowance('sandbox')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    permissionAllowance === 'sandbox'
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 shadow-sm'
                      : 'bg-black/30 border-white/5 text-slate-400 hover:border-white/15 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white">Sandbox</span>
                    {permissionAllowance === 'sandbox' && <span className="text-amber-400 text-xs font-bold">✓</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Workspace-confined file actions. Safe terminal commands and whitelisted apps only.
                  </p>
                </button>

                {/* Strict */}
                <button
                  type="button"
                  onClick={() => setPermissionAllowance('strict')}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    permissionAllowance === 'strict'
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200 shadow-sm'
                      : 'bg-black/30 border-white/5 text-slate-400 hover:border-white/15 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white">Strict</span>
                    {permissionAllowance === 'strict' && <span className="text-cyan-400 text-xs font-bold">✓</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-snug">
                    Maximum caution. Requires explicit confirmation for state changes, commands, and app launching.
                  </p>
                </button>
              </div>
            </div>

            {/* Status / Message */}
            {settingsSaveMsg && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  settingsSaveMsg.error
                    ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                    : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                <span>{settingsSaveMsg.error ? '⚠️' : '✓'}</span>
                <span>{settingsSaveMsg.text}</span>
              </div>
            )}

            {/* Conversation retention */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
              <div>
                <h4 className="text-xs font-semibold text-white">Chat history</h4>
                <p className="text-[11px] text-slate-500 mt-1">Manage saved conversations independently from long-term memories.</p>
              </div>
              <label className="flex items-center justify-between gap-4 cursor-pointer">
                <span className="text-xs text-slate-300">Automatically delete old chats</span>
                <input
                  type="checkbox"
                  checked={autoDeleteChats}
                  onChange={(e) => setAutoDeleteChats(e.target.checked)}
                  className="h-4 w-4 accent-cyan-500"
                />
              </label>
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="sora-chat-retention" className="text-xs text-slate-400">Keep chats for</label>
                <select
                  id="sora-chat-retention"
                  value={chatRetentionDays}
                  disabled={!autoDeleteChats}
                  onChange={(e) => setChatRetentionDays(Number(e.target.value))}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white disabled:opacity-40"
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                  <option value={180}>180 days</option>
                  <option value={365}>1 year</option>
                </select>
              </div>
              <p className="text-[10px] text-slate-500">Retention is applied when Sora loads saved chat history. Saved memories are not deleted by this option.</p>
              {historyActionMsg && (
                <p className={`text-xs ${historyActionMsg.error ? 'text-rose-300' : 'text-emerald-300'}`}>{historyActionMsg.text}</p>
              )}
              <button
                type="button"
                disabled={historyDeleting || isStreaming}
                onClick={async () => {
                  if (isStreaming) return;
                  if (!window.confirm('Delete all saved chat history? This cannot be undone. Long-term memories and workspace files will remain.')) return;
                  setHistoryDeleting(true);
                  setHistoryActionMsg(null);
                  try {
                    const result = await deleteAllChatHistory();
                    if (!result.ok) throw new Error(result.error || 'Could not delete chat history.');
                    activeChatIdRef.current = null;
                    setActiveChatId(null);
                    setMessages([]);
                    setChatHistory([]);
                    setSearchQuery('');
                    setPinnedIds([]);
                    try { localStorage.removeItem('sora_pinned_chats'); } catch {}
                    setHistoryActionMsg({ text: `Deleted ${result.deletedCount ?? 0} saved chat(s).` });
                    await loadHistory();
                  } catch (err: any) {
                    setHistoryActionMsg({ text: err?.message || 'Could not delete chat history.', error: true });
                  } finally {
                    setHistoryDeleting(false);
                  }
                }}
                className="px-3 py-2 rounded-lg border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/15 text-rose-300 disabled:opacity-50 text-xs font-semibold transition-colors"
              >
                {historyDeleting ? 'Deleting history…' : isStreaming ? 'Stop generation to delete history' : 'Delete all chat history'}
              </button>
            </div>

            {/* User Memories & Personal Preferences (User-Editable) */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.08]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-semibold text-white">User memories & personal preferences</h4>
                    <p className="text-[11px] text-slate-500 mt-1">Manage what Sora remembers about your domain, preferences, and coding standards.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] rounded-full border border-white/10 px-2 py-1 text-slate-400">{memories.length} saved</span>
                    {memories.length > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm("Delete all saved memories? Sora's permanent identity and application defaults will remain completely intact.")) return;
                          for (const m of memories) {
                            await deleteMemory(m.id);
                          }
                          await loadMemories();
                        }}
                        className="text-[10px] text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 transition-colors"
                      >
                        Clear all memories
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-4 space-y-5">

          {/* Quick-add a new memory */}
          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-indigo-300 uppercase tracking-widest">Add New Memory</p>

            {/* Type selector */}
            <div className="flex gap-1.5 flex-wrap">
              {(['instruction', 'code', 'fact', 'message'] as MemoryItem['type'][]).map((t) => (
                <button
                  key={t}
                  onClick={() => setMemorySaveType(t)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize transition-all border ${
                    memorySaveType === t
                      ? 'bg-indigo-600/50 border-indigo-400/60 text-indigo-100'
                      : 'bg-white/[0.04] border-white/[0.07] text-slate-400 hover:text-white hover:border-white/20'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <textarea
              value={memoryInput}
              onChange={(e) => setMemoryInput(e.target.value)}
              placeholder={
                memorySaveType === 'instruction'
                  ? 'e.g. Always explain code with comments. Never use inline styles.'
                  : memorySaveType === 'code'
                  ? 'e.g. ```python\ndef calculate_pnl(entry, exit): return exit - entry\n```'
                  : memorySaveType === 'fact'
                  ? 'e.g. My trading account uses MetaTrader 5 with USD base currency.'
                  : 'Enter a note or saved message for Sora to remember...'
              }
              rows={3}
              className="w-full bg-[#0a0d1a] border border-white/[0.08] focus:border-indigo-500/50 rounded-xl px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none resize-none transition-colors font-mono"
            />

            <button
              disabled={!memoryInput.trim()}
              onClick={async () => {
                if (!memoryInput.trim()) return;
                await saveMemory({
                  type: memorySaveType,
                  title: memoryInput.trim().slice(0, 55).replace(/\n/g, ' '),
                  content: memoryInput.trim(),
                  tags: [memorySaveType],
                  source: 'manual',
                  pinned: false,
                });
                setMemoryInput('');
                loadMemories();
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600/80 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all shadow-md shadow-indigo-900/40"
            >
              <BookmarkAddIcon sx={{ fontSize: 16 }} />
              Save to Memory
            </button>
          </div>

          {/* Memory list */}
          {memories.length === 0 ? (
            <div className="text-center py-8">
              <PsychologyAltIcon sx={{ fontSize: 32 }} className="text-slate-700 mb-2" />
              <p className="text-sm text-slate-500">No memories saved yet.</p>
              <p className="text-xs text-slate-600 mt-1">Sora will auto-learn from your instructions, or you can add them manually above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Saved Memories ({memories.length})</p>
              {memories.map((mem) => {
                const typeColors: Record<string, string> = {
                  instruction: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
                  code: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
                  fact: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
                  message: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
                };
                return (
                  <div
                    key={mem.id}
                    className={`p-3 rounded-xl border bg-white/[0.02] border-white/[0.06] hover:border-indigo-500/25 transition-all group ${mem.pinned ? 'border-indigo-500/30 bg-indigo-900/10' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize ${typeColors[mem.type] || typeColors.instruction}`}>
                            {mem.type}
                          </span>
                          {mem.pinned && (
                            <span className="text-[10px] text-indigo-400 font-semibold">📌 Pinned</span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-slate-200 line-clamp-1">{mem.title}</p>
                        <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 font-mono leading-relaxed">
                          {mem.content.replace(/```[a-z]*/g, '').trim()}
                        </p>
                      </div>
                      <button
                        onClick={async () => {
                          await deleteMemory(mem.id);
                          loadMemories();
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-all flex-shrink-0"
                      >
                        <BookmarkRemoveIcon sx={{ fontSize: 14 }} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Cross-chat recall info box */}
          {lastRecalled && (lastRecalled.memories?.length > 0 || lastRecalled.excerpts?.length > 0) && (
            <div className="p-3.5 rounded-xl bg-indigo-950/50 border border-indigo-500/25 space-y-2">
              <p className="text-xs font-semibold text-indigo-300">💡 Last Recall (used in recent response)</p>
              {lastRecalled.memories && lastRecalled.memories.length > 0 && (
                <p className="text-[11px] text-slate-400">
                  Injected <strong className="text-indigo-300">{lastRecalled.memories.length}</strong> memorized rule(s)
                </p>
              )}
              {lastRecalled.excerpts && lastRecalled.excerpts.length > 0 && (
                <p className="text-[11px] text-slate-400">
                  Recalled <strong className="text-cyan-300">{lastRecalled.excerpts.length}</strong> previous conversation(s):&nbsp;
                  {lastRecalled.excerpts.map((e) => `"${e.chatTitle}"`).join(', ')}
                </p>
              )}
            </div>
          )}
        </div>
            </div>
          </div>

          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
            <button
              onClick={() => onSettingsOpenChange(false)}
              className="px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={settingsSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-semibold transition-all shadow-md shadow-cyan-900/30"
            >
              {settingsSaving && <CircularProgress size={12} sx={{ color: 'white' }} />}
              Save & Reconnect
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default SoraChat;