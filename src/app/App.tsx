import React, { useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { WidgetHeader } from '../shell/WidgetHeader';
import { NavigationTabs } from '../shell/NavigationTabs';
import { InputBar } from '../shared/ui/InputBar';
import { IdleScreen, MeetingContextModal, useCaptureFlow } from '../features/capture';
import { SuggestAnswersPane } from '../features/suggest';
import { TranscriptPane } from '../features/transcript';
import { ChatPane, ChatThreadProvider, useChatThreadContext, useLiveTranscriptContext } from '../features/chat';
import { HistoryPane } from '../features/history';
import { ProjectLibrary } from '../features/library/ProjectLibrary';
import { WidgetTab } from '../shared/types/ui';

/**
 * Composition root: picks the screen for the current step and wires panes to
 * hooks. Flow rules live in useCaptureFlow, not here.
 */
const AppContent: React.FC = () => {
  const { status, blackholeMissing, isCollectingContext, isStopping, sessionId, requestContext, cancelContext, confirmContext, stopCapture } =
    useCaptureFlow();
  const [activeTab, setActiveTab] = useState<WidgetTab>('suggest');
  const { askQuestion } = useChatThreadContext('ask');
  const getLiveContext = useLiveTranscriptContext();

  const askAndFocusChat = (question: string) => {
    setActiveTab('ask');
    if (question.trim()) askQuestion(question, getLiveContext());
  };

  const handleStop = React.useCallback(async () => {
    await stopCapture();
  }, [stopCapture]);

  return (
    <AppShell>
      <WidgetHeader
        isLive={status === 'live'}
        isConnecting={status === 'connecting'}
        isStopping={isStopping}
        sessionId={sessionId}
        onStop={handleStop}
        onHistory={() => setActiveTab(activeTab === 'history' ? 'suggest' : 'history')}
        onLibrary={() => setActiveTab(activeTab === 'library' ? 'suggest' : 'library')}
      />

      {status === 'idle' && activeTab !== 'history' && activeTab !== 'library' ? (
        <>
          <IdleScreen 
            onStart={requestContext} 
            onHistory={() => setActiveTab('history')}
            onLibrary={() => setActiveTab('library')}
            blackholeMissing={blackholeMissing} 
          />
          {isCollectingContext && (
            <MeetingContextModal onConfirm={confirmContext} onCancel={cancelContext} />
          )}
        </>
      ) : activeTab === 'library' ? (
        <ProjectLibrary />
      ) : (
        <>
          {activeTab !== 'history' && <NavigationTabs activeTab={activeTab} onChange={setActiveTab} />}
          <div className="flex-1 overflow-y-auto px-5 pt-4 relative custom-scrollbar flex flex-col gap-4">
            {activeTab === 'suggest' && <SuggestAnswersPane onAskChat={askAndFocusChat} />}
            {activeTab === 'ask' && <ChatPane threadId="ask" getLiveContext={getLiveContext} />}
            {activeTab === 'listen' && <TranscriptPane isLive={status === 'live'} />}
            {activeTab === 'history' && <HistoryPane />}
          </div>
          {activeTab !== 'history' && activeTab !== 'ask' && (
            <InputBar onSend={askAndFocusChat} />
          )}
        </>
      )}
    </AppShell>
  );
};

export const App: React.FC = () => (
  <ChatThreadProvider>
    <AppContent />
  </ChatThreadProvider>
);
