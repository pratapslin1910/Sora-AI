/**
 * Typed TypeScript facade for the shared tool-call parser core.
 * Supports JSON <tool_call> blocks and XML-style Dots/Invoke calls.
 */
export interface ParsedToolCall {
  tool: string;
  args: Record<string, any>;
  rawBlock: string;
}

export {
  parseToolCallFromText,
  parseToolCallsFromText,
  stripToolCallsFromText,
  sanitizeContentForModel,
} from './toolParserCore.js';
