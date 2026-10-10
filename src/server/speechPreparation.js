/**
 * Speech-Friendly Response Preparation Pipeline
 *
 * Prepares user-facing text for high-quality natural speech synthesis:
 * - Strips hidden reasoning (<think>, <thought>, control tokens)
 * - Strips internal tool execution traces and JSON payloads
 * - Summarizes code blocks instead of reading out raw syntax aloud
 * - Cleans Markdown formatting (headers, bold, bullets, links, tables)
 * - Normalizes abbreviations, symbols, currency, and punctuation for natural pauses
 * - Preserves natural Hinglish, Hindi, and English code-switching verbatim
 * - Eliminates duplicate sentences and phrases
 */

/**
 * Common tech & conversational abbreviation map
 */
const ABBREVIATIONS = [
  [/\be\.g\.,?\s*/gi, 'for example, '],
  [/\bi\.e\.,?\s*/gi, 'that is, '],
  [/\betc\.,?\s*/gi, 'etcetera. '],
  [/\bvs\.\s*/gi, 'versus '],
  [/\bapprox\.\s*/gi, 'approximately '],
  [/\bw\/\s*/gi, 'with '],
  [/\bw\/o\s*/gi, 'without '],
];

/**
 * Currency and symbol map
 */
const SYMBOLS = [
  [/[$]([0-9]+(?:\.[0-9]+)?)/g, '$1 dollars'],
  [/₹([0-9]+(?:\.[0-9]+)?)/g, '$1 rupees'],
  [/€([0-9]+(?:\.[0-9]+)?)/g, '$1 euros'],
  [/£([0-9]+(?:\.[0-9]+)?)/g, '$1 pounds'],
  [/([0-9]+)%/g, '$1 percent'],
  [/\s*&\s*/g, ' and '],
  [/\b(?:and\/or)\b/gi, 'and or'],
  [/===?/g, ' equals '],
  [/!==?/g, ' not equal to '],
  [/>=/g, ' greater than or equal to '],
  [/<=/g, ' less than or equal to '],
  [/=>|->/g, ' to '],
];

/**
 * Remove internal tool execution artifacts, traces, or debug outputs
 */
function stripToolArtifacts(text) {
  let cleaned = text;
  // Strip [TOOL_CALL: ...], [TOOL_RESULT: ...], [Action: ...]
  cleaned = cleaned.replace(/\[(?:TOOL_CALL|TOOL_RESULT|Action|Observation|Thought|System):[\s\S]*?\]/gi, '');
  // Strip "Executing tool..." or "Tool execution result:"
  cleaned = cleaned.replace(/(?:Executing tool|Tool execution (?:result|status|output)|Tool call):[^\n]*/gi, '');
  // Strip stray JSON payload blocks if any appeared as plain text tool dump
  cleaned = cleaned.replace(/\{\s*"(?:tool|command|action|parameters|result)"\s*:[^}]+\}/gi, '');
  return cleaned;
}

/**
 * Replace code blocks with concise spoken summaries
 */
function handleCodeBlocks(text, isHinglish = false) {
  // Check if text is solely a code block
  const trimmed = text.trim();
  const soleCodeBlockMatch = trimmed.match(/^```(?:[a-z0-9_-]+)?\s*([\s\S]*?)\s*```$/i);
  if (soleCodeBlockMatch) {
    return isHinglish ? 'Maine code provide kar diya hai.' : 'Here is the code you requested.';
  }

  // Fenced code blocks
  const fencedRegex = /```(?:[a-z0-9_-]+)?\s*([\s\S]*?)\s*```/gi;
  let codeCount = 0;
  let replaced = text.replace(fencedRegex, () => {
    codeCount++;
    return isHinglish
      ? ' Maine code neeche provide kar diya hai. '
      : ' I have provided the code below. ';
  });

  // Inline code `...` -> strip backticks
  replaced = replaced.replace(/`([^`\n]+)`/g, '$1');

  return replaced;
}

/**
 * Strip Markdown formatting to leave clean, readable prose
 */
function stripMarkdown(text) {
  let res = text;

  // Images: ![alt](url) -> ""
  res = res.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');

  // Links: [text](url) -> "text"
  res = res.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Bare URLs: https://... -> "the link"
  res = res.replace(/https?:\/\/[^\s)]+/g, 'the link');

  // Headers: # Header -> Header.
  res = res.replace(/^#{1,6}\s+(.+)$/gm, '$1.');

  // Blockquotes: > quote -> quote
  res = res.replace(/^>\s*(.+)$/gm, '$1');

  // Markdown horizontal rules: ---, ***, ___
  res = res.replace(/^[-*_]{3,}\s*$/gm, '');

  // Bold and Italics: **text**, *text*, __text__, _text_
  res = res.replace(/[*_]{2,3}([^*_]+)[*_]{2,3}/g, '$1');
  res = res.replace(/[*_]([^*_\n]+)[*_]/g, '$1');

  // Strikethrough: ~~text~~ -> text
  res = res.replace(/~~([^~]+)~~/g, '$1');

  // Unordered list items: - item, * item, + item -> item
  res = res.replace(/^[\s]*[-*+]\s+(.+)$/gm, '$1.');

  // Ordered list items: 1. item -> item
  res = res.replace(/^[\s]*\d+\.\s+(.+)$/gm, '$1.');

  // Markdown tables: lines with pipes | a | b |
  const tableLines = res.split('\n');
  const nonTableLines = [];
  for (const line of tableLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Table separator row |---|---|
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        continue;
      }
      // Data row: extract cells
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length > 0) {
        nonTableLines.push(cells.join(', ') + '.');
      }
    } else {
      nonTableLines.push(line);
    }
  }
  res = nonTableLines.join('\n');

  return res;
}

/**
 * Normalize spoken punctuation, numbers, and abbreviations
 */
function normalizeSpokenText(text) {
  let res = text;

  // Abbreviations
  for (const [regex, replacement] of ABBREVIATIONS) {
    res = res.replace(regex, replacement);
  }

  // Symbols
  for (const [regex, replacement] of SYMBOLS) {
    res = res.replace(regex, replacement);
  }

  // Number ranges: e.g. "10-20" -> "10 to 20"
  res = res.replace(/\b(\d+)\s*[-–—]\s*(\d+)\b/g, '$1 to $2');

  // Remove multiple exclamation / question marks
  res = res.replace(/\?{2,}/g, '?');
  res = res.replace(/!{2,}/g, '!');
  res = res.replace(/\.{3,}/g, ', ');

  // Clean remaining unwanted brackets or special chars
  res = res.replace(/[{}\[\]\\^~]/g, ' ');

  // Collapse consecutive whitespace
  res = res.replace(/[ \t]+/g, ' ');
  res = res.replace(/\n\s*\n+/g, '\n');

  return res.trim();
}

/**
 * Remove duplicate consecutive sentences
 */
function deduplicateSentences(text) {
  if (!text) return '';

  const sentences = text
    .split(/([.?!]\s+)/)
    .filter(Boolean);

  const merged = [];
  let currentSentence = '';

  for (let i = 0; i < sentences.length; i++) {
    const part = sentences[i];
    if (/[.?!]\s+$/.test(part)) {
      currentSentence += part;
      const trimmed = currentSentence.trim();
      const prevTrimmed = merged.length > 0 ? merged[merged.length - 1].trim() : '';

      // Skip duplicate consecutive sentences
      if (trimmed.toLowerCase() !== prevTrimmed.toLowerCase()) {
        merged.push(currentSentence);
      }
      currentSentence = '';
    } else {
      currentSentence += part;
    }
  }

  if (currentSentence.trim()) {
    const trimmed = currentSentence.trim();
    const prevTrimmed = merged.length > 0 ? merged[merged.length - 1].trim() : '';
    if (trimmed.toLowerCase() !== prevTrimmed.toLowerCase()) {
      merged.push(currentSentence);
    }
  }

  return merged.join('').trim();
}

/**
 * Detect whether text has Hinglish code-switching
 */
function detectHinglish(text) {
  if (!text) return false;
  const hinglishKeywords = /\b(?:kya|haan|nahi|nahin|aur|kaise|kar|raha|rahi|sakta|sakti|hoon|hai|hain|tum|aap|mein|pe|bhi|bilkul|batao|theek|chalo|accha|achha)\b/i;
  return hinglishKeywords.test(text);
}

/**
 * Prepare user-facing response text for natural, conversational speech delivery.
 *
 * @param {string} displayText The display response text from Sora
 * @param {Object} [options]
 * @param {string} [options.language] Preferred language ('auto' | 'en' | 'hi' | 'hinglish')
 * @returns {string} Clean speech-ready text
 */
export function prepareSpeechText(displayText, { language = 'auto' } = {}) {
  if (!displayText || typeof displayText !== 'string') {
    return '';
  }

  let text = displayText.trim();
  if (!text) return '';

  // 1. Strip reasoning blocks (<think>...</think> or <thought>...</thought>)
  text = text.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/gi, '');
  text = text.replace(/<\/?(?:think|thought|reasoning)(?:\s+[^>]*)?>/gi, '');
  text = text.replace(/<\|(?:thought|endofthought|start_thought)\|>/gi, '');

  // 2. Strip internal tool artifacts and payload dumps
  text = stripToolArtifacts(text);

  // 3. Detect Hinglish context
  const isHinglish = language === 'hi' || language === 'hinglish' || detectHinglish(text);

  // 4. Summarize and replace code blocks
  text = handleCodeBlocks(text, isHinglish);

  // 5. Strip markdown formatting
  text = stripMarkdown(text);

  // 6. Normalize punctuation, abbreviations, and spoken numbers
  text = normalizeSpokenText(text);

  // 7. Deduplicate consecutive sentences
  text = deduplicateSentences(text);

  return text.trim();
}
