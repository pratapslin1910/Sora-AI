import React, { useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  File,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Trash2,
  Edit2,
  ChevronRight,
  ChevronDown,
  X,
  Search,
  Image,
} from 'lucide-react';
import { FileItem, OpenTab } from './types';

interface WorkspaceExplorerProps {
  workspaceRoot: string;
  currentPath: string;
  files: FileItem[];
  isLoading: boolean;
  openTabs: OpenTab[];
  activeTabPath: string;
  onOpenFile: (file: FileItem) => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string, e: React.MouseEvent) => void;
  onRefresh: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpenFolder: () => void;
  onDelete: (path: string) => void;
  onRename: (file: FileItem) => void;
  onNavigateUp: () => void;
}

export const WorkspaceExplorer: React.FC<WorkspaceExplorerProps> = ({
  workspaceRoot,
  currentPath,
  files,
  isLoading,
  openTabs,
  activeTabPath,
  onOpenFile,
  onSelectTab,
  onCloseTab,
  onRefresh,
  onNewFile,
  onNewFolder,
  onOpenFolder,
  onDelete,
  onRename,
  onNavigateUp,
}) => {
  const [openEditorsExpanded, setOpenEditorsExpanded] = useState<boolean>(true);
  const [filesExpanded, setFilesExpanded] = useState<boolean>(true);
  const [filterQuery, setFilterQuery] = useState<string>('');

  const getFileIcon = (item: FileItem) => {
    if (item.isDirectory) {
      return <Folder className="w-4 h-4 text-[#E5A84B] shrink-0" />;
    }
    const ext = item.ext.toLowerCase();
    if (['ts', 'tsx'].includes(ext)) {
      return <FileCode className="w-4 h-4 text-[#3178C6] shrink-0" />;
    }
    if (['js', 'jsx', 'mjs'].includes(ext)) {
      return <FileCode className="w-4 h-4 text-[#F7DF1E] shrink-0" />;
    }
    if (['py'].includes(ext)) {
      return <FileCode className="w-4 h-4 text-[#3776AB] shrink-0" />;
    }
    if (['json'].includes(ext)) {
      return <FileCode className="w-4 h-4 text-[#FFA657] shrink-0" />;
    }
    if (['html', 'svg'].includes(ext)) {
      return <FileCode className="w-4 h-4 text-[#E34F26] shrink-0" />;
    }
    if (['css', 'scss', 'less'].includes(ext)) {
      return <FileCode className="w-4 h-4 text-[#9B51E0] shrink-0" />;
    }
    if (['md', 'txt'].includes(ext)) {
      return <FileText className="w-4 h-4 text-[#00D99A] shrink-0" />;
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)) {
      return <Image className="w-4 h-4 text-[#FF7080] shrink-0" />;
    }
    return <File className="w-4 h-4 text-[#A1A1AA] shrink-0" />;
  };

  const workspaceFolderName =
    workspaceRoot.split(/[/\\]/).filter(Boolean).pop() || 'WORKSPACE';

  const filteredFiles = filterQuery.trim()
    ? files.filter((f) =>
        f.name.toLowerCase().includes(filterQuery.toLowerCase().trim())
      )
    : files;

  return (
    <div className="w-64 bg-[#252526] border-r border-[#1e1e1e] flex flex-col h-full select-none text-[#cccccc] font-sans shrink-0">
      {/* Explorer Title & Workspace Actions */}
      <div className="h-9 px-3 border-b border-[#1e1e1e] flex items-center justify-between bg-[#252526] shrink-0">
        <span className="text-[11px] font-bold tracking-wider uppercase text-[#bbbbbb]">
          EXPLORER
        </span>

        <div className="flex items-center gap-1">
          <button
            onClick={onNewFile}
            className="p-1 hover:bg-[#333333] rounded text-[#858585] hover:text-white transition-colors cursor-pointer"
            title="New File"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onNewFolder}
            className="p-1 hover:bg-[#333333] rounded text-[#858585] hover:text-white transition-colors cursor-pointer"
            title="New Folder"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1 hover:bg-[#333333] rounded text-[#858585] hover:text-white transition-colors cursor-pointer"
            title="Refresh Explorer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-white' : ''}`}
            />
          </button>
          <button
            onClick={onOpenFolder}
            className="p-1 hover:bg-[#333333] rounded text-[#858585] hover:text-white transition-colors cursor-pointer"
            title="Switch Workspace Folder"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#007acc]" />
          </button>
        </div>
      </div>

      {/* Filter Quick-Search Input */}
      <div className="px-2 py-1.5 border-b border-[#1e1e1e] bg-[#1e1e1e]/60">
        <div className="relative flex items-center">
          <Search className="w-3 h-3 absolute left-2 text-[#71717A]" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter files..."
            className="w-full bg-[#181818] border border-[#333333] focus:border-[#007acc] rounded pl-7 pr-2 py-1 text-[11px] font-mono text-[#e4e4e7] placeholder-[#666666] outline-none"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute right-2 text-[#71717A] hover:text-white text-xs"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Main Tree Scroll Container */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden text-[12px] font-mono">
        {/* SECTION 1: OPEN EDITORS */}
        {openTabs.length > 0 && (
          <div className="border-b border-[#1e1e1e]">
            <div
              onClick={() => setOpenEditorsExpanded(!openEditorsExpanded)}
              className="px-2 py-1 flex items-center gap-1.5 text-[11px] font-bold text-[#aaaaaa] hover:text-white hover:bg-[#2a2d2e] cursor-pointer"
            >
              {openEditorsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#888888]" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#888888]" />
              )}
              <span className="uppercase text-[10px] tracking-wider">
                OPEN EDITORS ({openTabs.length})
              </span>
            </div>

            {openEditorsExpanded && (
              <div className="space-y-0.5 pb-1">
                {openTabs.map((tab) => {
                  const isActive = tab.path === activeTabPath;
                  return (
                    <div
                      key={tab.path}
                      onClick={() => onSelectTab(tab.path)}
                      className={`group flex items-center justify-between px-3 py-1 cursor-pointer transition-colors ${
                        isActive
                          ? 'bg-[#37373d] text-white font-medium'
                          : 'text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-3.5 h-3.5 text-[#007acc] shrink-0" />
                        <span className="truncate text-[11px]">{tab.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {tab.isDirty && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-[#FF981F] shrink-0 mr-1"
                            title="Unsaved changes"
                          />
                        )}
                        <button
                          onClick={(e) => onCloseTab(tab.path, e)}
                          className="p-0.5 rounded hover:bg-[#454545] text-[#888888] hover:text-white transition-opacity opacity-0 group-hover:opacity-100"
                          title="Close"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* SECTION 2: WORKSPACE FOLDER & FILES */}
        <div>
          {/* Workspace Root Accordion Header */}
          <div
            onClick={() => setFilesExpanded(!filesExpanded)}
            className="px-2 py-1.5 flex items-center justify-between text-[11px] font-bold text-[#e1e1e1] hover:bg-[#2a2d2e] cursor-pointer bg-[#202020]"
          >
            <div className="flex items-center gap-1.5 truncate">
              {filesExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-[#888888] shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-[#888888] shrink-0" />
              )}
              <FolderOpen className="w-3.5 h-3.5 text-[#007acc] shrink-0" />
              <span className="truncate tracking-wide uppercase text-[10px]">
                {workspaceFolderName}
              </span>
            </div>

            <span
              onClick={(e) => {
                e.stopPropagation();
                onOpenFolder();
              }}
              className="text-[9px] text-[#007acc] hover:underline px-1"
              title={workspaceRoot}
            >
              Switch
            </span>
          </div>

          {/* Current Path Breadcrumb Navigation */}
          {currentPath && (
            <div className="px-3 py-1.5 bg-[#1a1a1a] border-b border-[#222222] flex items-center justify-between text-[10px] text-[#888888] flex-wrap gap-1">
              <div className="flex items-center gap-1 flex-wrap overflow-hidden">
                <button
                  onClick={() => onOpenFile({ name: 'root', path: '', isDirectory: true, size: 0, ext: '' })}
                  className="hover:text-white text-[#007acc] cursor-pointer"
                  title="Go to workspace root"
                >
                  root
                </button>
                {currentPath.split(/[/\\]/).filter(Boolean).map((segment, idx, arr) => {
                  const subPath = arr.slice(0, idx + 1).join('/');
                  const isLast = idx === arr.length - 1;
                  return (
                    <span key={subPath} className="flex items-center gap-1">
                      <span className="text-[#555555]">/</span>
                      {isLast ? (
                        <span className="text-white font-medium truncate max-w-[90px]">{segment}</span>
                      ) : (
                        <button
                          onClick={() => onOpenFile({ name: segment, path: subPath, isDirectory: true, size: 0, ext: '' })}
                          className="hover:text-white text-[#aaaaaa] cursor-pointer truncate max-w-[80px]"
                        >
                          {segment}
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              <button
                onClick={onNavigateUp}
                className="hover:text-white px-1.5 py-0.5 rounded bg-[#252526] hover:bg-[#333333] text-[9px] text-[#cccccc] cursor-pointer ml-auto"
                title="Go up one folder"
              >
                Up ⇡
              </button>
            </div>
          )}

          {/* Files Tree */}
          {filesExpanded && (
            <div className="py-1 space-y-0.5">
              {filteredFiles.length === 0 ? (
                <div className="px-4 py-6 text-center text-[#666666] text-[11px]">
                  {isLoading ? 'Loading workspace...' : 'No files found'}
                </div>
              ) : (
                filteredFiles.map((item) => {
                  const isSelected = activeTabPath === item.path;
                  return (
                    <div
                      key={item.path}
                      onClick={() => onOpenFile(item)}
                      className={`group flex items-center justify-between px-3 py-1 rounded-xs cursor-pointer text-[11px] transition-colors ${
                        isSelected
                          ? 'bg-[#37373d] text-white font-medium border-l-2 border-[#007acc]'
                          : 'text-[#cccccc] hover:bg-[#2a2d2e] hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {getFileIcon(item)}
                        <span className="truncate">{item.name}</span>
                      </div>

                      {/* File Hover Actions: Rename, Delete */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRename(item);
                          }}
                          className="p-1 rounded hover:bg-[#454545] text-[#888888] hover:text-white"
                          title="Rename"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(item.path);
                          }}
                          className="p-1 rounded hover:bg-[#454545] text-[#888888] hover:text-[#FF384C]"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
