import React from 'react';
import SoraChat from '../SoraChat';

interface AssistantViewProps {
  initialPrompt?: string;
  onClearInitialPrompt?: () => void;
  settingsOpen?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
  onDelegateToCopilot?: (task: string) => void;
}

export const AssistantView: React.FC<AssistantViewProps> = ({
  initialPrompt,
  onClearInitialPrompt,
  settingsOpen,
  onSettingsOpenChange,
  onDelegateToCopilot,
}) => {
  return (
    <div className="flex-1 w-full h-full overflow-hidden bg-[#080808]">
      <SoraChat
        initialPrompt={initialPrompt}
        onClearInitialPrompt={onClearInitialPrompt}
        settingsOpen={settingsOpen}
        onSettingsOpenChange={onSettingsOpenChange}
        onDelegateToCopilot={onDelegateToCopilot}
      />
    </div>
  );
};
