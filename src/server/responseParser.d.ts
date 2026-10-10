export interface ParsedResponse {
  thought: string | null;
  answer: string;
  isThinking: boolean;
}

export function deduplicateAnswer(answer: string): string;

export function parseReasoningAndAnswer(
  rawContent: any,
  options?: { isStreaming?: boolean }
): ParsedResponse;

export { prepareSpeechText } from './speechPreparation.js';

