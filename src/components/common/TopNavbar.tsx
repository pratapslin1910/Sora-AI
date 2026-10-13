import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Code2,
  Settings,
  Sparkles,
  ChevronDown,
  UserRound,
} from 'lucide-react';
import { GatewayHealth } from '../../services/chatService';

export type WorkspaceTab = 'assistant' | 'ide';

interface TopNavbarProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  gatewayStatus: GatewayHealth;
  onOpenSettings?: () => void;
}

export const TopNavbar: React.FC<TopNavbarProps> = ({
  activeTab,
  onTabChange,
  gatewayStatus,
  onOpenSettings,
}) => {
  const tabs: { id: WorkspaceTab; label: string; icon: React.ElementType }[] = [
    { id: 'assistant', label: 'ASSISTANT', icon: Bot },
    { id: 'ide',       label: 'IDE',       icon: Code2 },
  ];

  const isLive = gatewayStatus.ok;
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <header className="h-[52px] bg-[#000000] border-b border-[#222222] flex items-center justify-between px-4 select-none shrink-0 z-50">
      {/* Left: Brand */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#0e0e0e] border border-[#262626] text-[#2684FF] shadow-sm">
          <Sparkles className="w-4 h-4 text-[#2684FF]" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold tracking-wider text-[13px] text-[#FFFFFF]">
              SORA AI
            </span>
            <span className="text-[10px] font-mono-terminal px-1.5 py-0.2 rounded bg-[#141414] text-[#A1A1AA] border border-[#27272A]">
              v1.0
            </span>
          </div>
          <p className="text-[9px] font-mono-terminal text-[#71717A] tracking-widest uppercase">
            AI WORKSPACE
          </p>
        </div>
      </div>

      {/* Center: Navigation Tabs */}
      <nav className="flex items-center gap-1 bg-[#0a0a0a] p-1 rounded-lg border border-[#222222]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-[11px] font-semibold tracking-wider transition-all duration-150 ${
                isActive
                  ? 'bg-[#1c1c1c] text-[#FFFFFF] border border-[#383838] shadow-sm'
                  : 'text-[#888888] hover:text-[#E4E4E7] hover:bg-[#121212] border border-transparent'
              }`}
            >
              <Icon
                className={`w-3.5 h-3.5 ${isActive ? 'text-[#2684FF]' : 'text-[#888888]'}`}
              />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Right: Telemetry & Controls */}
      <div className="flex items-center gap-2.5">
        {/* Gateway status */}
        <div
          title={isLive ? 'Gateway Connected' : 'Connecting to Gateway...'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono-terminal border ${
            isLive
              ? 'bg-[#00D99A]/10 text-[#00D99A] border-[#00D99A]/30'
              : 'bg-[#FF981F]/10 text-[#FF981F] border-[#FF981F]/30'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isLive ? 'bg-[#00D99A] live-blink' : 'bg-[#FF981F]'
            }`}
          />
          <span className="font-semibold">{isLive ? 'LIVE' : 'SYNCING'}</span>
          <ChevronDown className="w-3 h-3 opacity-60 ml-0.5" />
        </div>

        {/* Profile menu: settings live in the avatar dropdown. */}
        <div className="relative" ref={profileMenuRef}>
          <button
            type="button"
            aria-label="Profile menu"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((open) => !open)}
            className="h-9 flex items-center gap-2 px-2 rounded-lg bg-[#141414] border border-[#262626] hover:border-[#383838] text-white transition-colors"
          >
            <span className="w-6 h-6 rounded-md bg-[#252526] border border-[#383838] flex items-center justify-center">
              <UserRound className="w-3.5 h-3.5" />
            </span>
            <span className="text-[11px] font-semibold">Profile</span>
            <ChevronDown className={`w-3 h-3 text-[#888888] transition-transform ${profileMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {profileMenuOpen && (
            <div role="menu" className="absolute right-0 top-11 w-48 rounded-xl bg-[#111111] border border-[#2a2a2a] shadow-2xl p-1.5 z-[100]">
              <div className="px-2.5 py-2 border-b border-white/[0.07] mb-1">
                <p className="text-xs font-semibold text-white">Sora Workspace</p>
                <p className="text-[10px] text-slate-500">Local assistant</p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false);
                  onOpenSettings?.();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-xs text-slate-300 hover:text-white hover:bg-white/[0.07]"
              >
                <Settings className="w-4 h-4 text-[#60a5fa]" /> Settings
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
