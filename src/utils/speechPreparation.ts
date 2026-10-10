/**
 * Frontend Speech-Friendly Response Preparation Pipeline
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

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\be\.g\.,?\s*/gi, 'for example, '],
  [/\bi\.e\.,?\s*/gi, 'that is, '],
  [/\betc\.,?\s*/gi, 'etcetera. '],
  [/\bvs\.\s*/gi, 'versus '],
  [/\bapprox\.\s*/gi, 'approximately '],
  [/\bw\/\s*/gi, 'with '],
  [/\bw\/o\s*/gi, 'without '],
];

const SYMBOLS: Array<[RegExp, string]> = [
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

function stripToolArtifacts(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/\[(?:TOOL_CALL|TOOL_RESULT|Action|Observation|Thought|System):[\s\S]*?\]/gi, '');
  cleaned = cleaned.replace(/(?:Executing tool|Tool execution (?:result|status|output)|Tool call):[^\n]*/gi, '');
  cleaned = cleaned.replace(/\{\s*"(?:tool|command|action|parameters|result)"\s*:[^}]+\}/gi, '');
  return cleaned;
}

function handleCodeBlocks(text: string, isHinglish = false): string {
  const trimmed = text.trim();
  const soleCodeBlockMatch = trimmed.match(/^```(?:[a-z0-9_-]+)?\s*([\s\S]*?)\s*```$/i);
  if (soleCodeBlockMatch) {
    return isHinglish ? 'Maine code provide kar diya hai.' : 'Here is the code you requested.';
  }

  const fencedRegex = /```(?:[a-z0-9_-]+)?\s*([\s\S]*?)\s*```/gi;
  let replaced = text.replace(fencedRegex, () => {
    return isHinglish
      ? ' Maine code neeche provide kar diya hai. '
      : ' I have provided the code below. ';
  });

  replaced = replaced.replace(/`([^`\n]+)`/g, '$1');
  return replaced;
}

function stripMarkdown(text: string): string {
  let res = text;
  res = res.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
  res = res.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  res = res.replace(/https?:\/\/[^\s)]+/g, 'the link');
  res = res.replace(/^#{1,6}\s+(.+)$/gm, '$1.');
  res = res.replace(/^>\s*(.+)$/gm, '$1');
  res = res.replace(/^[-*_]{3,}\s*$/gm, '');
  res = res.replace(/[*_]{2,3}([^*_]+)[*_]{2,3}/g, '$1');
  res = res.replace(/[*_]([^*_\n]+)[*_]/g, '$1');
  res = res.replace(/~~([^~]+)~~/g, '$1');
  res = res.replace(/^[\s]*[-*+]\s+(.+)$/gm, '$1.');
  res = res.replace(/^[\s]*\d+\.\s+(.+)$/gm, '$1.');

  const tableLines = res.split('\n');
  const nonTableLines: string[] = [];
  for (const line of tableLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
        continue;
      }
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

function normalizeSpokenText(text: string): string {
  let res = text;
  for (const [regex, replacement] of ABBREVIATIONS) {
    res = res.replace(regex, replacement);
  }
  for (const [regex, replacement] of SYMBOLS) {
    res = res.replace(regex, replacement);
  }
  res = res.replace(/\b(\d+)\s*[-–—]\s*(\d+)\b/g, '$1 to $2');
  res = res.replace(/\?{2,}/g, '?');
  res = res.replace(/!{2,}/g, '!');
  res = res.replace(/\.{3,}/g, ', ');
  res = res.replace(/[{}\[\]\\^~]/g, ' ');
  res = res.replace(/[ \t]+/g, ' ');
  res = res.replace(/\n\s*\n+/g, '\n');
  return res.trim();
}

function deduplicateSentences(text: string): string {
  if (!text) return '';
  const sentences = text.split(/([.?!]\s+)/).filter(Boolean);
  const merged: string[] = [];
  let currentSentence = '';

  for (let i = 0; i < sentences.length; i++) {
    const part = sentences[i];
    if (/[.?!]\s+$/.test(part)) {
      currentSentence += part;
      const trimmed = currentSentence.trim();
      const prevTrimmed = merged.length > 0 ? merged[merged.length - 1].trim() : '';
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

function detectHinglish(text: string): boolean {
  if (!text) return false;
  const hinglishKeywords = /\b(?:kya|haan|nahi|nahin|aur|kaise|kar|raha|rahi|sakta|sakti|hoon|hai|hain|tum|aap|mein|pe|bhi|bilkul|batao|theek|chalo|accha|achha)\b/i;
  return hinglishKeywords.test(text);
}

export interface SpeechPreparationOptions {
  language?: 'auto' | 'en' | 'hi' | 'hinglish';
}

export function prepareSpeechText(
  displayText: string,
  { language = 'auto' }: SpeechPreparationOptions = {}
): string {
  if (!displayText || typeof displayText !== 'string') {
    return '';
  }

  let text = displayText.trim();
  if (!text) return '';

  text = text.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/gi, '');
  text = text.replace(/<\/?(?:think|thought|reasoning)(?:\s+[^>]*)?>/gi, '');
  text = text.replace(/<\|(?:thought|endofthought|start_thought)\|>/gi, '');

  text = stripToolArtifacts(text);
  const isHinglish = language === 'hi' || language === 'hinglish' || detectHinglish(text);
  text = handleCodeBlocks(text, isHinglish);
  text = stripMarkdown(text);
  text = normalizeSpokenText(text);
  text = deduplicateSentences(text);

  return text.trim();
}
