import React from 'react';
import {
  Bot,
  Code2,
  Settings,
  Sparkles,
  ChevronDown,
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

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="w-8 h-8 rounded-lg bg-[#0e0e0e] border border-[#222222] flex items-center justify-center text-[#888888] hover:text-[#FFFFFF] hover:border-[#383838] transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* User avatar */}
        <div className="w-8 h-8 rounded-lg bg-[#141414] border border-[#262626] flex items-center justify-center text-[#FFFFFF] font-semibold text-[11px] cursor-pointer hover:border-[#383838] transition-colors">
          <span>S</span>
        </div>
      </div>
    </header>
  );
};
