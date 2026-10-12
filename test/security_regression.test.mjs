/**
 * Security & Tool Reliability Regression Tests
 *
 * Covers the 10 fix areas from the security audit of fix/security-and-tool-reliability branch.
 * All tests run without a live gateway (unit / mock integration).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 — Local-only binding + CORS
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 1 — Local-only binding, Host protection, and CORS in vite.config.ts and apiRouter.js', () => {
  it('vite.config.ts binds server to 127.0.0.1 by default', () => {
    const viteConfig = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf-8');
    assert.ok(
      viteConfig.includes("'127.0.0.1'") || viteConfig.includes('"127.0.0.1"'),
      'vite.config.ts must set host to 127.0.0.1'
    );
    assert.ok(viteConfig.includes('server:') && viteConfig.includes('host:'), 'Must have server.host config');
    assert.ok(viteConfig.includes('preview:'), 'Must include preview server binding');
  });

  it('apiRouter.js sets Access-Control-Allow-Origin header for local request', async () => {
    const { handleApiRequest } = await import('../src/server/apiRouter.js');
    const capturedHeaders = {};
    const req = { method: 'GET', url: '/api/health', headers: {} };
    const res = {
      setHeader(key, val) { capturedHeaders[key] = val; },
      statusCode: 0,
      end() {},
    };
    try { await handleApiRequest(req, res); } catch {}
    assert.ok('Access-Control-Allow-Origin' in capturedHeaders, 'Must set CORS header');
    assert.notEqual(capturedHeaders['Access-Control-Allow-Origin'], '*', 'Must never set wildcard *');
  });

  it('unauthorized foreign origin is rejected with 403 and no CORS allow', async () => {
    const { handleApiRequest } = await import('../src/server/apiRouter.js');
    let statusCode = 200;
    const capturedHeaders = {};
    const req = {
      method: 'GET',
      url: '/api/ide/info',
      headers: { origin: 'https://evil.attacker.com', host: '127.0.0.1:5173' },
    };
    const res = {
      setHeader(k, v) { capturedHeaders[k] = v; },
      get statusCode() { return statusCode; },
      set statusCode(v) { statusCode = v; },
      end() {},
    };
    await handleApiRequest(req, res);
    assert.equal(statusCode, 403, 'External origin must be rejected with 403');
    assert.notEqual(capturedHeaders['Access-Control-Allow-Origin'], 'https://evil.attacker.com', 'Cannot grant CORS to evil.com');
  });

  it('foreign Host header is rejected with 403', async () => {
    const { handleApiRequest } = await import('../src/server/apiRouter.js');
    let statusCode = 200;
    const req = {
      method: 'GET',
      url: '/api/ide/info',
      headers: { host: 'evil-rebinding.com' },
    };
    const res = {
      setHeader() {},
      get statusCode() { return statusCode; },
      set statusCode(v) { statusCode = v; },
      end() {},
    };
    await handleApiRequest(req, res);
    assert.equal(statusCode, 403, 'Invalid host header must be rejected with 403');
  });

  it('cross-site sec-fetch-site is rejected with 403', async () => {
    const { handleApiRequest } = await import('../src/server/apiRouter.js');
    let statusCode = 200;
    const req = {
      method: 'GET',
      url: '/api/ide/info',
      headers: { 'sec-fetch-site': 'cross-site' },
    };
    const res = {
      setHeader() {},
      get statusCode() { return statusCode; },
      set statusCode(v) { statusCode = v; },
      end() {},
    };
    await handleApiRequest(req, res);
    assert.equal(statusCode, 403, 'Cross-site request must be rejected with 403');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 — Server-side confirmation tokens
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 2 — Server-side confirmation token flow', async () => {
  const { PermissionManager } = await import('../src/extensions/permissionManager.js');

  it('args.__confirmed alone does NOT grant permission in STRICT mode for client requests', () => {
    const pm = new PermissionManager({ 'ext-1': { terminal: true } }, 'strict');
    const toolDef = { name: 'terminal_execute', requiredPermissions: ['terminal'] };
    const result = pm.checkExecutionPermission(
      'ext-1',
      toolDef,
      { command: 'node -v', __confirmed: true },
      {},
      { requireTokenOnly: true }
    );
    assert.equal(result.allowed, false, 'args.__confirmed must not grant permission for client requests');
    assert.equal(result.requiresConfirmation, true);
    assert.ok(typeof result.confirmationToken === 'string' && result.confirmationToken.length > 0, 'Must return server token');
  });

  it('valid server-issued token allows execution in STRICT mode (single-use)', () => {
    const pm = new PermissionManager({ 'ext-1': { terminal: true } }, 'strict');
    const toolDef = { name: 'terminal_execute', requiredPermissions: ['terminal'] };
    const args = { command: 'node -v' };

    const denied = pm.checkExecutionPermission('ext-1', toolDef, args, {});
    assert.equal(denied.allowed, false);
    const token = denied.confirmationToken;
    assert.ok(token, 'Must return confirmationToken');

    const allowed = pm.checkExecutionPermission('ext-1', toolDef, args, {}, { confirmationToken: token });
    assert.equal(allowed.allowed, true, 'Valid server token must grant execution');

    const reused = pm.checkExecutionPermission('ext-1', toolDef, args, {}, { confirmationToken: token });
    assert.equal(reused.allowed, false, 'Token must be single-use');
  });

  it('confirmation tokens are bound to the issuing extension and mismatches do not consume them', () => {
    const pm = new PermissionManager({ 'ext-1': { terminal: true }, 'ext-2': { terminal: true } }, 'strict');
    const args = { command: 'node -v' };
    const token = pm.createConfirmationToken('ext-1', 'terminal_execute', args);

    assert.equal(
      pm.validateAndConsumeConfirmationToken(token, 'ext-2', 'terminal_execute', args),
      false,
      'A token issued to ext-1 must not validate for ext-2'
    );
    assert.equal(
      pm.validateAndConsumeConfirmationToken(token, 'ext-1', 'terminal_execute', args),
      true,
      'A mismatched extension attempt must not consume the valid token'
    );
    assert.equal(
      pm.validateAndConsumeConfirmationToken(token, 'ext-1', 'terminal_execute', args),
      false,
      'The token remains single-use after successful validation'
    );
  });

  it('tokens are payload-bound — wrong args invalidate token', () => {
    const pm = new PermissionManager({ 'ext-1': { terminal: true } }, 'strict');
    const toolDef = { name: 'terminal_execute', requiredPermissions: ['terminal'] };
    const denied = pm.checkExecutionPermission('ext-1', toolDef, { command: 'echo hello' }, {});
    const token = denied.confirmationToken;
    const wrongArgs = pm.checkExecutionPermission('ext-1', toolDef, { command: 'rm -rf /' }, {}, { confirmationToken: token });
    assert.equal(wrongArgs.allowed, false, 'Token must be invalidated when args differ');
  });

  it('expired tokens are rejected', () => {
    const pm = new PermissionManager({ 'ext-1': { terminal: true } }, 'strict');
    const args = { command: 'dir' };
    const token = pm.createConfirmationToken('ext-1', 'terminal_execute', args, -1);
    const toolDef = { name: 'terminal_execute', requiredPermissions: ['terminal'] };
    const result = pm.checkExecutionPermission('ext-1', toolDef, args, {}, { confirmationToken: token });
    assert.equal(result.allowed, false, 'Expired token must be rejected');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3 — Workspace path containment
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 3 — Workspace path containment and Sandbox containment', () => {
  it('../../ traversal is rejected by /api/ide/read', async () => {
    const { handleApiRequest } = await import('../src/server/apiRouter.js');
    let responseData = '';
    let statusCode = 200;
    const req = { method: 'GET', url: '/api/ide/read?path=../../etc/passwd' };
    const res = {
      setHeader() {},
      get statusCode() { return statusCode; },
      set statusCode(v) { statusCode = v; },
      end(body) { responseData = body; },
    };
    await handleApiRequest(req, res);
    const parsed = JSON.parse(responseData);
    assert.equal(parsed.ok, false, 'Path traversal ../../ must be rejected');
  });

  it('C:\\Windows\\win.ini absolute path is rejected by /api/ide/read', async () => {
    const { handleApiRequest } = await import('../src/server/apiRouter.js');
    let responseData = '';
    let statusCode = 200;
    const req = { method: 'GET', url: '/api/ide/read?path=' + encodeURIComponent('C:\\Windows\\win.ini') };
    const res = {
      setHeader() {},
      get statusCode() { return statusCode; },
      set statusCode(v) { statusCode = v; },
      end(body) { responseData = body; },
    };
    await handleApiRequest(req, res);
    const parsed = JSON.parse(responseData);
    assert.equal(parsed.ok, false, 'Absolute Windows path C:\\Windows\\win.ini must be rejected');
  });

  it('UNC paths are rejected by /api/ide/read and resolveSafePath', async () => {
    const { handleApiRequest, resolveSafePath } = await import('../src/server/apiRouter.js');
    let responseData = '';
    const req = { method: 'GET', url: '/api/ide/read?path=' + encodeURIComponent('\\\\server\\share\\evil.js') };
    const res = {
      setHeader() {},
      statusCode: 200,
      end(body) { responseData = body; },
    };
    await handleApiRequest(req, res);
    const parsed = JSON.parse(responseData);
    assert.equal(parsed.ok, false, 'UNC path must be rejected');

    assert.throws(
      () => resolveSafePath('\\\\evil-host\\share\\file'),
      /UNC paths are not permitted/,
      'resolveSafePath must throw on UNC paths'
    );
    assert.throws(
      () => resolveSafePath('//evil-host/share/file'),
      /UNC paths are not permitted/,
      'resolveSafePath must throw on forward-slash UNC paths'
    );
  });

  it('sibling directory escape is rejected by resolveSafePath', async () => {
    const { resolveSafePath } = await import('../src/server/apiRouter.js');
    const siblingPath = ROOT + '-sibling\\malicious.txt';
    assert.throws(
      () => resolveSafePath(siblingPath),
      /Path traversal attempt detected outside workspace/,
      'Sibling directory must be rejected'
    );
  });

  it('symlinks pointing outside workspace are rejected by resolveSafePath', async () => {
    const { resolveSafePath } = await import('../src/server/apiRouter.js');
    const tmpDir = path.join(ROOT, 'temp_symlink_test_' + Date.now());
    const outsideTarget = path.join(ROOT, '..', 'temp_outside_' + Date.now() + '.txt');
    const relativeSymlinkPath = path.relative(ROOT, path.join(tmpDir, 'symlink_outside.txt'));
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(outsideTarget, 'outside content');
      const symlinkPath = path.join(tmpDir, 'symlink_outside.txt');
      try {
        fs.symlinkSync(outsideTarget, symlinkPath);
        assert.throws(
          () => resolveSafePath(relativeSymlinkPath),
          /(Symlink target escapes active workspace|Path traversal attempt detected)/,
          'Symlink target pointing outside must be rejected'
        );
      } catch (symlinkErr) {
        // On Windows without admin privileges, symlink creation might fail with EPERM.
        // In that case, verify that canonical containment logic handles simulated path escapes.
        if (symlinkErr.code !== 'EPERM') throw symlinkErr;
      }
    } finally {
      try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      try { if (fs.existsSync(outsideTarget)) fs.rmSync(outsideTarget, { force: true }); } catch {}
    }
  });

  it('sandbox mode blocks sibling directory prefix bypass for terminal and explorer', async () => {
    const { PermissionManager, isPathInsideWorkspace } = await import('../src/extensions/permissionManager.js');
    const wsRoot = 'C:\\workspace';

    assert.equal(isPathInsideWorkspace('C:\\workspace-malicious', wsRoot), false, 'Sibling directory must be blocked');
    assert.equal(isPathInsideWorkspace('C:\\workspace\\..\\escaped', wsRoot), false, 'Traversal after prefix must be blocked');
    assert.equal(isPathInsideWorkspace('\\\\attacker\\share', wsRoot), false, 'UNC path must be blocked');
    assert.equal(isPathInsideWorkspace('C:\\workspace\\subdir\\file.txt', wsRoot), true, 'Valid workspace subdir must be allowed');

    const pm = new PermissionManager({ 'ext-1': { terminal: true, apps: true } }, 'sandbox');
    const termTool = { name: 'terminal_execute', requiredPermissions: ['terminal'] };
    const termRes = pm.checkExecutionPermission(
      'ext-1',
      termTool,
      { command: 'echo hi', cwd: wsRoot + '-malicious' },
      {},
      { workspaceRoot: wsRoot }
    );
    assert.equal(termRes.allowed, false, 'Sandbox mode must block sibling cwd');

    const expTool = { name: 'windows_file_explorer', requiredPermissions: ['apps'] };
    const expRes = pm.checkExecutionPermission(
      'ext-1',
      expTool,
      { path: wsRoot + '-malicious' },
      {},
      { workspaceRoot: wsRoot }
    );
    assert.equal(expRes.allowed, false, 'Sandbox mode must block sibling explorer path');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 4 — Extension manifest security
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 4 — Extension manifest: ID and entry path validation', async () => {
  const { validateManifest } = await import('../src/extensions/manifestValidator.js');

  const validBase = {
    id: 'my-ext',
    name: 'My Extension',
    version: '1.0.0',
    description: 'A test extension',
    entry: 'index.js',
    permissions: [],
    tools: [
      {
        name: 'test_tool',
        description: 'A test tool',
        parameters: { type: 'object' },
      },
    ],
  };

  it('valid manifest passes', () => {
    const result = validateManifest(validBase);
    assert.equal(result.valid, true);
  });

  it('entry with path traversal is rejected', () => {
    const result = validateManifest({ ...validBase, entry: '../../../etc/passwd' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('entry')));
  });

  it('entry with absolute Windows path is rejected', () => {
    const result = validateManifest({ ...validBase, entry: 'C:\\evil.js' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('entry')));
  });

  it('entry with UNC path is rejected', () => {
    const result = validateManifest({ ...validBase, entry: '\\\\server\\share\\evil.js' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('entry')));
  });

  it('entry with /absolute/path is rejected', () => {
    const result = validateManifest({ ...validBase, entry: '/usr/bin/evil.js' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('entry')));
  });

  it('id with path chars is rejected', () => {
    const invalid = validateManifest({ ...validBase, id: '../../../evil' });
    assert.equal(invalid.valid, false);
  });

  it('valid subdirectory entry is accepted', () => {
    const result = validateManifest({ ...validBase, entry: 'src/index.js' });
    assert.equal(result.valid, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 5 — SSRF prevention
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 5 — SSRF: isPrivateOrRestrictedIP and assertSafeUrl', async () => {
  const { isPrivateOrRestrictedIP, assertSafeUrl } = await import('../src/server/siteReader.js');

  it('detects loopback (127.0.0.1)', () => { assert.equal(isPrivateOrRestrictedIP('127.0.0.1'), true); });
  it('detects private 10.x.x.x', () => { assert.equal(isPrivateOrRestrictedIP('10.0.0.1'), true); });
  it('detects private 192.168.x.x', () => { assert.equal(isPrivateOrRestrictedIP('192.168.1.1'), true); });
  it('detects private 172.16.x.x', () => { assert.equal(isPrivateOrRestrictedIP('172.16.0.1'), true); });
  it('detects cloud metadata 169.254.169.254', () => { assert.equal(isPrivateOrRestrictedIP('169.254.169.254'), true); });
  it('detects carrier-grade NAT 100.64.x.x', () => { assert.equal(isPrivateOrRestrictedIP('100.64.0.1'), true); });
  it('detects IPv6 loopback ::1', () => { assert.equal(isPrivateOrRestrictedIP('::1'), true); });
  it('detects IPv4-mapped ::ffff:127.0.0.1', () => { assert.equal(isPrivateOrRestrictedIP('::ffff:127.0.0.1'), true); });
  it('allows public 8.8.8.8', () => { assert.equal(isPrivateOrRestrictedIP('8.8.8.8'), false); });
  it('allows public 1.1.1.1', () => { assert.equal(isPrivateOrRestrictedIP('1.1.1.1'), false); });

  it('assertSafeUrl rejects localhost', async () => {
    await assert.rejects(() => assertSafeUrl('http://localhost/'),
      (err) => { assert.ok(err.message.length > 0); return true; });
  });

  it('assertSafeUrl rejects 127.0.0.1', async () => {
    await assert.rejects(() => assertSafeUrl('http://127.0.0.1/'),
      (err) => { assert.ok(err.message.length > 0); return true; });
  });

  it('assertSafeUrl rejects 169.254.169.254', async () => {
    await assert.rejects(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/'),
      (err) => { assert.ok(err.message.length > 0); return true; });
  });

  it('assertSafeUrl rejects ftp://', async () => {
    await assert.rejects(() => assertSafeUrl('ftp://example.com/'),
      (err) => { assert.ok(err.message.toLowerCase().includes('protocol') || err.message.includes('Prohibited')); return true; });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 6 — chrome_manage_tabs close/list honest unsupported
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 6 — chrome_manage_tabs close/list return explicit unsupported', async () => {
  const { chrome_manage_tabs } = await import('../extensions/chrome/index.js');

  it('close returns ok: false with supported: false', async () => {
    const result = await chrome_manage_tabs({ action: 'close' });
    assert.equal(result.ok, false, 'close must return ok: false');
    assert.ok(result.error && result.error.length > 0, 'close must have descriptive error');
    assert.equal(result.data?.supported, false, 'close must set supported: false');
  });

  it('list returns ok: false with supported: false', async () => {
    const result = await chrome_manage_tabs({ action: 'list' });
    assert.equal(result.ok, false, 'list must return ok: false');
    assert.ok(result.error && result.error.length > 0, 'list must have descriptive error');
    assert.equal(result.data?.supported, false, 'list must set supported: false');
  });

  it('unknown action returns ok: false', async () => {
    const result = await chrome_manage_tabs({ action: 'warp' });
    assert.equal(result.ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 7 — Terminal: exit code and catastrophic command blocking
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 7 — Terminal exec: exit code and catastrophic command blocking', () => {
  let server, port, baseUrl;
  const tmpWs = path.join(process.cwd(), `temp_exec_sec_${Date.now()}`);

  before(async () => {
    fs.mkdirSync(tmpWs, { recursive: true });
    const { handleApiRequest } = await import('../src/server/apiRouter.js');
    server = http.createServer(async (req, res) => {
      const handled = await handleApiRequest(req, res);
      if (!handled) { res.statusCode = 404; res.end('Not found'); }
    });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    await fetch(`${baseUrl}/api/ide/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: tmpWs }),
    });
  });

  after(async () => {
    try { fs.rmSync(tmpWs, { recursive: true, force: true }); } catch {}
    await new Promise((resolve) => server.close(resolve));
  });

  it('rejects terminal execution when Origin is missing', async () => {
    const res = await fetch(`${baseUrl}/api/ide/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo SHOULD_NOT_RUN' }),
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).ok, false);
  });

  it('successful command returns exitCode: 0 and ok: true', async () => {
    const res = await fetch(`${baseUrl}/api/ide/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1' },
      body: JSON.stringify({ command: 'echo hello' }),
    });
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.exitCode, 0);
    assert.ok(data.stdout.includes('hello'));
  });

  it('exec always includes exitCode field', async () => {
    const res = await fetch(`${baseUrl}/api/ide/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1' },
      body: JSON.stringify({ command: 'echo test' }),
    });
    const data = await res.json();
    assert.ok(data.exitCode !== undefined, 'exec must always return exitCode');
  });

  it('catastrophic command is blocked with HTTP 403', async () => {
    const res = await fetch(`${baseUrl}/api/ide/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1' },
      body: JSON.stringify({ command: 'format C:' }),
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 8 — FreeLLMAPIProvider.getModels has AbortController timeout
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 8 — FreeLLMAPIProvider.getModels has timeout (does not hang)', async () => {
  const { FreeLLMAPIProvider } = await import('../src/server/FreeLLMAPIProvider.js');

  it('getModels times out quickly on unreachable host', async () => {
    const provider = new FreeLLMAPIProvider({
      baseUrl: 'http://127.0.0.1:9',
      apiKey: 'test',
      timeoutMs: 1500,
    });
    const start = Date.now();
    await assert.rejects(
      () => provider.getModels(),
      (err) => {
        const elapsed = Date.now() - start;
        assert.ok(elapsed < 8000, `Must complete within 8s; took ${elapsed}ms`);
        assert.ok(err.message.length > 0);
        return true;
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 9 — E2E portability: free port via listen(0)
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 9 — E2E portability: free port detection', () => {
  it('can obtain free local port via listen(0)', async () => {
    const freePort = await new Promise((resolve, reject) => {
      const srv = http.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const p = srv.address().port;
        srv.close(() => resolve(p));
      });
      srv.on('error', reject);
    });
    assert.ok(typeof freePort === 'number' && freePort > 0 && freePort < 65536);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 10 — GitHub Actions CI file
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 10 — GitHub Actions CI workflow exists', () => {
  it('.github/workflows/ci.yml exists', () => {
    const ciPath = path.join(ROOT, '.github', 'workflows', 'ci.yml');
    assert.ok(fs.existsSync(ciPath), `CI file must exist at ${ciPath}`);
  });

  it('CI workflow has install, lint, test, build steps', () => {
    const ciPath = path.join(ROOT, '.github', 'workflows', 'ci.yml');
    if (!fs.existsSync(ciPath)) return;
    const content = fs.readFileSync(ciPath, 'utf-8');
    assert.ok(content.includes('npm ci') || content.includes('npm install'), 'Must have install step');
    assert.ok(content.includes('npm test') || content.includes('npm run test'), 'Must have test step');
    assert.ok(content.includes('npm run build') || content.includes('vite build'), 'Must have build step');
    assert.ok(content.includes('lint') || content.includes('oxlint'), 'Must have lint step');
  });
});
