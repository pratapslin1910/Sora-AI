/**
 * Extension Service for SORA Frontend
 *
 * Communicates with backend /api/extensions endpoints to manage extensions,
 * configure permissions, and execute tools.
 */

export interface ExtensionToolDefinition {
  name: string;
  description: string;
  parameters: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  requiredPermissions?: string[];
  extensionId?: string;
}

export interface InstalledExtension {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  permissionsRequested: string[];
  permissionsGranted: Record<string, boolean>;
  configurationSchema: Record<string, any>;
  currentConfiguration: Record<string, any>;
  tools: ExtensionToolDefinition[];
  enabled: boolean;
  error?: string | null;
  path: string;
}

export async function fetchExtensions(): Promise<InstalledExtension[]> {
  try {
    const res = await fetch('/api/extensions');
    if (!res.ok) return [];
    const data = await res.json();
    return data?.extensions || [];
  } catch (err) {
    console.warn('[ExtensionService] Failed to fetch extensions:', err);
    return [];
  }
}

export async function importExtension(
  folderPath: string
): Promise<{ ok: boolean; id?: string; name?: string; message?: string; error?: string }> {
  try {
    const res = await fetch('/api/extensions/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath.trim() }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to import extension.' };
  }
}

export async function toggleExtension(
  id: string,
  enabled: boolean
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`/api/extensions/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to toggle extension status.' };
  }
}

export async function updateExtensionConfig(
  id: string,
  options: { config?: Record<string, any>; permissions?: Record<string, boolean> }
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`/api/extensions/${encodeURIComponent(id)}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to update extension configuration.' };
  }
}

export async function reloadExtension(
  id: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`/api/extensions/${encodeURIComponent(id)}/reload`, {
      method: 'POST',
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to reload extension.' };
  }
}

export async function removeExtension(
  id: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`/api/extensions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to remove extension.' };
  }
}

export async function fetchExtensionTools(): Promise<{
  tools: ExtensionToolDefinition[];
  promptFormat: string;
}> {
  try {
    const res = await fetch('/api/extensions/tools');
    if (!res.ok) return { tools: [], promptFormat: '' };
    const data = await res.json();
    return {
      tools: data?.tools || [],
      promptFormat: data?.promptFormat || '',
    };
  } catch {
    return { tools: [], promptFormat: '' };
  }
}

export async function executeExtensionTool(
  tool: string,
  args: Record<string, any>
): Promise<{ ok: boolean; data?: any; error?: string; executionTimeMs?: number }> {
  try {
    const res = await fetch('/api/extensions/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Execution request failed' };
  }
}
