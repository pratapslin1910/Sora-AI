import { useState, useEffect, useCallback } from 'react';
import { TopNavbar, WorkspaceTab } from './components/common/TopNavbar';
import { BottomStatusBar } from './components/common/BottomStatusBar';
import { AssistantView } from './views/AssistantView';
import { IDEView } from './views/IDEView';
import { checkGatewayHealth, GatewayHealth } from './services/chatService';

function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('assistant');
  const [ideMounted, setIdeMounted] = useState(false);
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

  const handleTabChange = (tab: WorkspaceTab) => {
    setActiveTab(tab);
    if (tab === 'ide') setIdeMounted(true);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('sora:tab-change'));
      window.speechSynthesis?.cancel();
    }
  };

  // IDE can ask Sora a question → jump to Assistant tab
  const handleAskAssistant = (prompt: string) => {
    setAssistantPrompt(prompt);
    handleTabChange('assistant');
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#000000] text-[#E4E4E7]">
      {/* Top Nav */}
      <TopNavbar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        gatewayStatus={gatewayStatus}
        onOpenSettings={() => {
          handleTabChange('assistant');
          setSettingsOpen(true);
        }}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative flex bg-[#000000]">
        <div
          className={activeTab === 'assistant' ? 'flex flex-1 min-w-0 min-h-0' : 'hidden'}
          aria-hidden={activeTab !== 'assistant'}
        >
          <AssistantView
            initialPrompt={assistantPrompt}
            onClearInitialPrompt={() => setAssistantPrompt(undefined)}
            settingsOpen={settingsOpen}
            onSettingsOpenChange={setSettingsOpen}
          />
        </div>

        {ideMounted && (
          <div
            className={activeTab === 'ide' ? 'flex flex-1 min-w-0 min-h-0' : 'hidden'}
            aria-hidden={activeTab !== 'ide'}
          >
            <IDEView onAskAssistant={handleAskAssistant} />
          </div>
        )}
      </main>

      {/* Bottom Status Bar */}
      <BottomStatusBar gatewayStatus={gatewayStatus} />


    </div>
  );
}

export default App;