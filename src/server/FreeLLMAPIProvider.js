/**
 * FreeLLMAPI Remote LLM Provider
 * Handles communication with the local FreeLLMAPI gateway (OpenAI-compatible).
 * Encapsulates authentication, model discovery, error normalization, and streaming.
 */

export class FreeLLMAPIProvider {
  /**
   * @param {Object} [config]
   * @param {string} [config.baseUrl] Gateway base URL (defaults to process.env.FREELLMAPI_BASE_URL or http://127.0.0.1:31415/v1)
   * @param {string} [config.apiKey] API key (defaults to process.env.FREELLMAPI_API_KEY)
   * @param {string} [config.model] Default model (defaults to process.env.FREELLMAPI_MODEL or 'auto')
   * @param {number} [config.timeoutMs] Request timeout in ms (default 60000)
   */
  constructor(config = {}) {
    const rawUrl = config.baseUrl || process.env.FREELLMAPI_BASE_URL || 'http://127.0.0.1:31415/v1';
    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey !== undefined ? config.apiKey : (process.env.FREELLMAPI_API_KEY || '');
    this.defaultModel = config.model || process.env.FREELLMAPI_MODEL || 'auto';
    this.timeoutMs = config.timeoutMs || 60000;
  }

  /**
   * Sanitize error message to prevent leaking sensitive details
   * @param {Error|any} err
   * @returns {string}
   */
  formatError(err) {
    if (!err) return 'An unknown error occurred while communicating with FreeLLMAPI.';

    const msg = String(err.message || err);

    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('Failed to fetch')) {
      return `FreeLLMAPI is unreachable. Make sure the FreeLLMAPI gateway is running on ${this.baseUrl}.`;
    }
    if (msg.includes('401') || msg.includes('Invalid API key') || msg.includes('authentication_error')) {
      return 'Invalid API key. Please check your FREELLMAPI_API_KEY environment variable.';
    }
    if (msg.includes('429') || msg.includes('Too Many Requests')) {
      return 'Rate limit exceeded on FreeLLMAPI upstream provider. Please try another model or try again later.';
    }
    if (msg.includes('404') || msg.includes('Not Found')) {
      return `FreeLLMAPI endpoint or model not found on ${this.baseUrl}.`;
    }
    if (msg.includes('timeout') || msg.includes('The operation was aborted')) {
      return 'Request to FreeLLMAPI timed out. The model took too long to respond.';
    }

    return msg;
  }

  /**
   * Check connection and authentication health
   * @returns {Promise<{ ok: boolean, status: string, baseUrl: string, model: string, availableModels?: string[], error?: string, apiKeyConfigured: boolean }>}
   */
  async checkHealth() {
    const apiKeyConfigured = Boolean(this.apiKey && this.apiKey.trim().length > 0);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 8000));

      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        let errMsg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(errBody);
          errMsg = parsed.error?.message || errMsg;
        } catch {
          // use status
        }
        throw new Error(errMsg);
      }

      const data = await res.json();
      const models = Array.isArray(data?.data) ? data.data.map((m) => m.id) : [];

      return {
        ok: true,
        status: 'connected',
        baseUrl: this.baseUrl,
        model: this.defaultModel,
        availableModels: models,
        apiKeyConfigured,
      };
    } catch (err) {
      return {
        ok: false,
        status: 'error',
        baseUrl: this.baseUrl,
        model: this.defaultModel,
        error: this.formatError(err),
        apiKeyConfigured,
      };
    }
  }

  /**
   * Retrieve list of models from FreeLLMAPI
   * @returns {Promise<string[]>}
   */
  async getModels() {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch models (${res.status}): ${text}`);
      }

      const data = await res.json();
      return Array.isArray(data?.data) ? data.data.map((m) => m.id) : [];
    } catch (err) {
      throw new Error(this.formatError(err));
    }
  }

  /**
   * Validate messages list
   * @param {Array<{ role: string, content: string }>} messages
   */
  validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages must be a non-empty array of message objects.');
    }
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') {
        throw new Error('Each message must be an object with "role" and "content".');
      }
      if (!msg.role || typeof msg.role !== 'string') {
        throw new Error('Message "role" is required.');
      }
      if (typeof msg.content !== 'string') {
        throw new Error('Message "content" must be a string.');
      }
    }
  }

  /**
   * Non-streaming chat completion
   * @param {Object} options
   * @param {Array<{ role: string, content: string }>} options.messages
   * @param {string} [options.model]
   * @param {number} [options.temperature]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ role: string, content: string, model: string, usage?: any }>}
   */
  async chat({ messages, model, temperature, signal } = {}) {
    this.validateMessages(messages);
    const chosenModel = model || this.defaultModel;

    const payload = {
      model: chosenModel,
      messages,
      stream: false,
    };
    if (typeof temperature === 'number') {
      payload.temperature = temperature;
    }

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let errMsg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(text);
          errMsg = parsed.error?.message || errMsg;
        } catch {
          // fallback
        }
        throw new Error(errMsg);
      }

      const data = await res.json();
      const choice = data?.choices?.[0];
      const assistantMessage = choice?.message || { role: 'assistant', content: '' };

      return {
        role: assistantMessage.role || 'assistant',
        content: assistantMessage.content || '',
        model: data?.model || chosenModel,
        usage: data?.usage,
      };
    } catch (err) {
      throw new Error(this.formatError(err));
    }
  }

  /**
   * Stream chat completion with callbacks
   * @param {Object} options
   * @param {Array<{ role: string, content: string }>} options.messages
   * @param {string} [options.model]
   * @param {number} [options.temperature]
   * @param {AbortSignal} [options.signal]
   * @param {function(string): void} [options.onToken] Callback when a content token chunk arrives
   * @param {function(): void} [options.onDone] Callback when stream finishes
   * @param {function(Error): void} [options.onError] Callback when error occurs
   * @returns {Promise<string>} Full accumulated content
   */
  async streamChat({
    messages,
    model,
    temperature,
    signal,
    onToken = () => {},
    onDone = () => {},
    onError = () => {},
  } = {}) {
    this.validateMessages(messages);
    const chosenModel = model || this.defaultModel;

    const payload = {
      model: chosenModel,
      messages,
      stream: true,
    };
    if (typeof temperature === 'number') {
      payload.temperature = temperature;
    }

    let fullText = '';

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let errMsg = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(text);
          errMsg = parsed.error?.message || errMsg;
        } catch {
          // fallback
        }
        throw new Error(errMsg);
      }

      if (!res.body) {
        throw new Error('Response body is null, cannot stream.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') {
              continue;
            }

            try {
              const chunkJson = JSON.parse(dataStr);
              const delta = chunkJson?.choices?.[0]?.delta;
              if (delta?.content) {
                fullText += delta.content;
                onToken(delta.content);
              }
            } catch {
              // Ignore malformed chunk json and continue stream
            }
          }
        }
      }

      // Flush remaining buffer if any
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr !== '[DONE]') {
            try {
              const chunkJson = JSON.parse(dataStr);
              const delta = chunkJson?.choices?.[0]?.delta;
              if (delta?.content) {
                fullText += delta.content;
                onToken(delta.content);
              }
            } catch {
              // ignore
            }
          }
        }
      }

      onDone();
      return fullText;
    } catch (err) {
      // Only call onError if the request was not intentionally aborted
      if (signal && signal.aborted) {
        return fullText;
      }
      const formattedMsg = this.formatError(err);
      onError(new Error(formattedMsg));
      throw new Error(formattedMsg);
    }
  }
}
