/**
 * Format-Aware Response & Reasoning Parser
 *
 * Responsibilities:
 * - Separates internal reasoning/thinking channels from user-facing answers.
 * - Format-aware: preserves legitimate tags inside markdown code blocks (fenced & inline).
 * - Handles in-progress streaming where <think> is not yet closed without leaking
 *   unclosed tags or private reasoning into the user's answer.
 * - Cleans stray internal control tokens (</think>, <think>, <thought>, <|thought|>, etc.).
 * - Detects and prevents duplicate final answers for a single turn.
 */

/**
 * Control tokens that should never be shown in final user answers outside code blocks.
 */
const CONTROL_TOKEN_REGEX = /<\/?(?:think|thought|reasoning)(?:\s+[^>]*)?>|<\|(?:thought|endofthought|start_thought)\|>/gi;

/**
 * Splits text into segments: code blocks (preserved as-is) and prose text.
 * @param {string} text
 * @returns {Array<{ type: 'code' | 'prose', content: string }>}
 */
function segmentMarkdownText(text) {
  if (!text) return [];

  const segments = [];
  // Match fenced code blocks ```...``` or inline code `...`
  const codeBlockRegex = /(```[\s\S]*?```|`[^`\n]+`)/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'prose',
        content: text.slice(lastIndex, match.index),
      });
    }
    segments.push({
      type: 'code',
      content: match[0],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: 'prose',
      content: text.slice(lastIndex),
    });
  }

  return segments;
}

/**
 * Deduplicate repeated identical answer text blocks.
 * @param {string} answer
 * @returns {string}
 */
export function deduplicateAnswer(answer) {
  if (!answer || typeof answer !== 'string') return '';
  const trimmed = answer.trim();
  if (trimmed.length < 20) return answer;

  // Check if answer is literally duplicated with newline separator
  const parts = trimmed.split(/\n\s*\n/);
  if (parts.length === 2 && parts[0].trim() === parts[1].trim()) {
    return parts[0].trim();
  }

  // Check if answer has two exact identical halves
  const halfLen = Math.floor(trimmed.length / 2);
  const firstHalf = trimmed.slice(0, halfLen).trim();
  const secondHalf = trimmed.slice(halfLen).trim();
  if (firstHalf && firstHalf === secondHalf) {
    return firstHalf;
  }

  return answer;
}

/**
 * Parse reasoning/thinking tokens and user-facing answers with format awareness.
 *
 * @param {string|any} rawContent The raw text from the model
 * @param {Object} [options]
 * @param {boolean} [options.isStreaming=false] Whether streaming is currently active
 * @returns {{ thought: string | null, answer: string, isThinking: boolean }}
 */
export function parseReasoningAndAnswer(rawContent, { isStreaming = false } = {}) {
  let text = '';
  if (typeof rawContent === 'string') {
    text = rawContent;
  } else if (Array.isArray(rawContent)) {
    text = rawContent
      .filter((p) => p && (p.type === 'text' || typeof p.text === 'string'))
      .map((p) => p.text || '')
      .join('\n');
  } else if (rawContent !== null && rawContent !== undefined) {
    text = String(rawContent);
  }

  if (!text) {
    return { thought: null, answer: '', isThinking: false };
  }

  const segments = segmentMarkdownText(text);
  const thoughts = [];
  const answerParts = [];
  let isCurrentlyThinking = false;
  let inOpenThinkTag = false;

  for (const seg of segments) {
    if (seg.type === 'code') {
      // Code segments are NEVER stripped of internal tags; preserve verbatim
      if (!inOpenThinkTag) {
        answerParts.push(seg.content);
      } else {
        thoughts.push(seg.content);
      }
      continue;
    }

    // In prose segments, look for <think>...</think> or <thought>...</thought> blocks
    let prose = seg.content;

    // If we were previously inside an unclosed think tag:
    if (inOpenThinkTag) {
      const closeMatch = prose.match(/<\/(?:think|thought)>/i);
      if (closeMatch) {
        const closeIdx = closeMatch.index;
        const thoughtContent = prose.slice(0, closeIdx);
        if (thoughtContent.trim()) {
          thoughts.push(thoughtContent.trim());
        }
        prose = prose.slice(closeIdx + closeMatch[0].length);
        inOpenThinkTag = false;
      } else {
        // Still inside unclosed think tag
        if (prose.trim()) {
          thoughts.push(prose.trim());
        }
        isCurrentlyThinking = true;
        continue;
      }
    }

    // Now process closed <think>...</think> blocks in the remaining prose
    const thinkBlockRegex = /<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/gi;
    let lastIdx = 0;
    let match;

    while ((match = thinkBlockRegex.exec(prose)) !== null) {
      // Text before <think> is part of answer
      const preText = prose.slice(lastIdx, match.index);
      if (preText) {
        answerParts.push(preText);
      }
      const thoughtText = match[1]?.trim();
      if (thoughtText) {
        thoughts.push(thoughtText);
      }
      lastIdx = match.index + match[0].length;
    }

    const remainingProse = prose.slice(lastIdx);

    // Check for an OPEN <think> tag that has not been closed yet (common during streaming)
    const openThinkMatch = remainingProse.match(/<(?:think|thought)>/i);
    if (openThinkMatch) {
      const preText = remainingProse.slice(0, openThinkMatch.index);
      if (preText) {
        answerParts.push(preText);
      }
      const thoughtContent = remainingProse.slice(openThinkMatch.index + openThinkMatch[0].length);
      if (thoughtContent.trim()) {
        thoughts.push(thoughtContent.trim());
      }
      inOpenThinkTag = true;
      isCurrentlyThinking = true;
    } else {
      // Strip any stray control tokens outside code blocks from the user-facing text
      const cleanedRemaining = remainingProse.replace(CONTROL_TOKEN_REGEX, '');
      if (cleanedRemaining) {
        answerParts.push(cleanedRemaining);
      }
    }
  }

  // Combine thoughts and answers
  const joinedThought = thoughts.filter(Boolean).join('\n\n').trim();
  let finalAnswer = answerParts.join('').trim();

  // Deduplicate answer if identical
  finalAnswer = deduplicateAnswer(finalAnswer);

  return {
    thought: joinedThought || null,
    answer: finalAnswer,
    isThinking: inOpenThinkTag || (isStreaming && !finalAnswer && Boolean(joinedThought)),
  };
}

export { prepareSpeechText } from './speechPreparation.js';

