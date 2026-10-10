/**
 * Chat Store — LanceDB-backed persistent conversation storage.
 *
 * Each chat record stored in the "chats" table:
 *   id          : string  (UUID v4)
 *   title       : string  (auto-generated from first user message)
 *   created_at  : string  (ISO timestamp)
 *   updated_at  : string  (ISO timestamp)
 *   messages    : string  (JSON-encoded ChatMessage[])
 *   summary     : string  (first user message, used as embedding source)
 *   vector      : Float32Array  (384-dim embedding from FreeLLMAPI or fallback)
 *
 * Vector search allows semantic "find chats about X" queries.
 */

import { connect } from '@lancedb/lancedb';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

// DB lives in ~/.sora_v1/lancedb  (portable, survives project moves)
const DB_DIR = path.join(os.homedir(), '.sora_v1', 'lancedb');
const TABLE_NAME = 'chats';

/** Embedding dimension — must be consistent. We use 384 (all-minilm style) */
const EMBED_DIM = 384;

/** Generate a zero vector (fallback when no embedding service is available) */
function zeroVector() {
  return new Array(EMBED_DIM).fill(0);
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && (p.type === 'text' || typeof p.text === 'string'))
      .map((p) => p.text || '')
      .join(' ');
  }
  return String(content || '');
}

/** Generate a simple deterministic bag-of-words vector (fallback, no GPU needed) */
function bowVector(text) {
  const vec = new Array(EMBED_DIM).fill(0);
  const words = extractText(text).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  for (const word of words) {
    let hash = 5381;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) + hash) ^ word.charCodeAt(i);
    }
    const idx = Math.abs(hash) % EMBED_DIM;
    vec[idx] += 1;
  }
  // L2-normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

/** Attempt to get a real embedding from FreeLLMAPI, else fall back to BOW */
async function getEmbedding(text, baseUrl, apiKey) {
  if (!text || !text.trim()) return zeroVector();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 512) }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`Embeddings HTTP ${res.status}`);
    const data = await res.json();
    const raw = data?.data?.[0]?.embedding;
    if (!Array.isArray(raw)) throw new Error('No embedding in response');

    // Resize to EMBED_DIM: truncate or zero-pad
    if (raw.length === EMBED_DIM) return raw;
    const sized = new Array(EMBED_DIM).fill(0);
    for (let i = 0; i < Math.min(raw.length, EMBED_DIM); i++) sized[i] = raw[i];
    return sized;
  } catch {
    // FreeLLMAPI may not have embeddings — fall back gracefully
    return bowVector(text);
  }
}

/** Singleton DB connection */
let _db = null;
let _table = null;

async function getTable(baseUrl, apiKey) {
  if (_table) return _table;

  _db = await connect(DB_DIR);
  const existingNames = await _db.tableNames();

  if (existingNames.includes(TABLE_NAME)) {
    _table = await _db.openTable(TABLE_NAME);
  } else {
    // Create table with a seed record so schema is established
    const seedVec = await getEmbedding('Sora trading assistant initial chat', baseUrl, apiKey);
    const seedId = crypto.randomUUID();
    _table = await _db.createTable(TABLE_NAME, [
      {
        id: seedId,
        title: 'Welcome to Sora',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        messages: JSON.stringify([
          { role: 'assistant', content: 'Hello! I am Sora. How can I help you with your trading today?' },
        ]),
        summary: 'Welcome to Sora trading assistant',
        vector: seedVec,
      },
    ]);
  }

  return _table;
}

/** ------------------------------------------------------------------
 *  Public API
 * ------------------------------------------------------------------ */

/**
 * List all chats, ordered by updated_at DESC.
 * @returns {Promise<Array<{ id, title, created_at, updated_at, messages }>>}
 */
export async function listChats({ baseUrl = 'http://127.0.0.1:31415/v1', apiKey = '' } = {}) {
  try {
    const table = await getTable(baseUrl, apiKey);
    const rows = await table.query().limit(200).toArray();
    // Sort descending by updated_at
    rows.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    // Deduplicate in case of duplicate IDs or duplicate messages/titles
    const seenIds = new Set();
    const unique = [];

    for (const r of rows) {
      if (seenIds.has(r.id)) continue;
      seenIds.add(r.id);
      // Different conversations may legitimately share the same title.
      unique.push(normalizeRow(r));
    }
    return unique;
  } catch (err) {
    console.error('[ChatStore] listChats error:', err.message);
    return [];
  }
}

/**
 * Get a single chat by ID.
 * @param {string} id
 */
export async function getChatById(id, { baseUrl, apiKey } = {}) {
  try {
    const table = await getTable(baseUrl, apiKey);
    const rows = await table.query().where(`id = '${id.replace(/'/g, "''")}'`).limit(1).toArray();
    if (!rows.length) return null;
    return normalizeRow(rows[0]);
  } catch (err) {
    console.error('[ChatStore] getChatById error:', err.message);
    return null;
  }
}

/**
 * Save a new chat or update an existing one (upsert by id).
 * @param {{ id?: string, title?: string, messages: Array<{role,content}> }} chat
 */
export async function saveChat(chat, { baseUrl = 'http://127.0.0.1:31415/v1', apiKey = '' } = {}) {
  try {
    const table = await getTable(baseUrl, apiKey);

    let id = chat.id || crypto.randomUUID();
    const now = new Date().toISOString();

    // Auto-generate title from first user message
    const firstUser = chat.messages?.find(m => m.role === 'user');
    const firstUserText = extractText(firstUser?.content);
    const summary = firstUserText.slice(0, 200) || 'Untitled conversation';
    const title = chat.title || autoTitle(summary);

    const vector = await getEmbedding(summary, baseUrl, apiKey);

    // Check if exists by ID
    let existing = await table
      .query()
      .where(`id = '${id.replace(/'/g, "''")}'`)
      .limit(1)
      .toArray();

    // If no existing record with this ID, check if a chat with the exact same summary exists
    if (!existing.length && summary && summary !== 'Untitled conversation') {
      const sameSummary = await table
        .query()
        .where(`summary = '${summary.replace(/'/g, "''")}'`)
        .limit(1)
        .toArray();
      if (sameSummary.length) {
        existing = sameSummary;
        id = existing[0].id; // Reuse existing ID to avoid dual duplicate
      }
    }

    const record = {
      id,
      title,
      created_at: existing.length ? existing[0].created_at : now,
      updated_at: now,
      messages: JSON.stringify(chat.messages || []),
      summary,
      vector,
    };

    if (existing.length) {
      // LanceDB update: delete + re-insert
      await table.delete(`id = '${id.replace(/'/g, "''")}'`);
    }

    await table.add([record]);
    return normalizeRow(record);
  } catch (err) {
    console.error('[ChatStore] saveChat error:', err.message);
    throw err;
  }
}

/**
 * Delete every saved chat. This intentionally clears persisted conversation
 * history only; it does not touch long-term memories or workspace files.
 */
export async function deleteAllChats({ baseUrl, apiKey } = {}) {
  const table = await getTable(baseUrl, apiKey);
  const rows = await table.query().limit(100000).toArray();
  if (rows.length === 0) return 0;
  // Delete using unique IDs so all stored sessions (including same-title chats)
  // are removed, while avoiding an unbounded predicate over arbitrary content.
  let deleted = 0;
  for (const row of rows) {
    await table.delete(`id = '${String(row.id).replace(/'/g, "''")}'`);
    deleted += 1;
  }
  return deleted;
}

/**
 * Delete a chat by ID.
 * @param {string} id
 */
export async function deleteChat(id, { baseUrl, apiKey } = {}) {
  try {
    const table = await getTable(baseUrl, apiKey);
    await table.delete(`id = '${id.replace(/'/g, "''")}'`);
    return true;
  } catch (err) {
    console.error('[ChatStore] deleteChat error:', err.message);
    return false;
  }
}

/**
 * Semantic vector search — find chats similar to query text.
 * @param {string} queryText
 * @param {number} [limit=5]
 */
export async function searchChats(queryText, limit = 5, { baseUrl = 'http://127.0.0.1:31415/v1', apiKey = '' } = {}) {
  try {
    const table = await getTable(baseUrl, apiKey);
    const queryVec = await getEmbedding(queryText, baseUrl, apiKey);
    const rows = await table.vectorSearch(queryVec).limit(limit).toArray();
    const seen = new Set();
    const unique = [];
    for (const r of rows) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        unique.push(normalizeRow(r));
      }
    }
    return unique;
  } catch (err) {
    console.error('[ChatStore] searchChats error:', err.message);
    return [];
  }
}

/**
 * Search previous chat conversations for relevant message excerpts and code turns.
 * @param {string} queryText
 * @param {Object} [options]
 * @param {string} [options.currentChatId] Exclude the active chat session from recall
 * @param {number} [options.limit=3]
 * @param {Object} [options.providerOpts] { baseUrl, apiKey }
 * @returns {Promise<Array<{ chatId: string, chatTitle: string, date: string, userQuery: string, assistantExcerpt: string, codeSnippet?: string, score: number }>>}
 */
export async function searchChatExcerpts(
  queryText,
  { currentChatId = null, limit = 3 } = {},
  { baseUrl = 'http://127.0.0.1:31415/v1', apiKey = '' } = {}
) {
  try {
    const allChats = await listChats({ baseUrl, apiKey });
    if (!allChats || allChats.length === 0) return [];

    const qClean = (queryText || '').toLowerCase().trim();
    if (!qClean) return [];

    // Meaningful query keywords (length >= 3, non-stopwords)
    const stopWords = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'you', 'what', 'how', 'why',
      'can', 'are', 'was', 'were', 'tell', 'about', 'from', 'have', 'does', 'give',
    ]);
    const tokens = qClean
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stopWords.has(t));

    const results = [];

    for (const chat of allChats) {
      if (currentChatId && chat.id === currentChatId) continue;
      const msgs = chat.messages || [];
      if (!Array.isArray(msgs) || msgs.length === 0) continue;

      let bestTurnScore = 0;
      let bestTurn = null;

      // Also check chat title
      const titleLower = (chat.title || '').toLowerCase();
      let titleHits = 0;
      for (const t of tokens) {
        if (titleLower.includes(t)) titleHits++;
      }

      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        if (msg.role !== 'user') continue;

        const nextMsg = msgs[i + 1]?.role === 'assistant' ? msgs[i + 1] : null;
        const userContent = extractText(msg.content).toLowerCase();
        const asstContent = extractText(nextMsg?.content).toLowerCase();

        let hits = titleHits * 1.5;
        for (const t of tokens) {
          if (userContent.includes(t)) hits += 2.0;
          if (asstContent.includes(t)) hits += 1.0;
        }

        // Check if query is looking for code and turn contains code
        const hasCode = asstContent.includes('```') || userContent.includes('```');
        if (
          hasCode &&
          (qClean.includes('code') ||
            qClean.includes('script') ||
            qClean.includes('function') ||
            qClean.includes('implement'))
        ) {
          hits += 2.0;
        }

        if (hits > bestTurnScore) {
          bestTurnScore = hits;

          // Extract code snippet if present in assistant response
          let codeSnippet = undefined;
          const codeMatch = (nextMsg?.content || '').match(/```[a-z0-9_-]*\n([\s\S]*?)```/i);
          if (codeMatch && codeMatch[0]) {
            codeSnippet = codeMatch[0];
          }

          bestTurn = {
            chatId: chat.id,
            chatTitle: chat.title,
            date: chat.updated_at || chat.created_at,
            userQuery: msg.content || '',
            assistantExcerpt: nextMsg?.content || '',
            codeSnippet,
            score: bestTurnScore,
          };
        }
      }

      // If tokens was empty or bestTurnScore is high enough
      if (bestTurn && (bestTurnScore >= 2.0 || (tokens.length <= 2 && bestTurnScore >= 1.0))) {
        results.push(bestTurn);
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  } catch (err) {
    console.error('[ChatStore] searchChatExcerpts error:', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeRow(row) {
  let messages = [];
  try {
    messages = JSON.parse(row.messages || '[]');
  } catch {}
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    messages,
    summary: row.summary || '',
  };
}

function autoTitle(text) {
  // Take first 60 chars, trim at last word boundary
  const trimmed = text.trim().slice(0, 60);
  const lastSpace = trimmed.lastIndexOf(' ');
  return lastSpace > 20 ? trimmed.slice(0, lastSpace) : trimmed;
}
