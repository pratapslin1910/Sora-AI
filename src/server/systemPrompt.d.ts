export const SORA_PROMPT_VERSION: string;
export const SORA_CORE_IDENTITY: string;

export interface MemoryConflictItem {
  id?: string;
  type?: string;
  title?: string;
  content: string;
  overridden?: boolean;
  [key: string]: any;
}

export function resolveConflictingMemories(
  memories?: MemoryConflictItem[]
): MemoryConflictItem[];

export interface BuildSystemPromptOptions {
  clientSystemPrompt?: string;
  recalledContext?: string;
  currentModel?: string;
  userPreferences?: string;
}

export function buildSystemPrompt(options?: BuildSystemPromptOptions): string;
