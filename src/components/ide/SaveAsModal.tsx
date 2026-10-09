import React, { useState } from 'react';
import { Save, AlertCircle, Check, X, FileText } from 'lucide-react';

interface SaveAsModalProps {
  currentPath: string;
  isOpen: boolean;
  onClose: () => void;
  onSaveAs: (newPath: string) => Promise<void>;
}

export const SaveAsModal: React.FC<SaveAsModalProps> = ({
  currentPath,
  isOpen,
  onClose,
  onSaveAs,
}) => {
  const [newFilePath, setNewFilePath] = useState<string>(currentPath || 'untitled.txt');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newFilePath.trim() || isLoading) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      await onSaveAs(newFilePath.trim());
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save file.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-xl max-w-md w-full p-6 text-[#cccccc] shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2d2d2d]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#007acc]/15 border border-[#007acc]/30 flex items-center justify-center text-[#007acc]">
              <Save className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">Save As</h3>
              <p className="text-[11px] text-[#888888] font-mono">
                Save active buffer to a new file or destination
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

        {/* Input */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-mono text-[#bbbbbb] font-semibold">
              New File Path (relative to workspace root):
            </label>
            <div className="relative flex items-center">
              <FileText className="w-4 h-4 absolute left-3 text-[#71717A]" />
              <input
                type="text"
                autoFocus
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                placeholder="e.g. src/components/NewFeature.tsx"
                className="w-full bg-[#141414] border border-[#333333] focus:border-[#007acc] rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-white placeholder-[#555555] outline-none"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-[#FF384C]/10 border border-[#FF384C]/30 text-[#FF384C] text-xs font-mono flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#252526] hover:bg-[#2d2d2d] text-[#aaaaaa] hover:text-white text-xs font-mono transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !newFilePath.trim()}
              className="px-4 py-2 rounded-lg bg-[#007acc] hover:bg-[#0062a3] text-white text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 cursor-pointer shadow-md"
            >
              <Check className="w-4 h-4" />
              <span>{isLoading ? 'Saving...' : 'Save File'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
