import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handleApiRequest } from '../src/server/apiRouter.js';

describe('IDE & Workspace Endpoints Tests', () => {
  let server;
  let port;
  let baseUrl;
  const testDir = path.resolve(process.cwd(), 'temp_test_workspace_' + Date.now());

  before(async () => {
    // Setup temporary test workspace directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
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
  });

  after(async () => {
    // Clean up temporary workspace directory
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}

    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /api/ide/info returns current workspace information', async () => {
    const res = await fetch(`${baseUrl}/api/ide/info`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(data.workspaceRoot);
    assert.ok(data.platform);
  });

  it('POST /api/ide/workspace switches workspace directory and GET /api/ide/list inspects it', async () => {
    // Switch to testDir
    const switchRes = await fetch(`${baseUrl}/api/ide/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: testDir }),
    });
    assert.equal(switchRes.status, 200);
    const switchData = await switchRes.json();
    assert.equal(switchData.ok, true);
    assert.equal(path.resolve(switchData.workspaceRoot), testDir);

    // List empty directory
    const listRes = await fetch(`${baseUrl}/api/ide/list`);
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.ok, true);
    assert.equal(listData.items.length, 0);
  });

  it('POST /api/ide/create creates files and directories, and /api/ide/read reads content', async () => {
    // Create directory
    const dirRes = await fetch(`${baseUrl}/api/ide/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'src', isDir: true }),
    });
    assert.equal(dirRes.status, 200);

    // Create file
    const fileRes = await fetch(`${baseUrl}/api/ide/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'src/index.ts', isDir: false }),
    });
    assert.equal(fileRes.status, 200);

    // Write content
    const writeRes = await fetch(`${baseUrl}/api/ide/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'src/index.ts',
        content: 'export const hello = "Sora AI IDE";',
      }),
    });
    assert.equal(writeRes.status, 200);

    // Read file
    const readRes = await fetch(`${baseUrl}/api/ide/read?path=src/index.ts`);
    assert.equal(readRes.status, 200);
    const readData = await readRes.json();
    assert.equal(readData.ok, true);
    assert.equal(readData.content, 'export const hello = "Sora AI IDE";');
  });

  it('POST /api/ide/rename renames files and POST /api/ide/delete removes files', async () => {
    // Rename file
    const renameRes = await fetch(`${baseUrl}/api/ide/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldPath: 'src/index.ts',
        newPath: 'src/main.ts',
      }),
    });
    assert.equal(renameRes.status, 200);
    const renameData = await renameRes.json();
    assert.equal(renameData.ok, true);

    // Verify new file exists and old is gone
    const readNewRes = await fetch(`${baseUrl}/api/ide/read?path=src/main.ts`);
    assert.equal(readNewRes.status, 200);
    const readNewData = await readNewRes.json();
    assert.equal(readNewData.content, 'export const hello = "Sora AI IDE";');

    const readOldRes = await fetch(`${baseUrl}/api/ide/read?path=src/index.ts`);
    assert.equal(readOldRes.status, 404);

    // Delete file
    const deleteRes = await fetch(`${baseUrl}/api/ide/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'src/main.ts' }),
    });
    assert.equal(deleteRes.status, 200);

    const checkDelete = await fetch(`${baseUrl}/api/ide/read?path=src/main.ts`);
    assert.equal(checkDelete.status, 404);
  });

  it('POST /api/ide/exec executes commands in active workspace', async () => {
    const execRes = await fetch(`${baseUrl}/api/ide/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo "Sora Terminal OK"' }),
    });
    assert.equal(execRes.status, 200);
    const execData = await execRes.json();
    assert.equal(execData.ok, true);
    assert.match(execData.stdout, /Sora Terminal OK/);
    assert.equal(execData.exitCode, 0);
  });

  it('GET /api/ide/search searches files in active workspace', async () => {
    // Write sample searchable file
    await fetch(`${baseUrl}/api/ide/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'search_sample.ts',
        content: 'const antigravityAwesomeAgent = 42;\nexport default antigravityAwesomeAgent;',
      }),
    });

    const searchRes = await fetch(`${baseUrl}/api/ide/search?q=antigravityAwesomeAgent`);
    assert.equal(searchRes.status, 200);
    const searchData = await searchRes.json();
    assert.equal(searchData.ok, true);
    assert.ok(searchData.matches.length > 0);
    assert.match(searchData.matches[0].text, /antigravityAwesomeAgent/);
  });
});
