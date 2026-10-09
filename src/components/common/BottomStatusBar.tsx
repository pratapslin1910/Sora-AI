import React, { useState, useEffect } from 'react';
import { Globe, CheckCircle2 } from 'lucide-react';
import { GatewayHealth } from '../../services/chatService';

interface BottomStatusBarProps {
  gatewayStatus: GatewayHealth;
}

export const BottomStatusBar: React.FC<BottomStatusBarProps> = ({
  gatewayStatus,
}) => {
  const [utcTime, setUtcTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZone: 'UTC',
      };
      setUtcTime(`${now.toLocaleDateString('en-GB', options).toUpperCase()} UTC`);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const isLive = gatewayStatus.ok;

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

      {/* 2. Last Updated (Live UTC) */}
      <div className="hidden lg:flex items-center gap-2 border-l border-[#222222] pl-4">
        <Globe className="w-3.5 h-3.5 text-[#71717A]" />
        <span className="text-[#71717A]">UTC Clock</span>
        <span className="text-[#D4D4D8]">{utcTime}</span>
      </div>

      {/* 3. System Status */}
      <div className="flex items-center gap-2 border-l border-[#222222] pl-4">
        <CheckCircle2 className="w-3.5 h-3.5 text-[#00D99A]" />
        <span className="text-[#71717A]">System Status</span>
        <span className="text-[#00D99A] font-medium">All Systems Operational</span>
      </div>
    </footer>
  );
};

