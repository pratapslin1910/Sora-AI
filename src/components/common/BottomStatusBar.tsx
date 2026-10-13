import React, { useState, useEffect } from 'react';
import { Clock3, Cpu } from 'lucide-react';
import { GatewayHealth } from '../../services/chatService';

interface BottomStatusBarProps {
  gatewayStatus: GatewayHealth;
}

export const BottomStatusBar: React.FC<BottomStatusBarProps> = ({
  gatewayStatus,
}) => {
  const [localTime, setLocalTime] = useState<string>('');
  const [activeModel, setActiveModel] = useState('Waiting for first request');
  const [activeTask, setActiveTask] = useState('Idle');
  const [isModelActive, setIsModelActive] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setLocalTime(new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      }).format(now));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const isLive = gatewayStatus.ok;

  useEffect(() => {
    const onModelActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ type: string; model?: string; task?: string; error?: string }>).detail;
      if (!detail) return;
      if (detail.type === 'start') {
        setIsModelActive(true);
        setActiveTask(detail.task || 'Assistant');
        setActiveModel(detail.model || 'Resolving model…');
      } else if (detail.type === 'model') {
        setActiveModel(detail.model || 'Unknown model');
        if (detail.task) setActiveTask(detail.task);
      } else if (detail.type === 'done') {
        setIsModelActive(false);
        if (detail.model) setActiveModel(detail.model);
        setActiveTask('Idle');
      } else if (detail.type === 'error') {
        setIsModelActive(false);
        setActiveTask('Error');
        setActiveModel(detail.error || 'Request failed');
      }
    };
    window.addEventListener('sora:model-activity', onModelActivity);
    return () => window.removeEventListener('sora:model-activity', onModelActivity);
  }, []);

  return (
    <footer className="h-[34px] bg-[#000000] border-t border-[#222222] flex items-center justify-between px-4 text-[11px] font-mono-terminal select-none shrink-0 z-40 text-[#71717A]">
      {/* 1. FreeLLMAPI Gateway */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${
            isLive ? 'bg-[#00D99A] live-blink' : 'bg-[#FF384C]'
          }`}
        />
        <span className="font-semibold text-[#E4E4E7]">FreeLLMAPI:</span>
        <span className="text-[#A1A1AA]">{gatewayStatus.model || 'auto'}</span>
        <span className="text-[#3F3F46]">|</span>
        <span className="text-[#00D99A]">
          {isLive ? 'Port 31415 Active' : 'Port 31415 Standby'}
        </span>
      </div>

      {/* Runtime model loader — populated by actual chat stream responses. */}
      <div className="hidden md:flex items-center gap-2 border-l border-[#222222] pl-4 min-w-0" title={`Task: ${activeTask}; Model: ${activeModel}`}>
        <Cpu className={`w-3.5 h-3.5 ${isModelActive ? 'text-[#60a5fa] animate-pulse' : 'text-[#71717A]'}`} />
        <span className="text-[#71717A]">Model</span>
        <span className="text-[#D4D4D8] font-semibold truncate max-w-[190px]">{activeModel}</span>
        <span className={`text-[10px] ${isModelActive ? 'text-[#60a5fa]' : 'text-[#71717A]'}`}>{activeTask}</span>
      </div>

      {/* Local system clock */}
      <div className="hidden lg:flex items-center gap-2 border-l border-[#222222] pl-4">
        <Clock3 className="w-3.5 h-3.5 text-[#71717A]" />
        <span className="text-[#71717A]">Local Time</span>
        <span className="text-[#D4D4D8]">{localTime}</span>
      </div>
    </footer>
  );
};

