import React, { useState } from 'react';
import { FolderOpen, AlertCircle, Check, X, HardDrive } from 'lucide-react';
import { setWorkspaceRoot } from '../../services/chatService';

interface WorkspaceSwitcherModalProps {
  currentWorkspace: string;
  isOpen: boolean;
  onClose: () => void;
  onWorkspaceChanged: (newWorkspace: string) => void;
}

export const WorkspaceSwitcherModal: React.FC<WorkspaceSwitcherModalProps> = ({
  currentWorkspace,
  isOpen,
  onClose,
  onWorkspaceChanged,
}) => {
  const [targetPath, setTargetPath] = useState<string>(currentWorkspace);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSwitch = async () => {
    if (!targetPath.trim() || isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await setWorkspaceRoot(targetPath.trim());
      if (res.ok && res.workspaceRoot) {
        onWorkspaceChanged(res.workspaceRoot);
        onClose();
      } else {
        setErrorMsg(res.error || 'Failed to switch workspace directory.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error communicating with server.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePresetSelect = (preset: string) => {
    setTargetPath(preset);
  };

  // Derive parent directory as convenient preset
  const parentDir = currentWorkspace
    ? currentWorkspace.split(/[/\\]/).slice(0, -1).join('/') || '/'
    : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-xl max-w-lg w-full p-6 text-[#cccccc] shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2d2d2d]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#007acc]/15 border border-[#007acc]/30 flex items-center justify-center text-[#007acc]">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">
                Switch Workspace Folder
              </h3>
              <p className="text-[11px] text-[#888888] font-mono">
                Select or type any folder path on your Windows machine
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#888888] hover:text-white hover:bg-[#2d2d2d] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Current Folder */}
        <div className="bg-[#141414] border border-[#262626] rounded-lg p-3 text-xs font-mono space-y-1">
          <span className="text-[#71717A] text-[10px] uppercase font-bold tracking-wider">
            Current Workspace Root:
          </span>
          <div className="text-white truncate font-medium">{currentWorkspace}</div>
        </div>

        {/* Path Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-mono text-[#bbbbbb] font-semibold">
            Target Directory Path:
          </label>
          <div className="relative flex items-center">
            <HardDrive className="w-4 h-4 absolute left-3 text-[#71717A]" />
            <input
              type="text"
              autoFocus
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSwitch();
                if (e.key === 'Escape') onClose();
              }}
              placeholder="e.g. D:\PratapSingh\AI\Sora_V1 or C:\Projects"
              className="w-full bg-[#141414] border border-[#333333] focus:border-[#007acc] rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-white placeholder-[#555555] outline-none"
            />
          </div>
        </div>

        {/* Presets */}
        <div className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-wider text-[#71717A] font-mono font-bold">
            Quick Presets:
          </span>
          <div className="flex flex-wrap gap-2 text-[11px] font-mono">
            {parentDir && (
              <button
                type="button"
                onClick={() => handlePresetSelect(parentDir)}
                className="px-2.5 py-1 rounded bg-[#252526] hover:bg-[#333333] border border-[#333333] text-[#cccccc] hover:text-white transition-colors cursor-pointer truncate max-w-xs"
              >
                📁 Parent: {parentDir}
              </button>
            )}
            <button
              type="button"
              onClick={() => handlePresetSelect(currentWorkspace)}
              className="px-2.5 py-1 rounded bg-[#252526] hover:bg-[#333333] border border-[#333333] text-[#007acc] hover:text-white transition-colors cursor-pointer"
            >
              🔄 Current Project Root
            </button>
          </div>
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-[#FF384C]/10 border border-[#FF384C]/30 text-[#FF384C] text-xs font-mono flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Actions */}
        <div className="pt-2 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#aaaaaa] hover:text-white text-xs font-mono transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSwitch}
            disabled={isLoading || !targetPath.trim()}
            className="px-4 py-2 rounded-lg bg-[#007acc] hover:bg-[#0062a3] text-white text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer shadow-md"
          >
            <Check className="w-4 h-4" />
            <span>{isLoading ? 'Switching...' : 'Open Workspace'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
