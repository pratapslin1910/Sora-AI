/**
 * Robust Tool Call Parser for SORA AI
 *
 * Extracts tool name and arguments from model response texts,
 * handling tags (<tool_call>), markdown code fences, and JSON blocks.
 *
 * Uses a balanced-brace extractor so unclosed <tool_call> tags (no </tool_call>)
 * and nested JSON objects in args are parsed correctly.
 */

export interface ParsedToolCall {
  tool: string;
  args: Record<string, any>;
  rawBlock: string;
}

/**
 * Walk `str` from `startIndex` and return the first balanced `{...}` object.
 * Handles nested braces and string literals with escape sequences.
 */
function extractBalancedJsonObject(
  str: string,
  startIndex = 0
): { jsonString: string; startIndex: number; endIndex: number } | null {
  const openBraceIndex = str.indexOf('{', startIndex);
  if (openBraceIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = openBraceIndex; i < str.length; i++) {
    const char = str[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return {
            jsonString: str.substring(openBraceIndex, i + 1),
            startIndex: openBraceIndex,
            endIndex: i + 1,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Parse the first tool call from model output text.
 * Recognises:
 *  1. <tool_call> { ... } </tool_call>   (closed tag)
 *  2. <tool_call> { ... }                (unclosed tag – Gemini Flash pattern)
 *  3. ```tool_call / ```json code fences containing { "tool": ... }
 *  4. Standalone balanced JSON object containing "tool": "..."
 */
export function parseToolCallFromText(text: string): ParsedToolCall | null {
  if (!text || typeof text !== 'string') return null;

  // 1. <tool_call> tag (closed OR unclosed)
  const tagStart = text.search(/<tool_call>/i);
  if (tagStart !== -1) {
    const afterTag = text.slice(tagStart + '<tool_call>'.length);
    const balanced = extractBalancedJsonObject(afterTag);
    if (balanced) {
      try {
        const parsed = JSON.parse(balanced.jsonString);
        if (parsed && typeof parsed.tool === 'string') {
          const closingMatch = text.match(/<\/tool_call>/i);
          const rawEnd = closingMatch
            ? (closingMatch.index ?? 0) + closingMatch[0].length
            : tagStart + '<tool_call>'.length + balanced.endIndex;
          return {
            tool: parsed.tool.trim(),
            args: parsed.args || {},
            rawBlock: text.substring(tagStart, rawEnd),
          };
        }
      } catch {
        /* malformed JSON – fall through */
      }
    }
  }

  // 2. Code fences: ```tool_call, ```json, or plain ```
  const codeBlockRegex = /```(?:tool_call|json)?\s*\n([\s\S]*?)\n```/gi;
  let cbMatch: RegExpExecArray | null;
  while ((cbMatch = codeBlockRegex.exec(text)) !== null) {
    const balanced = extractBalancedJsonObject(cbMatch[1]);
    if (balanced) {
      try {
        const parsed = JSON.parse(balanced.jsonString);
        if (parsed && typeof parsed.tool === 'string') {
          return {
            tool: parsed.tool.trim(),
            args: parsed.args || {},
            rawBlock: cbMatch[0],
          };
        }
      } catch {
        /* malformed JSON – continue */
      }
    }
  }

  // 3. Scan for any balanced JSON object containing "tool": "..."
  let searchPos = 0;
  while (searchPos < text.length) {
    const balanced = extractBalancedJsonObject(text, searchPos);
    if (!balanced) break;
    if (/"tool"\s*:\s*"[^"]+"/i.test(balanced.jsonString)) {
      try {
        const parsed = JSON.parse(balanced.jsonString);
        if (parsed && typeof parsed.tool === 'string') {
          return {
            tool: parsed.tool.trim(),
            args: parsed.args || {},
            rawBlock: balanced.jsonString,
          };
        }
      } catch {
        /* malformed JSON – skip past this brace */
      }
    }
    searchPos = balanced.startIndex + 1;
  }

  return null;
}

/**
 * Strip ALL raw tool call syntax from a text string so it is never
 * shown verbatim in the chat UI.
 *
 * Removes:
 *  - <tool_call>...</tool_call> blocks (closed)
 *  - ```tool_call / ```json code fences containing {"tool": ...}
 *  - Any remaining <tool_call> / </tool_call> tags
 *  - Any balanced JSON object whose root contains "tool": "..."
 */
export function stripToolCallsFromText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text;

  // Pass 1: remove closed <tool_call>…</tool_call>
  cleaned = cleaned.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');

  // Pass 2: remove code blocks containing {"tool": ...}
  cleaned = cleaned.replace(
    /```(?:tool_call|json)?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*```/gi,
    ''
  );

  // Pass 3: remove any remaining <tool_call> / </tool_call> tags
  cleaned = cleaned.replace(/<\/?tool_call>/gi, '');

  // Pass 4: remove balanced JSON objects containing "tool": "..."
  // Loop up to 10 times to handle multiple tool calls in one message.
  for (let guard = 0; guard < 10; guard++) {
    let found = false;
    let pos = 0;
    while (pos < cleaned.length) {
      const balanced = extractBalancedJsonObject(cleaned, pos);
      if (!balanced) break;
      if (/"tool"\s*:\s*"[^"]+"/i.test(balanced.jsonString)) {
        cleaned =
          cleaned.substring(0, balanced.startIndex) +
          cleaned.substring(balanced.endIndex);
        found = true;
        break;
      }
      pos = balanced.startIndex + 1;
    }
    if (!found) break;
  }

  // Pass 5: remove [Called tool: ...] markers the model may echo from history
  cleaned = cleaned.replace(/\[Called tool:[^\]]*\]/g, '').trim();

  return cleaned.trim();
}

/**
 * Sanitize a single message content string before it is sent to the LLM.
 * Strips all raw tool call markup and history markers so the model never
 * sees them in its context and is not tempted to echo them back.
 */
export function sanitizeContentForModel(content: string | unknown): string {
  if (typeof content !== 'string') return '';
  return stripToolCallsFromText(content);
}
