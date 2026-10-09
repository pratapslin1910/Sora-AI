/**
 * Type declarations for the FreeLLMAPI server-side API router.
 * Consumed by vite.config.ts at build/dev time.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FreeLLMAPIProvider } from './FreeLLMAPIProvider.js';

export declare function getProvider(): FreeLLMAPIProvider;
export declare function setProvider(provider: FreeLLMAPIProvider): void;
export declare function parseJsonBody(req: IncomingMessage): Promise<unknown>;
export declare function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  customProvider?: FreeLLMAPIProvider
): Promise<boolean>;
