import { useState, useEffect, useCallback } from 'react';
import { TopNavbar, WorkspaceTab } from './components/common/TopNavbar';
import { BottomStatusBar } from './components/common/BottomStatusBar';
import { AssistantView } from './views/AssistantView';
import { IDEView } from './views/IDEView';
import { checkGatewayHealth, GatewayHealth } from './services/chatService';

function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('assistant');
  const [gatewayStatus, setGatewayStatus] = useState<GatewayHealth>({
    ok: false,
    status: 'checking',
    model: 'auto',
  });
  const [assistantPrompt, setAssistantPrompt] = useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const pollGateway = useCallback(async () => {
    try {
      const health = await checkGatewayHealth();
      setGatewayStatus(health);
    } catch {
      setGatewayStatus({ ok: false, status: 'unreachable', model: 'unknown' });
    }
  }, []);

  useEffect(() => {
    pollGateway();
    const interval = setInterval(pollGateway, 15000);
    return () => clearInterval(interval);
  }, [pollGateway]);

  // IDE can ask Sora a question → jump to Assistant tab
  const handleAskAssistant = (prompt: string) => {
    setAssistantPrompt(prompt);
    setActiveTab('assistant');
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#000000] text-[#E4E4E7]">
      {/* Top Nav */}
      <TopNavbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        gatewayStatus={gatewayStatus}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative flex bg-[#000000]">
        {activeTab === 'assistant' && (
          <AssistantView
            initialPrompt={assistantPrompt}
            onClearInitialPrompt={() => setAssistantPrompt(undefined)}
          />
        )}

        {activeTab === 'ide' && (
          <IDEView onAskAssistant={handleAskAssistant} />
        )}
      </main>

      {/* Bottom Status Bar */}
      <BottomStatusBar gatewayStatus={gatewayStatus} />

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[1000] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0e0e0e] border border-[#262626] rounded-xl max-w-md w-full p-5 text-[#E4E4E7] shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#222222] mb-4">
              <h3 className="text-[13px] font-bold tracking-wider text-white">
                SETTINGS
              </h3>
              <button
                onClick={() => setSettingsOpen(false)}
                className="text-[#71717A] hover:text-[#FFFFFF] p-1 rounded hover:bg-[#181818]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-[11px] font-mono-terminal">
              <div className="flex justify-between py-1.5 border-b border-[#1c1c1c]">
                <span className="text-[#71717A]">Gateway Port</span>
                <span className="text-[#00D99A]">31415 (Active)</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1c1c1c]">
                <span className="text-[#71717A]">Gateway Base URL</span>
                <span className="text-[#D4D4D8]">http://127.0.0.1:31415/v1</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-[#1c1c1c]">
                <span className="text-[#71717A]">Selected Model</span>
                <span className="text-[#FFFFFF] font-semibold">{gatewayStatus.model || 'auto'}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-[#71717A]">Vector DB Engine</span>
                <span className="text-[#D4D4D8]">LanceDB (Embedded Local)</span>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-[#222222] flex justify-end">
              <button
                onClick={() => setSettingsOpen(false)}
                className="px-4 py-1.5 bg-[#1c1c1c] hover:bg-[#262626] border border-[#333333] text-white rounded-lg text-[11px] font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;