import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

async function testHeadlessChrome() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-test-'));
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${tmpDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  let wsUrl = '';

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for DevTools URL')), 10000);
    chromeProc.stderr.on('data', (data) => {
      const text = data.toString();
      const match = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-zA-Z0-9-]+)/);
      if (match) {
        wsUrl = match[1];
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((res) => ws.onopen = res);

  let msgId = 1;
  const pendingRequests = new Map();
  const sessionListeners = new Map();

  ws.onmessage = (evt) => {
    const data = JSON.parse(evt.data);
    if (data.id && pendingRequests.has(data.id)) {
      const { resolve, reject } = pendingRequests.get(data.id);
      pendingRequests.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
      return;
    }
    if (data.sessionId && data.method && sessionListeners.has(data.sessionId)) {
      const listeners = sessionListeners.get(data.sessionId);
      if (listeners.has(data.method)) {
        for (const cb of listeners.get(data.method)) {
          cb(data.params);
        }
      }
    }
  };

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  const { targetInfos } = await sendCommand('Target.getTargets');
  let targetId = targetInfos.find(t => t.type === 'page')?.targetId;
  if (!targetId) {
    const newTarget = await sendCommand('Target.createTarget', { url: 'about:blank' });
    targetId = newTarget.targetId;
  }

  const { sessionId } = await sendCommand('Target.attachToTarget', { targetId, flatten: true });
  sessionListeners.set(sessionId, new Map());
  function onSessionEvent(method, cb) {
    const map = sessionListeners.get(sessionId);
    if (!map.has(method)) map.set(method, []);
    map.get(method).push(cb);
  }

  function sendSessionCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, sessionId, method, params }));
    });
  }

  onSessionEvent('Runtime.consoleAPICalled', (params) => {
    console.log('[BROWSER CONSOLE]', params.type, params.args.map(a => a.value || a.description).join(' '));
  });
  onSessionEvent('Runtime.exceptionThrown', (params) => {
    console.error('[BROWSER EXCEPTION]', params.exceptionDetails.text, params.exceptionDetails.exception?.description);
  });

  await sendSessionCommand('Page.enable');
  await sendSessionCommand('Runtime.enable');

  const loadedPromise = new Promise(resolve => {
    onSessionEvent('Page.loadEventFired', resolve);
  });

  console.log('Navigating to http://localhost:5174/ ...');
  await sendSessionCommand('Page.navigate', { url: 'http://localhost:5174/' });
  await loadedPromise;
  console.log('Page load event fired!');

  // Wait until input element appears
  console.log('Waiting for React root to mount input element...');
  for (let i = 0; i < 30; i++) {
    const check = await sendSessionCommand('Runtime.evaluate', {
      expression: 'Boolean(document.querySelector("input"))',
    });
    if (check?.result?.value === true) break;
    await new Promise(r => setTimeout(r, 500));
  }

  // Wait 1.5s for initial health check to complete
  await new Promise(r => setTimeout(r, 1500));

  const initialText = await sendSessionCommand('Runtime.evaluate', {
    expression: 'document.body.innerText',
  });
  console.log('\n--- INITIAL PAGE TEXT ---\n', initialText?.result?.value);

  // Type into input and send
  console.log('Simulating chat message send: "Hello" ...');
  await sendSessionCommand('Runtime.evaluate', {
    expression: `
      (() => {
        const input = document.querySelector('input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'Hello');
        input.dispatchEvent(new Event('input', { bubbles: true }));

        const buttons = Array.from(document.querySelectorAll('button'));
        const sendBtn = buttons.find(b => b.title === 'Send message');
        if (sendBtn) {
          sendBtn.click();
          return 'clicked-send-btn';
        }
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return 'dispatched-enter';
      })()
    `,
  });

  // Poll for assistant bubble response from FreeLLMAPI
  let finalAssistantMessage = '';
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const bubblesEval = await sendSessionCommand('Runtime.evaluate', {
      expression: `
        (() => {
          const bubbles = Array.from(document.querySelectorAll('.rounded-2xl.text-sm'));
          return bubbles.map(b => b.innerText);
        })()
      `,
      returnByValue: true,
    });
    const bubbles = bubblesEval?.result?.value || [];
    console.log(`[T+${i + 1}s] Message bubbles count: ${bubbles.length}`);
    bubbles.forEach((b, idx) => console.log(`   Bubble [${idx}]: "${b.replace(/\r?\n/g, ' ')}"`));

    if (bubbles.length >= 3) {
      // Bubble 0: initial assistant greeting
      // Bubble 1: user "Hello"
      // Bubble 2: assistant response from FreeLLMAPI
      const assistantReply = bubbles[bubbles.length - 1];
      if (
        assistantReply &&
        !assistantReply.toLowerCase().includes('thinking') &&
        !assistantReply.toLowerCase().includes('formulating') &&
        assistantReply.trim().length > 0
      ) {
        finalAssistantMessage = assistantReply;
        break;
      }
    }
  }

  // Clean up
  ws.close();
  chromeProc.kill();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}

  console.log('\n=============================================');
  console.log('FINAL CHAT ASSISTANT RESPONSE VISIBLE IN UI:');
  console.log(finalAssistantMessage);
  console.log('=============================================\n');

  if (finalAssistantMessage && !finalAssistantMessage.includes('⚠️')) {
    console.log('🎉 SUCCESS: Full round-trip verified: UI -> FreeLLMAPI -> Remote Model -> UI streaming!');
    process.exit(0);
  } else {
    console.error('❌ FAILURE: Model response was empty or error:', finalAssistantMessage);
    process.exit(1);
  }
}

testHeadlessChrome().catch(err => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
