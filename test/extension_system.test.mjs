import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import {
  ExtensionManager,
  PermissionManager,
  ToolRegistry,
  ToolExecutionBridge,
  ExtensionLoader,
  validateManifest,
  ALLOWED_PERMISSION_CATEGORIES,
} from '../src/extensions/index.js';
import { handleApiRequest } from '../src/server/apiRouter.js';

describe('SORA Modular Tool Extension System Tests', () => {
  const tempTestDir = path.resolve(process.cwd(), 'temp_test_ext_' + Date.now());
  const tempConfigFile = path.resolve(tempTestDir, 'extensions_config.json');
  const tempExtensionsDir = path.resolve(tempTestDir, 'extensions');

  let server;
  let serverPort;
  let baseUrl;

  before(async () => {
    fs.mkdirSync(tempExtensionsDir, { recursive: true });

    // Start an HTTP server instance routing through handleApiRequest
    server = http.createServer(async (req, res) => {
      const handled = await handleApiRequest(req, res);
      if (!handled) {
        res.statusCode = 404;
        res.end('Not found');
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        baseUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  after(async () => {
    try {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    } catch {}

    await new Promise((resolve) => server.close(resolve));
  });

  describe('1. Manifest Validation & Contract', () => {
    it('validates a well-formed manifest successfully', () => {
      const validManifest = {
        id: 'sample-tool',
        name: 'Sample Tool',
        version: '1.0.0',
        description: 'A test extension',
        entry: 'index.js',
        permissions: ['terminal', 'browser'],
        tools: [
          {
            name: 'sample_action',
            description: 'Performs sample action',
            parameters: {
              type: 'object',
              properties: {
                target: { type: 'string', description: 'Target parameter' },
              },
              required: ['target'],
            },
          },
        ],
      };

      const result = validateManifest(validManifest);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it('rejects manifests missing required fields or having invalid IDs', () => {
      const missingId = { name: 'No ID', version: '1.0.0', description: 'd', entry: 'index.js', tools: [] };
      const res1 = validateManifest(missingId);
      assert.equal(res1.valid, false);
      assert.ok(res1.errors.some((e) => e.includes('"id" is required')));

      const invalidId = { id: 'bad ID with spaces!', name: 'Bad', version: '1.0.0', description: 'd', entry: 'index.js', tools: [{ name: 't', description: 'd' }] };
      const res2 = validateManifest(invalidId);
      assert.equal(res2.valid, false);
      assert.ok(res2.errors.some((e) => e.includes('only letters, numbers, hyphens')));

      const emptyTools = { id: 'tool-x', name: 'X', version: '1.0.0', description: 'd', entry: 'index.js', tools: [] };
      const res3 = validateManifest(emptyTools);
      assert.equal(res3.valid, false);
      assert.ok(res3.errors.some((e) => e.includes('at least one tool')));
    });

    it('rejects unallowed permission categories', () => {
      const unallowedPermManifest = {
        id: 'unallowed-perm',
        name: 'Unallowed Perm',
        version: '1.0.0',
        description: 'Testing permissions',
        entry: 'index.js',
        permissions: ['unrestricted_root_access'],
        tools: [{ name: 'test_tool', description: 'Test' }],
      };

      const res = validateManifest(unallowedPermManifest);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some((e) => e.includes('is not recognized')));
    });
  });

  describe('2. Permission Manager & Safety Enforcement', () => {
    it('does not grant unrestricted access by default', () => {
      const pm = new PermissionManager();
      const perms = pm.getPermissions('test-ext', ['browser', 'terminal']);
      assert.equal(perms.browser, false);
      assert.equal(perms.terminal, false);
      assert.equal(pm.hasPermission('test-ext', 'terminal'), false);
    });

    it('allows granted permissions and denies revoked permissions', () => {
      const pm = new PermissionManager();
      pm.grantPermission('test-ext', 'browser');
      assert.equal(pm.hasPermission('test-ext', 'browser'), true);

      pm.revokePermission('test-ext', 'browser');
      assert.equal(pm.hasPermission('test-ext', 'browser'), false);
    });

    it('blocks execution when required permissions are missing', () => {
      const pm = new PermissionManager();
      const toolDef = {
        name: 'protected_tool',
        requiredPermissions: ['terminal'],
      };

      const check = pm.checkExecutionPermission('test-ext', toolDef, { command: 'dir' });
      assert.equal(check.allowed, false);
      assert.ok(check.reason.includes('Permission denied'));
    });

    it('safeguard: blocks catastrophic drive wipe and partition commands even if terminal is permitted', () => {
      const pm = new PermissionManager();
      pm.grantPermission('test-ext', 'terminal');

      const toolDef = { name: 'terminal_execute', requiredPermissions: ['terminal'] };
      const catastrophicCommands = [
        'format C: /fs:NTFS',
        'rmdir /s /q C:\\',
        'del /s /q C:\\',
        'diskpart',
        'Remove-Item -Recurse C:\\',
      ];

      for (const cmd of catastrophicCommands) {
        const check = pm.checkExecutionPermission('test-ext', toolDef, { command: cmd });
        assert.equal(check.allowed, false, `Command should be blocked: ${cmd}`);
        assert.ok(check.reason.includes('safety policy'));
      }
    });

    it('enforces command confirmation policy when requireConfirmation is true', () => {
      const pm = new PermissionManager();
      pm.grantPermission('test-ext', 'terminal');

      const toolDef = { name: 'terminal_execute', requiredPermissions: ['terminal'] };
      const config = { requireConfirmation: true };

      // Without confirmation flag
      const unconfirmed = pm.checkExecutionPermission('test-ext', toolDef, { command: 'npm install' }, config);
      assert.equal(unconfirmed.allowed, false);
      assert.equal(unconfirmed.requiresConfirmation, true);

      // With confirmation flag
      const confirmed = pm.checkExecutionPermission('test-ext', toolDef, { command: 'npm install', __confirmed: true }, config);
      assert.equal(confirmed.allowed, true);
    });
  });

  describe('3. Tool Registry & Schema Formatting', () => {
    it('registers, looks up, and unregisters tools cleanly', () => {
      const registry = new ToolRegistry();
      const handler = async (args) => ({ ok: true, data: args });

      registry.registerTool('ext-1', {
        name: 'calc_add',
        description: 'Adds two numbers',
        parameters: {
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' } },
          required: ['a', 'b'],
        },
      }, handler);

      assert.equal(registry.hasTool('calc_add'), true);
      const entry = registry.getTool('calc_add');
      assert.equal(entry.extensionId, 'ext-1');
      assert.equal(entry.toolDef.description, 'Adds two numbers');

      const toolsList = registry.listTools();
      assert.equal(toolsList.length, 1);
      assert.equal(toolsList[0].name, 'calc_add');

      // Unregister by extension
      registry.unregisterExtensionTools('ext-1');
      assert.equal(registry.hasTool('calc_add'), false);
    });

    it('formats tools into SORA prompt instructions and OpenAI schema', () => {
      const registry = new ToolRegistry();
      registry.registerTool('ext-1', {
        name: 'web_search',
        description: 'Searches the web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search term' } },
        },
      }, async () => ({ ok: true }));

      const promptText = registry.formatToolsForPrompt();
      assert.ok(promptText.includes('AVAILABLE MODULAR EXTENSION TOOLS:'));
      assert.ok(promptText.includes('web_search: Searches the web'));
      assert.ok(promptText.includes('<tool_call>'));

      const openAiSchemas = registry.getToolsOpenAISchema();
      assert.equal(openAiSchemas.length, 1);
      assert.equal(openAiSchemas[0].type, 'function');
      assert.equal(openAiSchemas[0].function.name, 'web_search');
    });
  });

  describe('4. Tool Execution Bridge & Isolation', () => {
    it('validates tool arguments and rejects invalid parameters', async () => {
      const registry = new ToolRegistry();
      const pm = new PermissionManager();
      const loader = new ExtensionLoader();
      const bridge = new ToolExecutionBridge(registry, pm, loader);

      registry.registerTool('ext-1', {
        name: 'greet_user',
        description: 'Greets user',
        parameters: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['username'],
        },
      }, async (args) => ({ ok: true, data: `Hello ${args.username}` }));

      // Missing required parameter
      const missingRes = await bridge.executeTool('greet_user', {});
      assert.equal(missingRes.ok, false);
      assert.ok(missingRes.error.includes('Missing required parameter'));

      // Wrong type
      const wrongTypeRes = await bridge.executeTool('greet_user', { username: 12345 });
      assert.equal(wrongTypeRes.ok, false);
      assert.ok(wrongTypeRes.error.includes('must be a string'));

      // Valid call
      const validRes = await bridge.executeTool('greet_user', { username: 'Paandhu' });
      assert.equal(validRes.ok, true);
      assert.equal(validRes.data, 'Hello Paandhu');
      assert.equal(typeof validRes.executionTimeMs, 'number');
    });

    it('isolates tool failures and does not crash the host process', async () => {
      const registry = new ToolRegistry();
      const pm = new PermissionManager();
      const loader = new ExtensionLoader();
      const bridge = new ToolExecutionBridge(registry, pm, loader);

      registry.registerTool('ext-crash', {
        name: 'throw_error_tool',
        description: 'Crashes deliberately',
        parameters: { type: 'object', properties: {} },
      }, async () => {
        throw new Error('Simulated runtime exception inside extension tool');
      });

      const res = await bridge.executeTool('throw_error_tool', {});
      assert.equal(res.ok, false);
      assert.ok(res.error.includes('Simulated runtime exception'));
    });
  });

  describe('5. Initial Extensions Inspection & Real Invocations', () => {
    it('discovers and loads initial bundled extensions (Chrome, Windows, Terminal)', async () => {
      const em = new ExtensionManager({
        extensionsDir: path.resolve(process.cwd(), 'extensions'),
        configFile: tempConfigFile,
      });

      await em.initialize();
      const list = em.listExtensions();

      const ids = list.map((e) => e.id);
      assert.ok(ids.includes('sora-chrome'), 'sora-chrome should be present');
      assert.ok(ids.includes('sora-windows'), 'sora-windows should be present');
      assert.ok(ids.includes('sora-terminal'), 'sora-terminal should be present');

      // Verify tools registered
      assert.ok(em.toolRegistry.hasTool('chrome_search_and_navigate'));
      assert.ok(em.toolRegistry.hasTool('chrome_interact_page'));
      assert.ok(em.toolRegistry.hasTool('windows_launch_app'));
      assert.ok(em.toolRegistry.hasTool('windows_file_explorer'));
      assert.ok(em.toolRegistry.hasTool('terminal_execute'));
    });

    it('executes terminal_execute tool successfully on the local system', async () => {
      const em = new ExtensionManager({
        extensionsDir: path.resolve(process.cwd(), 'extensions'),
        configFile: tempConfigFile,
      });
      await em.initialize();

      const result = await em.bridge.executeTool('terminal_execute', {
        command: 'node -e "console.log(\'SORA_EXT_TEST_OK\')"',
      });

      assert.equal(result.ok, true);
      assert.equal(result.data.exitCode, 0);
      assert.ok(result.data.stdout.includes('SORA_EXT_TEST_OK'));
    });
  });

  describe('6. Complete Lifecycle Workflow (Import → Enable → Discover → Invoke → Disable → Remove)', () => {
    const customExtDir = path.resolve(tempTestDir, 'my-custom-tool');

    before(() => {
      fs.mkdirSync(customExtDir, { recursive: true });

      const manifest = {
        id: 'custom-calc-tool',
        name: 'Custom Calculator Tool',
        version: '1.2.3',
        description: 'Demonstrates modular extension import and execution',
        entry: 'index.js',
        permissions: ['apps'],
        tools: [
          {
            name: 'calc_multiply',
            description: 'Multiplies two numbers',
            parameters: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
              },
              required: ['x', 'y'],
            },
          },
        ],
      };

      const code = `
        export async function calc_multiply(args) {
          const { x, y } = args;
          return {
            ok: true,
            data: {
              result: x * y,
              formula: \`\${x} * \${y} = \${x * y}\`,
            },
          };
        }
      `;

      fs.writeFileSync(path.resolve(customExtDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(path.resolve(customExtDir, 'index.js'), code, 'utf8');
    });

    it('performs full end-to-end lifecycle smoothly', async () => {
      const em = new ExtensionManager({
        extensionsDir: tempExtensionsDir,
        configFile: path.resolve(tempTestDir, 'lifecycle_config.json'),
      });
      await em.initialize();

      // Step 1: Import extension from local path
      const importResult = await em.importExtension(customExtDir);
      assert.equal(importResult.ok, true);
      assert.equal(importResult.id, 'custom-calc-tool');

      // Step 2: Discover tool
      assert.equal(em.toolRegistry.hasTool('calc_multiply'), true);
      const promptText = em.toolRegistry.formatToolsForPrompt();
      assert.ok(promptText.includes('calc_multiply: Multiplies two numbers'));

      // Step 3: Invoke tool through SORA execution bridge
      const execResult = await em.bridge.executeTool('calc_multiply', { x: 7, y: 9 });
      assert.equal(execResult.ok, true);
      assert.equal(execResult.data.result, 63);
      assert.equal(execResult.data.formula, '7 * 9 = 63');

      // Step 4: Disable extension
      em.disableExtension('custom-calc-tool');
      assert.equal(em.toolRegistry.hasTool('calc_multiply'), false);

      const rejectedExec = await em.bridge.executeTool('calc_multiply', { x: 7, y: 9 });
      assert.equal(rejectedExec.ok, false);
      assert.ok(rejectedExec.error.includes('not registered or its extension is disabled'));

      // Step 5: Re-enable extension
      await em.enableExtension('custom-calc-tool');
      assert.equal(em.toolRegistry.hasTool('calc_multiply'), true);
      const reExec = await em.bridge.executeTool('calc_multiply', { x: 4, y: 5 });
      assert.equal(reExec.ok, true);
      assert.equal(reExec.data.result, 20);

      // Step 6: Remove extension
      const removeResult = em.removeExtension('custom-calc-tool');
      assert.equal(removeResult.ok, true);
      assert.equal(em.toolRegistry.hasTool('calc_multiply'), false);
    });
  });

  describe('7. API Router Endpoints Integration', () => {
    it('serves GET /api/extensions with installed extensions catalog', async () => {
      const res = await fetch(`${baseUrl}/api/extensions`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(Array.isArray(data.extensions));
      assert.ok(data.extensions.length >= 3);
    });

    it('serves GET /api/extensions/tools with list of available tools', async () => {
      const res = await fetch(`${baseUrl}/api/extensions/tools`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(Array.isArray(data.tools));
      assert.ok(typeof data.promptFormat === 'string');
      assert.ok(Array.isArray(data.openAiSchema));
    });

    it('executes a tool via POST /api/extensions/execute', async () => {
      const res = await fetch(`${baseUrl}/api/extensions/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'terminal_execute',
          args: { command: 'node -e "console.log(40 + 2)"' },
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.ok(data.data.stdout.includes('42'));
    });

    it('toggles extension status via POST /api/extensions/:id/toggle', async () => {
      // Disable sora-terminal
      const disableRes = await fetch(`${baseUrl}/api/extensions/sora-terminal/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      assert.equal(disableRes.status, 200);

      // Verify tool execution is blocked
      const blockedRes = await fetch(`${baseUrl}/api/extensions/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'terminal_execute',
          args: { command: 'node -v' },
        }),
      });
      assert.equal(blockedRes.status, 400);

      // Re-enable sora-terminal
      const enableRes = await fetch(`${baseUrl}/api/extensions/sora-terminal/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      assert.equal(enableRes.status, 200);

      // Verify tool execution works again
      const restoredRes = await fetch(`${baseUrl}/api/extensions/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'terminal_execute',
          args: { command: 'node -v' },
        }),
      });
      assert.equal(restoredRes.status, 200);
    });

    it('updates extension configuration and permissions via POST /api/extensions/:id/config', async () => {
      const res = await fetch(`${baseUrl}/api/extensions/sora-terminal/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { timeoutSeconds: 45 },
          permissions: { terminal: true },
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
    });
  });

  describe('8. Permission Allowance Modes & System Prompt Tool Injection', () => {
    it('saves and retrieves Permission Allowance in /api/settings', async () => {
      // Set to strict
      const postRes = await fetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionAllowance: 'strict' }),
      });
      assert.equal(postRes.status, 200);

      const getRes = await fetch(`${baseUrl}/api/settings`);
      assert.equal(getRes.status, 200);
      const data = await getRes.json();
      assert.equal(data.permissionAllowance, 'strict');

      // Reset to full_access
      await fetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionAllowance: 'full_access' }),
      });
    });

    it('enforces Strict mode: requires confirmation for state-modifying actions', async () => {
      const pm = new PermissionManager({ 'sora-terminal': { terminal: true } }, 'strict');
      const check = pm.checkExecutionPermission('sora-terminal', { name: 'terminal_execute', requiredPermissions: ['terminal'] }, { command: 'node -v' });
      assert.equal(check.allowed, false);
      assert.equal(check.requiresConfirmation, true);

      // With confirmation flag, it passes
      const checkConfirmed = pm.checkExecutionPermission('sora-terminal', { name: 'terminal_execute', requiredPermissions: ['terminal'] }, { command: 'node -v', __confirmed: true });
      assert.equal(checkConfirmed.allowed, true);
    });

    it('enforces Sandbox mode: blocks destructive commands and non-whitelisted apps', async () => {
      const pm = new PermissionManager({ 'sora-terminal': { terminal: true }, 'sora-windows': { apps: true } }, 'sandbox');

      // Blocked command in sandbox
      const cmdCheck = pm.checkExecutionPermission('sora-terminal', { name: 'terminal_execute', requiredPermissions: ['terminal'] }, { command: 'del /f temp.txt' });
      assert.equal(cmdCheck.allowed, false);
      assert.ok(cmdCheck.reason.includes('Sandbox Mode'));

      // Blocked app in sandbox
      const appCheck = pm.checkExecutionPermission('sora-windows', { name: 'windows_launch_app', requiredPermissions: ['apps'] }, { appName: 'malicious.exe' });
      assert.equal(appCheck.allowed, false);
      assert.ok(appCheck.reason.includes('Sandbox Mode'));

      // Allowed whitelisted app in sandbox
      const allowedApp = pm.checkExecutionPermission('sora-windows', { name: 'windows_launch_app', requiredPermissions: ['apps'] }, { appName: 'chrome' });
      assert.equal(allowedApp.allowed, true);
    });

    it('buildSystemPrompt clarifies built-in memory as non-tools and injects real tools', async () => {
      const { buildSystemPrompt } = await import('../src/server/systemPrompt.js');
      const prompt = buildSystemPrompt({
        toolsPrompt: 'AVAILABLE MODULAR EXTENSION TOOLS:\n1. chrome_search_and_navigate: Search Google Chrome.',
        permissionAllowance: 'full_access',
      });

      // Must explicitly clarify that memory is built-in and NOT a tool
      assert.ok(prompt.includes('BUILT-IN background features of SORA'));
      assert.ok(prompt.includes('NEVER list memory_search, memory_get'));
      // Must include real active tool
      assert.ok(prompt.includes('chrome_search_and_navigate'));
      // Must include permission allowance mode
      assert.ok(prompt.includes('FULL ACCESS'));
    });
  });
});
