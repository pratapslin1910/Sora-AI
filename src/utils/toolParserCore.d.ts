/**
 * Type declarations for the shared JavaScript tool-call parser core.
 * Keep this contract aligned with src/utils/toolParserCore.js.
 */
export interface ParsedToolCall {
  tool: string;
  args: Record<string, any>;
  rawBlock: string;
}

export function parseToolCallsFromText(text: string): ParsedToolCall[];
export function parseToolCallFromText(text: string): ParsedToolCall | null;
export function stripToolCallsFromText(text: string): string;
export function sanitizeContentForModel(content: string): string;
