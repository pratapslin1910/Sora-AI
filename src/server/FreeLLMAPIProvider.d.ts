/**
 * Type declarations for FreeLLMAPIProvider (JS class).
 */

export declare class FreeLLMAPIProvider {
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  timeoutMs: number;

  constructor(config?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
  });

  formatError(err: unknown): string;

  checkHealth(): Promise<{
    ok: boolean;
    status: string;
    baseUrl: string;
    model: string;
    availableModels?: string[];
    error?: string;
    apiKeyConfigured: boolean;
  }>;

  getModels(): Promise<string[]>;

  validateMessages(messages: Array<{ role: string; content: string }>): void;

  chat(options: {
    messages: Array<{ role: string; content: string }>;
    model?: string;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{ role: string; content: string; model: string; usage?: unknown }>;

  streamChat(options: {
    messages: Array<{ role: string; content: string }>;
    model?: string;
    temperature?: number;
    signal?: AbortSignal;
    onToken?: (token: string) => void;
    onDone?: () => void;
    onError?: (err: Error) => void;
  }): Promise<string>;
}
