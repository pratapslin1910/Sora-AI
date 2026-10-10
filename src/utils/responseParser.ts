/**
 * Frontend Format-Aware Response & Reasoning Parser
 *
 * Separates internal reasoning/thinking channels from user-facing answers,
 * preserves tags inside markdown code blocks, cleanly handles in-progress
 * streaming where <think> is not yet closed, and prevents duplicate answers.
 */

const CONTROL_TOKEN_REGEX = /<\/?(?:think|thought|reasoning)(?:\s+[^>]*)?>|<\|(?:thought|endofthought|start_thought)\|>/gi;

function segmentMarkdownText(text: string): Array<{ type: 'code' | 'prose'; content: string }> {
  if (!text) return [];

  const segments: Array<{ type: 'code' | 'prose'; content: string }> = [];
  const codeBlockRegex = /(```[\s\S]*?```|`[^`\n]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

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

export function deduplicateAnswer(answer: string): string {
  if (!answer || typeof answer !== 'string') return '';
  const trimmed = answer.trim();
  if (trimmed.length < 20) return answer;

  const parts = trimmed.split(/\n\s*\n/);
  if (parts.length === 2 && parts[0].trim() === parts[1].trim()) {
    return parts[0].trim();
  }

  const halfLen = Math.floor(trimmed.length / 2);
  const firstHalf = trimmed.slice(0, halfLen).trim();
  const secondHalf = trimmed.slice(halfLen).trim();
  if (firstHalf && firstHalf === secondHalf) {
    return firstHalf;
  }

  return answer;
}

export interface ParsedResponse {
  thought: string | null;
  answer: string;
  isThinking: boolean;
}

export function parseReasoningAndAnswer(
  rawContent: any,
  { isStreaming = false }: { isStreaming?: boolean } = {}
): ParsedResponse {
  let text = '';
  if (typeof rawContent === 'string') {
    text = rawContent;
  } else if (Array.isArray(rawContent)) {
    text = rawContent
      .filter((p: any) => p && (p.type === 'text' || typeof p.text === 'string'))
      .map((p: any) => p.text || '')
      .join('\n');
  } else if (rawContent !== null && rawContent !== undefined) {
    text = String(rawContent);
  }

  if (!text) {
    return { thought: null, answer: '', isThinking: false };
  }

  const segments = segmentMarkdownText(text);
  const thoughts: string[] = [];
  const answerParts: string[] = [];
  let inOpenThinkTag = false;

  for (const seg of segments) {
    if (seg.type === 'code') {
      if (!inOpenThinkTag) {
        answerParts.push(seg.content);
      } else {
        thoughts.push(seg.content);
      }
      continue;
    }

    let prose = seg.content;

    if (inOpenThinkTag) {
      const closeMatch = prose.match(/<\/(?:think|thought)>/i);
      if (closeMatch && closeMatch.index !== undefined) {
        const closeIdx = closeMatch.index;
        const thoughtContent = prose.slice(0, closeIdx);
        if (thoughtContent.trim()) {
          thoughts.push(thoughtContent.trim());
        }
        prose = prose.slice(closeIdx + closeMatch[0].length);
        inOpenThinkTag = false;
      } else {
        if (prose.trim()) {
          thoughts.push(prose.trim());
        }
        continue;
      }
    }

    const thinkBlockRegex = /<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/gi;
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = thinkBlockRegex.exec(prose)) !== null) {
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
    const openThinkMatch = remainingProse.match(/<(?:think|thought)>/i);
    if (openThinkMatch && openThinkMatch.index !== undefined) {
      const preText = remainingProse.slice(0, openThinkMatch.index);
      if (preText) {
        answerParts.push(preText);
      }
      const thoughtContent = remainingProse.slice(openThinkMatch.index + openThinkMatch[0].length);
      if (thoughtContent.trim()) {
        thoughts.push(thoughtContent.trim());
      }
      inOpenThinkTag = true;
    } else {
      const cleanedRemaining = remainingProse.replace(CONTROL_TOKEN_REGEX, '');
      if (cleanedRemaining) {
        answerParts.push(cleanedRemaining);
      }
    }
  }

  const joinedThought = thoughts.filter(Boolean).join('\n\n').trim();
  let finalAnswer = answerParts.join('').trim();
  finalAnswer = deduplicateAnswer(finalAnswer);

  return {
    thought: joinedThought || null,
    answer: finalAnswer,
    isThinking: inOpenThinkTag || (isStreaming && !finalAnswer && Boolean(joinedThought)),
  };
}

export { prepareSpeechText } from './speechPreparation';

