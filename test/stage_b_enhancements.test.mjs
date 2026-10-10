import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleApiRequest, extractTextFromContent } from '../src/server/apiRouter.js';
import { FreeLLMAPIProvider } from '../src/server/FreeLLMAPIProvider.js';

describe('Stage B Enhancements & Reliability Regression Tests', () => {
  let server;
  let port;
  let baseUrl;
  const testWorkspaceDir = path.resolve(process.cwd(), 'temp_enhancements_workspace_' + Date.now());

  before(async () => {
    if (!fs.existsSync(testWorkspaceDir)) {
      fs.mkdirSync(testWorkspaceDir, { recursive: true });
    }

    server = http.createServer(async (req, res) => {
      const handled = await handleApiRequest(req, res);
      if (!handled) {
        res.statusCode = 404;
        res.end('Not found');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Switch active workspace to testWorkspaceDir
    await fetch(`${baseUrl}/api/ide/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: testWorkspaceDir }),
    });
  });

  after(async () => {
    try {
      if (fs.existsSync(testWorkspaceDir)) {
        fs.rmSync(testWorkspaceDir, { recursive: true, force: true });
      }
    } catch {}

    await new Promise((resolve) => server.close(resolve));
  });

  describe('1. Workspace Freedom & Essential Safeguards', () => {
    it('creates and reads files in deeply nested subfolders with leading slash or relative paths', async () => {
      // Create subfolder structure
      const createRes = await fetch(`${baseUrl}/api/ide/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/deeply/nested/folder/config.json', isDir: false }),
      });
      assert.equal(createRes.status, 200);

      // Write content
      const writeRes = await fetch(`${baseUrl}/api/ide/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: '/deeply/nested/folder/config.json',
          content: '{"key": "workspace-freedom"}',
        }),
      });
      assert.equal(writeRes.status, 200);

      // Read content using both leading-slash and non-leading-slash
      const readRes = await fetch(`${baseUrl}/api/ide/read?path=/deeply/nested/folder/config.json`);
      assert.equal(readRes.status, 200);
      const readData = await readRes.json();
      assert.equal(readData.ok, true);
      assert.ok(readData.content.includes('workspace-freedom'));
    });

    it('reads image files and returns isImage flag and base64 dataUrl', async () => {
      // Create dummy 1x1 transparent PNG file
      const dummyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const dummyPngBuffer = Buffer.from(dummyPngBase64, 'base64');
      const imgPath = path.join(testWorkspaceDir, 'icon.png');
      fs.writeFileSync(imgPath, dummyPngBuffer);

      const res = await fetch(`${baseUrl}/api/ide/read?path=icon.png`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.isImage, true);
      assert.ok(data.dataUrl.startsWith('data:image/png;base64,'));
    });

    it('safeguard: blocks attempt to delete active workspace root', async () => {
      const deleteRootRes = await fetch(`${baseUrl}/api/ide/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '' }),
      });
      assert.equal(deleteRootRes.status, 400);
      const data = await deleteRootRes.json();
      assert.equal(data.ok, false);
      assert.ok(data.error.includes('Cannot delete'));
    });

    it('safeguard: blocks attempt to delete .git metadata directory', async () => {
      // Create dummy .git folder
      const gitDir = path.join(testWorkspaceDir, '.git');
      if (!fs.existsSync(gitDir)) fs.mkdirSync(gitDir);

      const deleteGitRes = await fetch(`${baseUrl}/api/ide/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.git' }),
      });
      assert.equal(deleteGitRes.status, 403);
      const data = await deleteGitRes.json();
      assert.equal(data.ok, false);
      assert.ok(data.error.includes('.git'));
    });
  });

  describe('2. Terminal Freedom & Destructive Safeguards', () => {
    it('allows safe terminal commands and returns exitCode 0', async () => {
      const res = await fetch(`${baseUrl}/api/ide/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'node -e "console.log(\'terminal-freedom-ok\')"' }),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.exitCode, 0);
      assert.ok(data.stdout.includes('terminal-freedom-ok'));
      assert.equal(path.resolve(data.cwd), testWorkspaceDir);
    });

    it('safeguard: blocks catastrophic drive formatting or root wipe commands', async () => {
      const dangerousCommands = [
        'format c:',
        'rm -rf /',
        'Remove-Item -Recurse -Force C:\\',
        'diskpart',
      ];

      for (const cmd of dangerousCommands) {
        const res = await fetch(`${baseUrl}/api/ide/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: cmd }),
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.ok, false);
        assert.ok(data.error.includes('blocked by safeguard'));
      }
    });
  });

  describe('3. Image Understanding & Vision Pipeline Support', () => {
    it('extractTextFromContent helper accurately extracts string from vision parts', () => {
      const stringContent = 'Explain this code';
      assert.equal(extractTextFromContent(stringContent), 'Explain this code');

      const partsContent = [
        { type: 'text', text: 'Look at this diagram' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,1234' } },
        { type: 'text', text: 'What does it illustrate?' },
      ];
      assert.equal(
        extractTextFromContent(partsContent),
        'Look at this diagram\nWhat does it illustrate?'
      );
    });

    it('FreeLLMAPIProvider accepts vision content parts array in message validation', () => {
      const provider = new FreeLLMAPIProvider();
      const visionMessages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is inside this image?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,1234' } },
          ],
        },
      ];
      assert.doesNotThrow(() => provider.validateMessages(visionMessages));
    });

    it('FreeLLMAPIProvider rejects malformed content parts', () => {
      const provider = new FreeLLMAPIProvider();
      assert.throws(
        () => provider.validateMessages([{ role: 'user', content: [] }]),
        /must not be empty/
      );
      assert.throws(
        () => provider.validateMessages([{ role: 'user', content: ['not-an-object'] }]),
        /must be an object with a "type"/
      );
    });
  });
});
