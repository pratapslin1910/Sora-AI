import React, { useState } from 'react';
import { Search, FileCode, FileText, File, X } from 'lucide-react';
import { FileItem } from './types';

interface QuickOpenModalProps {
  files: FileItem[];
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (file: FileItem) => void;
}

export const QuickOpenModal: React.FC<QuickOpenModalProps> = ({
  files,
  isOpen,
  onClose,
  onSelectFile,
}) => {
  const [query, setQuery] = useState<string>('');

  if (!isOpen) return null;

  const onlyFiles = files.filter((f) => !f.isDirectory);
  const filtered = query.trim()
    ? onlyFiles.filter((f) =>
        f.path.toLowerCase().includes(query.toLowerCase().trim())
      )
    : onlyFiles;

  const getFileIcon = (item: FileItem) => {
    const ext = item.ext.toLowerCase();
    if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
      return <FileCode className="w-4 h-4 text-[#3178C6]" />;
    }
    if (['md', 'txt'].includes(ext)) {
      return <FileText className="w-4 h-4 text-[#00D99A]" />;
    }
    return <File className="w-4 h-4 text-[#A1A1AA]" />;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-start justify-center pt-24 p-4">
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-xl max-w-lg w-full overflow-hidden text-[#cccccc] shadow-2xl flex flex-col">
        {/* Search Input Bar */}
        <div className="p-3 bg-[#252526] border-b border-[#333333] flex items-center gap-2.5">
          <Search className="w-4 h-4 text-[#007acc] shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && filtered.length > 0) {
                onSelectFile(filtered[0]);
                onClose();
              }
            }}
            placeholder="Type to search and open file (e.g. App.tsx, package.json)..."
            className="flex-1 bg-transparent text-xs font-mono text-white placeholder-[#666666] outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 rounded text-[#888888] hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-72 overflow-y-auto p-1 text-xs font-mono">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-[#666666]">No matching files</div>
          ) : (
            filtered.map((file) => (
              <div
                key={file.path}
                onClick={() => {
                  onSelectFile(file);
                  onClose();
                }}
                className="flex items-center justify-between px-3 py-2 rounded hover:bg-[#007acc]/20 hover:text-white cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5 truncate">
                  {getFileIcon(file)}
                  <span className="font-semibold text-white truncate">
                    {file.name}
                  </span>
                  <span className="text-[10px] text-[#71717A] truncate">
                    {file.path}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
