import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {
  isSensitiveWorkspacePath,
  requiresWorkspaceOperationConfirmation,
  shouldRequireConfirmationForDelete,
} from '../src/server/fileOperationPolicy.js';

describe('workspace file operation policy', () => {
  it('recognizes environment files and credential/settings paths', () => {
    assert.equal(isSensitiveWorkspacePath('.env'), true);
    assert.equal(isSensitiveWorkspacePath('.env.production'), true);
    assert.equal(isSensitiveWorkspacePath('data/sora_settings.json'), true);
    assert.equal(isSensitiveWorkspacePath('config/apiKey.json'), true);
    assert.equal(isSensitiveWorkspacePath('src/App.tsx'), false);
  });

  it('requires confirmation for JSON and sensitive configuration overwrites', () => {
    assert.equal(requiresWorkspaceOperationConfirmation({
      operation: 'write', relativePath: 'config.json', existingContent: '{"x":1}', newContent: '{"x":2}',
    }), true);
    assert.equal(requiresWorkspaceOperationConfirmation({
      operation: 'write', relativePath: '.env', existingContent: 'API_KEY=secret', newContent: 'API_KEY=',
    }), true);
  });

  it('requires confirmation for empty and unusually destructive rewrites', () => {
    assert.equal(requiresWorkspaceOperationConfirmation({
      operation: 'write', relativePath: 'notes.txt', existingContent: 'important text', newContent: '',
    }), true);
    assert.equal(requiresWorkspaceOperationConfirmation({
      operation: 'write', relativePath: 'large.ts', existingContent: 'x'.repeat(1000), newContent: 'short',
    }), true);
  });

  it('requires confirmation for every rename/delete and specially identifies JSON deletion', () => {
    assert.equal(requiresWorkspaceOperationConfirmation({ operation: 'delete', relativePath: 'src/App.tsx' }), true);
    assert.equal(requiresWorkspaceOperationConfirmation({ operation: 'rename', relativePath: 'src/App.tsx' }), true);
    assert.equal(shouldRequireConfirmationForDelete('config.json'), true);
    assert.equal(shouldRequireConfirmationForDelete('.env.local'), true);
    assert.equal(shouldRequireConfirmationForDelete('src/App.tsx'), false);
  });
});

describe('IDE API refuses unconfirmed destructive file operations', () => {
  let server;
  let baseUrl;
  let workspace;

  async function post(route, body) {
    const res = await fetch(baseUrl + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }

  before(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sora-file-guard-'));
    const { handleApiRequest } = await import('../src/server/apiRouter.js');
    server = http.createServer(async (req, res) => {
      const handled = await handleApiRequest(req, res);
      if (!handled) { res.statusCode = 404; res.end('Not found'); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = 'http://127.0.0.1:' + server.address().port;
    const switched = await post('/api/ide/workspace', { path: workspace });
    assert.equal(switched.data.ok, true);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('refuses an unconfirmed overwrite of JSON settings and preserves original bytes', async () => {
    const original = JSON.stringify({ apiKey: 'keep-me', baseUrl: 'http://localhost:31415/v1' });
    fs.writeFileSync(path.join(workspace, 'config.json'), original);
    const response = await post('/api/ide/write', {
      path: 'config.json', content: JSON.stringify({ model: 'new-model' }),
    });
    assert.equal(response.status, 409);
    assert.equal(response.data.requiresConfirmation, true);
    assert.equal(fs.readFileSync(path.join(workspace, 'config.json'), 'utf8'), original);
  });

  it('rejects implicit empty content instead of clearing an existing file', async () => {
    const original = 'keep this content';
    fs.writeFileSync(path.join(workspace, 'notes.txt'), original);
    const response = await post('/api/ide/write', { path: 'notes.txt' });
    assert.equal(response.status, 400);
    assert.equal(fs.readFileSync(path.join(workspace, 'notes.txt'), 'utf8'), original);
  });

  it('refuses unconfirmed JSON deletion and keeps the file intact', async () => {
    const target = path.join(workspace, 'settings.json');
    fs.writeFileSync(target, '{"apiKey":"keep-me"}');
    const response = await post('/api/ide/delete', { path: 'settings.json' });
    assert.equal(response.status, 409);
    assert.equal(response.data.requiresConfirmation, true);
    assert.equal(fs.existsSync(target), true);
  });

  it('refuses unconfirmed rename and preserves the source path', async () => {
    const target = path.join(workspace, 'keep.txt');
    fs.writeFileSync(target, 'keep');
    const response = await post('/api/ide/rename', { oldPath: 'keep.txt', newPath: 'moved.txt' });
    assert.equal(response.status, 409);
    assert.equal(fs.existsSync(target), true);
    assert.equal(fs.existsSync(path.join(workspace, 'moved.txt')), false);
  });

  it('allows a confirmed JSON update and confirmed delete', async () => {
    const target = path.join(workspace, 'confirmed.json');
    fs.writeFileSync(target, '{"apiKey":"old"}');
    const write = await post('/api/ide/write', {
      path: 'confirmed.json', content: '{"apiKey":"new"}', confirmed: true,
    });
    assert.equal(write.data.ok, true);
    assert.equal(fs.readFileSync(target, 'utf8'), '{"apiKey":"new"}');
    const del = await post('/api/ide/delete', { path: 'confirmed.json', confirmed: true });
    assert.equal(del.data.ok, true);
    assert.equal(fs.existsSync(target), false);
  });
});
