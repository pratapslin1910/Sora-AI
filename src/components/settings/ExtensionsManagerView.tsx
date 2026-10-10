import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchExtensions,
  toggleExtension,
  updateExtensionConfig,
  reloadExtension,
  removeExtension,
  importExtension,
  InstalledExtension,
} from '../../services/extensionService';
import ExtensionIcon from '@mui/icons-material/Extension';
import RefreshIcon from '@mui/icons-material/Refresh';
import BookmarkRemoveIcon from '@mui/icons-material/BookmarkRemove';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import TuneIcon from '@mui/icons-material/Tune';
import SecurityIcon from '@mui/icons-material/Security';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';

export const ExtensionsManagerView: React.FC = () => {
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Import input state
  const [importPath, setImportPath] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [showImportBar, setShowImportBar] = useState<boolean>(false);

  // Expanded extension details (configuration & tool inspection)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchExtensions();
      setExtensions(data);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load extensions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showNotification = (msg: string, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setTimeout(() => setErrorMsg(null), 5000);
    } else {
      setSuccessMsg(msg);
      setTimeout(() => setSuccessMsg(null), 4000);
    }
  };

  const handleToggle = async (ext: InstalledExtension) => {
    const nextState = !ext.enabled;
    setActiveActionId(ext.id);
    try {
      const res = await toggleExtension(ext.id, nextState);
      if (res.ok) {
        showNotification(res.message || `Extension "${ext.name}" ${nextState ? 'enabled' : 'disabled'}.`);
        await loadData();
      } else {
        showNotification(res.error || 'Failed to update extension state.', true);
      }
    } catch (err: any) {
      showNotification(err.message, true);
    } finally {
      setActiveActionId(null);
    }
  };

  const handleReload = async (id: string) => {
    setActiveActionId(id);
    try {
      const res = await reloadExtension(id);
      if (res.ok) {
        showNotification(res.message || 'Extension reloaded.');
        await loadData();
      } else {
        showNotification(res.error || 'Failed to reload extension.', true);
      }
    } catch (err: any) {
      showNotification(err.message, true);
    } finally {
      setActiveActionId(null);
    }
  };

  const handleRemove = async (ext: InstalledExtension) => {
    if (!window.confirm(`Are you sure you want to remove the extension "${ext.name}"?`)) {
      return;
    }
    setActiveActionId(ext.id);
    try {
      const res = await removeExtension(ext.id);
      if (res.ok) {
        showNotification(res.message || `Extension "${ext.name}" removed.`);
        if (expandedId === ext.id) setExpandedId(null);
        await loadData();
      } else {
        showNotification(res.error || 'Failed to remove extension.', true);
      }
    } catch (err: any) {
      showNotification(err.message, true);
    } finally {
      setActiveActionId(null);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importPath.trim()) return;

    setIsImporting(true);
    try {
      const res = await importExtension(importPath.trim());
      if (res.ok) {
        showNotification(res.message || `Imported ${res.name || 'extension'} successfully!`);
        setImportPath('');
        setShowImportBar(false);
        await loadData();
      } else {
        showNotification(res.error || 'Failed to import extension.', true);
      }
    } catch (err: any) {
      showNotification(err.message, true);
    } finally {
      setIsImporting(false);
    }
  };

  const handleTogglePermission = async (ext: InstalledExtension, perm: string, granted: boolean) => {
    const updated = { ...ext.permissionsGranted, [perm]: granted };
    try {
      const res = await updateExtensionConfig(ext.id, { permissions: updated });
      if (res.ok) {
        showNotification(`Permission "${perm}" ${granted ? 'granted' : 'revoked'}.`);
        await loadData();
      } else {
        showNotification(res.error || 'Failed to update permission.', true);
      }
    } catch (err: any) {
      showNotification(err.message, true);
    }
  };

  const handleConfigChange = async (ext: InstalledExtension, key: string, value: any) => {
    const updated = { ...ext.currentConfiguration, [key]: value };
    try {
      const res = await updateExtensionConfig(ext.id, { config: updated });
      if (res.ok) {
        await loadData();
      }
    } catch (err: any) {
      showNotification(err.message, true);
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Header and Controls */}
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <ExtensionIcon sx={{ fontSize: 18 }} className="text-cyan-400" />
              Extensions & Modular Tools
            </h4>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-mono">
              {extensions.filter((e) => e.enabled).length} active / {extensions.length} installed
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Independently developed tools dynamically discovered and executed by SORA Core.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowImportBar((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-medium text-xs transition-colors"
          >
            <FolderOpenIcon sx={{ fontSize: 15 }} />
            Import Extension
          </button>
          <button
            type="button"
            onClick={loadData}
            title="Refresh extension catalog"
            className="p-1.5 rounded-xl border border-white/10 hover:bg-white/[0.06] text-slate-400 hover:text-white transition-colors"
          >
            <RefreshIcon sx={{ fontSize: 16 }} />
          </button>
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 flex items-center gap-2">
          <CloseIcon sx={{ fontSize: 16 }} />
          <span className="flex-1">{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-2">
          <CheckIcon sx={{ fontSize: 16 }} />
          <span className="flex-1">{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Import Panel */}
      {showImportBar && (
        <form onSubmit={handleImport} className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-cyan-300">Import Local Extension</span>
            <span className="text-[10px] text-slate-400">Path must contain a valid <code>manifest.json</code></span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={importPath}
              onChange={(e) => setImportPath(e.target.value)}
              placeholder="e.g. C:\MyTools\custom-extension or .\extensions\chrome"
              className="flex-1 px-3 py-2 rounded-lg bg-black/50 border border-white/15 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500 font-mono"
            />
            <button
              type="submit"
              disabled={isImporting || !importPath.trim()}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1.5 transition-colors"
            >
              {isImporting && <CircularProgress size={12} sx={{ color: 'white' }} />}
              Import
            </button>
            <button
              type="button"
              onClick={() => setShowImportBar(false)}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400">
          <CircularProgress size={24} sx={{ color: '#38bdf8' }} />
          <span>Discovering modular extensions...</span>
        </div>
      )}

      {/* Extension List */}
      {!loading && extensions.length === 0 && (
        <div className="py-8 text-center text-slate-500 border border-dashed border-white/10 rounded-xl">
          <ExtensionIcon sx={{ fontSize: 32 }} className="text-slate-600 mb-2" />
          <p className="font-medium text-slate-400">No extensions installed.</p>
          <p className="text-[11px] mt-1 text-slate-500">Import an extension folder or place one into the <code>extensions/</code> directory.</p>
        </div>
      )}

      {!loading && extensions.length > 0 && (
        <div className="space-y-3">
          {extensions.map((ext) => {
            const isBusy = activeActionId === ext.id;
            const isExpanded = expandedId === ext.id;

            return (
              <div
                key={ext.id}
                className={`rounded-xl border transition-all ${
                  ext.enabled
                    ? 'border-white/[0.12] bg-white/[0.02] shadow-sm'
                    : 'border-white/[0.05] bg-black/20 opacity-75'
                }`}
              >
                {/* Main Card Row */}
                <div className="p-3.5 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center border flex-shrink-0 mt-0.5 ${
                        ext.enabled
                          ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                          : 'bg-white/5 border-white/10 text-slate-500'
                      }`}
                    >
                      <ExtensionIcon sx={{ fontSize: 20 }} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-xs">{ext.name}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-slate-400 font-mono border border-white/10">
                          v{ext.version}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">id: {ext.id}</span>
                        {ext.error && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            Error loading
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{ext.description}</p>

                      {/* Permissions badges */}
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        <span className="text-[10px] text-slate-500 font-medium">Permissions:</span>
                        {ext.permissionsRequested.length === 0 ? (
                          <span className="text-[10px] text-slate-500 italic">None required</span>
                        ) : (
                          ext.permissionsRequested.map((p) => {
                            const granted = ext.permissionsGranted[p];
                            return (
                              <Tooltip key={p} title={`Permission: ${p} (${granted ? 'Granted' : 'Denied'})`} arrow>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] flex items-center gap-1 border font-mono ${
                                    granted
                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                      : 'bg-rose-500/10 border-rose-500/30 text-rose-400 line-through'
                                  }`}
                                >
                                  <SecurityIcon sx={{ fontSize: 10 }} />
                                  {p}
                                </span>
                              </Tooltip>
                            );
                          })
                        )}
                        <span className="text-slate-600">|</span>
                        <span className="text-[10px] text-cyan-400 font-medium">
                          {ext.tools.length} tool{ext.tools.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions & Switch */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Tooltip title="Configure & inspect tools" arrow>
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : ext.id)}
                        className={`p-1.5 rounded-lg border transition-colors ${
                          isExpanded
                            ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                            : 'border-white/10 hover:bg-white/5 text-slate-400 hover:text-white'
                        }`}
                      >
                        <TuneIcon sx={{ fontSize: 16 }} />
                      </button>
                    </Tooltip>

                    <Tooltip title="Reload extension" arrow>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleReload(ext.id)}
                        className="p-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-40"
                      >
                        <RefreshIcon sx={{ fontSize: 16 }} />
                      </button>
                    </Tooltip>

                    <Tooltip title="Remove extension" arrow>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleRemove(ext)}
                        className="p-1.5 rounded-lg border border-rose-500/20 hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 transition-colors disabled:opacity-40"
                      >
                        <BookmarkRemoveIcon sx={{ fontSize: 16 }} />
                      </button>
                    </Tooltip>

                    {/* Enable Toggle Switch */}
                    <label className="relative inline-flex items-center cursor-pointer ml-1">
                      <input
                        type="checkbox"
                        checked={ext.enabled}
                        disabled={isBusy}
                        onChange={() => handleToggle(ext)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500 disabled:opacity-40"></div>
                    </label>
                  </div>
                </div>

                {/* Expanded Details: Tools, Permissions Management, Configuration */}
                {isExpanded && (
                  <div className="border-t border-white/[0.08] p-4 bg-black/40 space-y-4 rounded-b-xl">
                    {/* Provided Tools */}
                    <div className="space-y-2">
                      <h5 className="font-semibold text-white text-[11px] uppercase tracking-wider text-slate-400">
                        Exposed Tools ({ext.tools.length})
                      </h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {ext.tools.map((t) => (
                          <div
                            key={t.name}
                            className="p-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-cyan-300 font-medium text-xs">{t.name}</span>
                              <span className="text-[10px] text-slate-500 font-mono">
                                {Object.keys(t.parameters?.properties || {}).length} arg(s)
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400">{t.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Permission Control */}
                    {ext.permissionsRequested.length > 0 && (
                      <div className="space-y-2">
                        <h5 className="font-semibold text-white text-[11px] uppercase tracking-wider text-slate-400">
                          Permission Management
                        </h5>
                        <div className="flex flex-wrap gap-2">
                          {ext.permissionsRequested.map((perm) => {
                            const isGranted = Boolean(ext.permissionsGranted[perm]);
                            return (
                              <button
                                key={perm}
                                type="button"
                                onClick={() => handleTogglePermission(ext, perm, !isGranted)}
                                className={`px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
                                  isGranted
                                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                                    : 'bg-rose-500/15 border-rose-500/40 text-rose-400 hover:bg-rose-500/25'
                                }`}
                              >
                                <SecurityIcon sx={{ fontSize: 13 }} />
                                <span>{perm}: <strong>{isGranted ? 'Granted' : 'Blocked'}</strong></span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Configuration Options */}
                    {Object.keys(ext.configurationSchema).length > 0 && (
                      <div className="space-y-2">
                        <h5 className="font-semibold text-white text-[11px] uppercase tracking-wider text-slate-400">
                          Configuration Options
                        </h5>
                        <div className="space-y-2.5">
                          {Object.entries(ext.configurationSchema).map(([key, schema]: [string, any]) => {
                            const val = ext.currentConfiguration[key] ?? schema?.default ?? '';

                            return (
                              <div key={key} className="space-y-1">
                                <label className="block text-[11px] text-slate-300 font-medium">
                                  {key} <span className="text-slate-500 font-normal">({schema?.type || 'string'})</span>
                                </label>
                                {schema?.description && (
                                  <p className="text-[10px] text-slate-500">{schema.description}</p>
                                )}

                                {schema?.type === 'boolean' ? (
                                  <label className="flex items-center gap-2 cursor-pointer mt-1">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(val)}
                                      onChange={(e) => handleConfigChange(ext, key, e.target.checked)}
                                      className="h-4 w-4 accent-cyan-500 rounded"
                                    />
                                    <span className="text-xs text-slate-300">
                                      {val ? 'Enabled' : 'Disabled'}
                                    </span>
                                  </label>
                                ) : schema?.enum ? (
                                  <select
                                    value={String(val)}
                                    onChange={(e) => handleConfigChange(ext, key, e.target.value)}
                                    className="px-2.5 py-1.5 rounded-lg bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-cyan-500"
                                  >
                                    {schema.enum.map((opt: string) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    type={schema?.type === 'number' ? 'number' : 'text'}
                                    value={String(val)}
                                    onChange={(e) =>
                                      handleConfigChange(
                                        ext,
                                        key,
                                        schema?.type === 'number' ? Number(e.target.value) : e.target.value
                                      )
                                    }
                                    placeholder={String(schema?.default ?? '')}
                                    className="w-full px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
