/**
 * Memory Store & Cross-Chat Recall Engine for Sora AI
 *
 * Persists and indexes:
 *  - User Instructions & Rules ('instruction')
 *  - Important Code Snippets ('code')
 *  - Important Facts & User Context ('fact')
 *  - Pinned / Saved Messages ('message')
 *
 * Provides:
 *  - Semantic & keyword search across long-term memories
 *  - Cross-chat semantic retrieval of previous discussions
 *  - Automatic memory extraction from user prompts
 *  - Prompt augmentation for LLM context injection
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { searchChatExcerpts } from './chatStore.js';

const DATA_DIR = path.join(os.homedir(), '.sora_v1');
const MEMORIES_FILE = path.join(DATA_DIR, 'memories.json');

// Ensure data directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (err) {
  console.warn('[MemoryStore] Failed to ensure DATA_DIR:', err.message);
}

/** Embedding dimension */
const EMBED_DIM = 384;

/** Compute simple bag-of-words vector for local similarity calculation */
function bowVector(text) {
  const vec = new Array(EMBED_DIM).fill(0);
  let rawText = text;
  if (Array.isArray(rawText)) {
    rawText = rawText.filter((p) => p && (p.type === 'text' || typeof p.text === 'string')).map((p) => p.text || '').join(' ');
  } else if (typeof rawText !== 'string') {
    rawText = String(rawText || '');
  }
  const words = rawText.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  for (const word of words) {
    let hash = 5381;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) + hash) ^ word.charCodeAt(i);
    }
    const idx = Math.abs(hash) % EMBED_DIM;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/** Cosine similarity between two vectors */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

/** Default seed memories for Sora */
const DEFAULT_MEMORIES = [
  {
    id: 'seed-instruction-identity',
    type: 'instruction',
    title: 'Sora Core Identity',
    content: "Sora is an intelligent, versatile AI assistant. Always be clear, proactive, and precise. Adapt to each user's needs and domain.",
    tags: ['identity', 'core', 'role'],
    source: 'system',
    pinned: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'seed-instruction-code-style',
    type: 'instruction',
    title: 'Code Quality Standard',
    content: 'When writing code, provide clean, production-ready code with complete syntax, descriptive variable names, and clear error handling. Do not truncate essential code blocks.',
    tags: ['code', 'style', 'engineering'],
    source: 'system',
    pinned: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

/** Read memories from disk */
export function loadMemoriesFromDisk() {
  try {
    if (!fs.existsSync(MEMORIES_FILE)) {
      fs.writeFileSync(MEMORIES_FILE, JSON.stringify(DEFAULT_MEMORIES, null, 2), 'utf-8');
      return [...DEFAULT_MEMORIES];
    }
    const raw = fs.readFileSync(MEMORIES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      let changed = false;
      const updated = parsed.map((m) => {
        if (m.id === 'seed-instruction-identity' && (m.pinned || (typeof m.content === 'string' && m.content.includes('algorithmic trading')))) {
          changed = true;
          return {
            ...m,
            content: "Sora is an intelligent, versatile AI assistant. Always be clear, proactive, and precise. Adapt to each user's needs and domain.",
            pinned: false,
          };
        }
        if (m.id === 'seed-instruction-code-style' && m.pinned) {
          changed = true;
          return { ...m, pinned: false };
        }
        return m;
      });
      if (changed) {
        saveMemoriesToDisk(updated);
      }
      return updated;
    }
    return [...DEFAULT_MEMORIES];
  } catch (err) {
    console.warn('[MemoryStore] loadMemoriesFromDisk error, using defaults:', err.message);
    return [...DEFAULT_MEMORIES];
  }
}

/** Save memories to disk safely */
export function saveMemoriesToDisk(memories) {
  try {
    const tmpFile = `${MEMORIES_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpFile, JSON.stringify(memories, null, 2), 'utf-8');
    fs.renameSync(tmpFile, MEMORIES_FILE);
    return true;
  } catch (err) {
    console.error('[MemoryStore] saveMemoriesToDisk error:', err.message);
    return false;
  }
}

/**
 * List all saved memories with optional filtering
 * @param {Object} [filter]
 * @param {string} [filter.type] 'instruction' | 'code' | 'fact' | 'message'
 * @param {boolean} [filter.pinnedOnly]
 * @param {string} [filter.query]
 * @returns {Array}
 */
export function listMemories({ type, pinnedOnly = false, query = '' } = {}) {
  let list = loadMemoriesFromDisk();

  if (type) {
    list = list.filter((m) => m.type === type);
  }

  if (pinnedOnly) {
    list = list.filter((m) => Boolean(m.pinned));
  }

  if (query && query.trim()) {
    const qLower = query.toLowerCase().trim();
    list = list.filter((m) => {
      const titleMatch = (m.title || '').toLowerCase().includes(qLower);
      const contentMatch = (m.content || '').toLowerCase().includes(qLower);
      const tagsMatch = Array.isArray(m.tags) && m.tags.some((t) => t.toLowerCase().includes(qLower));
      return titleMatch || contentMatch || tagsMatch;
    });
  }

  // Sort pinned first, then updated_at DESC
  list.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
  });

  return list;
}

/**
 * Get a single memory by ID
 * @param {string} id
 */
export function getMemoryById(id) {
  const list = loadMemoriesFromDisk();
  return list.find((m) => m.id === id) || null;
}

/**
 * Create or update a memory item
 * @param {Object} memory
 */
export function saveMemory(memory) {
  const list = loadMemoriesFromDisk();
  const id = memory.id || crypto.randomUUID();
  const now = new Date().toISOString();

  const existingIndex = list.findIndex((m) => m.id === id);

  const cleanTags = Array.isArray(memory.tags)
    ? memory.tags.map((t) => String(t).trim()).filter(Boolean)
    : typeof memory.tags === 'string'
      ? memory.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

  const record = {
    id,
    type: memory.type || 'instruction',
    title: (memory.title || 'Untitled Memory').trim(),
    content: (memory.content || '').trim(),
    tags: cleanTags,
    source: memory.source || 'manual',
    pinned: Boolean(memory.pinned),
    created_at: existingIndex >= 0 ? list[existingIndex].created_at : now,
    updated_at: now,
  };

  if (existingIndex >= 0) {
    list[existingIndex] = record;
  } else {
    list.unshift(record);
  }

  saveMemoriesToDisk(list);
  return record;
}

/**
 * Delete a memory by ID
 * @param {string} id
 */
export function deleteMemory(id) {
  const list = loadMemoriesFromDisk();
  const filtered = list.filter((m) => m.id !== id);
  if (filtered.length !== list.length) {
    saveMemoriesToDisk(filtered);
    return true;
  }
  return false;
}

/**
 * Search memories by semantic query & keyword relevance
 * @param {string} queryText
 * @param {Object} [options]
 * @param {number} [options.limit=5]
 * @param {string} [options.type]
 */
export function searchMemories(queryText, { limit = 5, type } = {}) {
  const list = loadMemoriesFromDisk();
  if (!queryText || !queryText.trim()) {
    return list.slice(0, limit);
  }

  const qLower = queryText.toLowerCase().trim();
  const qTokens = qLower.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  const qVec = bowVector(queryText);

  let filtered = list;
  if (type) {
    filtered = filtered.filter((m) => m.type === type);
  }

  const scored = filtered.map((m) => {
    const text = `${m.title || ''} ${m.content || ''} ${(m.tags || []).join(' ')}`.toLowerCase();
    const mVec = bowVector(text);
    const semanticScore = cosineSimilarity(qVec, mVec);

    // Keyword matching score
    let keywordHits = 0;
    for (const token of qTokens) {
      if (text.includes(token)) keywordHits++;
    }
    const keywordScore = qTokens.length > 0 ? keywordHits / qTokens.length : 0;

    // Combined score (pinned gets slight boost)
    const totalScore = semanticScore * 0.6 + keywordScore * 0.4 + (m.pinned ? 0.2 : 0);

    return { memory: m, score: totalScore };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0.1 || s.memory.pinned)
    .slice(0, limit)
    .map((s) => s.memory);
}

/**
 * Automatically detect explicit user memory triggers from chat text
 * e.g. "Remember that...", "Always...", "My strategy is...", "Keep in mind..."
 * @param {string} text
 * @returns {Array<{ type: string, title: string, content: string, tags: string[] }>}
 */
export function detectAndExtractMemories(text) {
  if (!text || typeof text !== 'string') return [];
  const detected = [];
  const clean = text.trim();

  // 1. Explicit "Remember that / Remember this / Please remember"
  const rememberMatch = clean.match(/(?:please\s+)?remember\s+(?:that\s+|this:\s*|this\s+is\s+important:\s*)?([^\n.]+[\n.]?)/i);
  if (rememberMatch && rememberMatch[1]) {
    const statement = rememberMatch[1].trim();
    if (statement.length > 5) {
      detected.push({
        type: statement.toLowerCase().includes('function') || statement.includes('code') ? 'code' : 'instruction',
        title: statement.slice(0, 50).trim(),
        content: statement,
        tags: ['auto-remember', 'instruction'],
      });
    }
  }

  // 2. Behavioral instructions ("Always do X", "Never do Y", "From now on, do X")
  const ruleMatch = clean.match(/(?:from\s+now\s+on[,\s]+)?(?:always|never)\s+([^\n.]+[\n.]?)/i);
  if (ruleMatch && ruleMatch[1]) {
    const fullRule = ruleMatch[0].trim();
    if (fullRule.length > 10 && !detected.some((d) => d.content === fullRule)) {
      detected.push({
        type: 'instruction',
        title: fullRule.slice(0, 45).trim(),
        content: fullRule,
        tags: ['rule', 'preference', 'instruction'],
      });
    }
  }

  // 3. User Identity / Preference / Project context ("My name is X", "My strategy is X", "I prefer X", "Our stack is X")
  const preferenceMatch = clean.match(/(?:my\s+(?:name|project|strategy|stack|preference|system)|i\s+prefer)\s+is\s+([^\n.]+[\n.]?)/i);
  if (preferenceMatch && preferenceMatch[0]) {
    const prefStatement = preferenceMatch[0].trim();
    if (prefStatement.length > 8 && !detected.some((d) => d.content === prefStatement)) {
      detected.push({
        type: 'fact',
        title: prefStatement.slice(0, 45).trim(),
        content: prefStatement,
        tags: ['user-preference', 'fact'],
      });
    }
  }

  // 4. Code block marked as important / reusable
  const codeBlockMatch = clean.match(/```([a-z0-9_-]*)\n([\s\S]*?)```/i);
  if (codeBlockMatch && (clean.toLowerCase().includes('save this') || clean.toLowerCase().includes('remember this code') || clean.toLowerCase().includes('reusable helper'))) {
    const lang = codeBlockMatch[1] || 'code';
    const codeBody = codeBlockMatch[2].trim();
    if (codeBody.length > 15) {
      detected.push({
        type: 'code',
        title: `Reusable ${lang.toUpperCase()} snippet`,
        content: `\`\`\`${lang}\n${codeBody}\n\`\`\``,
        tags: ['code', lang, 'snippet'],
      });
    }
  }

  return detected;
}

/**
 * Core Cross-Chat and Memory Recall Engine
 * Given a user's prompt and current chat ID:
 *  1. Retrieves all active pinned instructions (rules that always apply)
 *  2. Finds relevant memories matching the query (instructions, code, facts)
 *  3. Queries previous chats for relevant discussions and code excerpts
 *  4. Produces a synthesized, high-priority context block ready for system prompt injection
 *
 * @param {string} queryText
 * @param {Object} [options]
 * @param {string} [options.currentChatId] ID of active chat (to avoid self-recalling current conversation)
 * @param {number} [options.maxMemories=4]
 * @param {number} [options.maxChatTurns=3]
 * @param {Object} [options.providerOpts] { baseUrl, apiKey }
 */
export async function recallContextForQuery(
  queryText,
  { currentChatId = null, maxMemories = 4, maxChatTurns = 3 } = {},
  providerOpts = {}
) {
  if (!queryText || !queryText.trim()) {
    return {
      formattedContext: '',
      memoriesRecalled: [],
      chatExcerptsRecalled: [],
    };
  }

  // 1. Gather all pinned memories (permanent rules/identity)
  const allPinned = listMemories({ pinnedOnly: true });

  // 2. Gather top semantic/keyword matches for unpinned memories
  const relevantMemories = searchMemories(queryText, { limit: maxMemories });

  // Combine and deduplicate memories
  const memoryMap = new Map();
  for (const m of allPinned) memoryMap.set(m.id, m);
  for (const m of relevantMemories) memoryMap.set(m.id, m);
  const recalledMemories = Array.from(memoryMap.values());

  // 3. Search previous chat sessions for relevant excerpts
  let chatExcerpts = [];
  try {
    chatExcerpts = await searchChatExcerpts(queryText, {
      currentChatId,
      limit: maxChatTurns,
    }, providerOpts);
  } catch (err) {
    console.warn('[MemoryStore] searchChatExcerpts failed:', err.message);
  }

  // If no memories and no chat excerpts found, return empty
  if (recalledMemories.length === 0 && chatExcerpts.length === 0) {
    return {
      formattedContext: '',
      memoriesRecalled: [],
      chatExcerptsRecalled: [],
    };
  }

  // 4. Format into structured context for the LLM
  const sections = [];

  sections.push('[SORA LONG-TERM MEMORY & CROSS-CHAT INTELLIGENCE]');
  sections.push('You have access to persistent memory and recall previous conversations with the user.');
  sections.push('Use this context to maintain continuity, honor the user\'s established instructions/preferences, and refer to previous code or discussions when relevant.');

  // Group memories by type
  const instructions = recalledMemories.filter((m) => m.type === 'instruction');
  const codeMemories = recalledMemories.filter((m) => m.type === 'code');
  const facts = recalledMemories.filter((m) => m.type === 'fact' || m.type === 'message');

  if (instructions.length > 0) {
    sections.push('\n=== ESTABLISHED USER INSTRUCTIONS & RULES ===');
    for (const inst of instructions) {
      sections.push(`• [${inst.title}]: ${inst.content}`);
    }
  }

  if (codeMemories.length > 0) {
    sections.push('\n=== REMEMBERED CODE & ARCHITECTURE PATTERNS ===');
    for (const code of codeMemories) {
      sections.push(`• [${code.title}]:\n${code.content}`);
    }
  }

  if (facts.length > 0) {
    sections.push('\n=== REMEMBERED FACTS & USER CONTEXT ===');
    for (const fact of facts) {
      sections.push(`• [${fact.title}]: ${fact.content}`);
    }
  }

  if (chatExcerpts.length > 0) {
    sections.push('\n=== RELEVANT EXCERPTS FROM PREVIOUS CONVERSATIONS ===');
    for (const ex of chatExcerpts) {
      sections.push(`• From Chat "${ex.chatTitle}" (${formatRelativeDate(ex.date)}):`);
      if (ex.userQuery) {
        sections.push(`  User asked: "${truncate(ex.userQuery, 160)}"`);
      }
      if (ex.assistantExcerpt) {
        sections.push(`  Sora answered: "${truncate(ex.assistantExcerpt, 260)}"`);
      }
      if (ex.codeSnippet) {
        sections.push(`  Code discussed:\n${truncate(ex.codeSnippet, 300)}`);
      }
    }
  }

  sections.push('[END SORA MEMORY CONTEXT]\n');

  const formattedContext = sections.join('\n');

  return {
    formattedContext,
    memoriesRecalled: recalledMemories,
    chatExcerptsRecalled: chatExcerpts,
  };
}

/** Helper: truncate text nicely */
function truncate(str, maxLen = 200) {
  if (!str) return '';
  const s = String(str).trim();
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

/** Helper: format date nicely */
function formatRelativeDate(iso) {
  if (!iso) return 'previously';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return 'previously';
  }
}
