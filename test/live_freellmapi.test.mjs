import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FreeLLMAPIProvider } from '../src/server/FreeLLMAPIProvider.js';

// Load .env manually for standalone test runner
function loadEnvFile() {
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        if (process.env[k] === undefined) {
          process.env[k] = v;
        }
      }
    }
  }
}

loadEnvFile();

describe('Real Live FreeLLMAPI Integration Test', () => {
  const provider = new FreeLLMAPIProvider();

  it('connects to live gateway and performs health check', async () => {
    const health = await provider.checkHealth();
    assert.equal(health.ok, true, `Health check failed: ${health.error}`);
    assert.equal(health.status, 'connected');
    assert.equal(health.apiKeyConfigured, true);
    assert.ok(health.availableModels.length > 0, 'Should have available models');
    console.log(`[LIVE TEST] Gateway connected at: ${health.baseUrl}`);
    console.log(`[LIVE TEST] Available models count: ${health.availableModels.length}`);
  });

  it('performs live chat streaming end-to-end', async () => {
    const tokens = [];
    let completed = false;

    const fullResponse = await provider.streamChat({
      messages: [
        { role: 'user', content: 'Say "FreeLLMAPI connection verified" in under 10 words.' }
      ],
      onToken: (tok) => {
        tokens.push(tok);
      },
      onDone: () => {
        completed = true;
      },
    });

    assert.equal(completed, true, 'Stream should finish successfully');
    assert.ok(tokens.length > 0, 'Should have received streamed tokens');
    assert.ok(fullResponse.trim().length > 0, 'Should have accumulated text');
    console.log(`[LIVE TEST] Streamed tokens count: ${tokens.length}`);
    console.log(`[LIVE TEST] Model response: "${fullResponse.trim()}"`);
  });
});
