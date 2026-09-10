import React, { useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { WidgetHeader } from '../shell/WidgetHeader';
import { IdleScreen, MeetingContextModal, useCaptureFlow } from '../features/capture';
import { LiveSessionDashboard } from '../features/session';
import { ChatThreadProvider, useChatThreadContext, useLiveTranscriptContext } from '../features/chat';
import { HistoryPane } from '../features/history';
import { ProjectLibrary } from '../features/library/ProjectLibrary';
import { AppView } from '../shared/types/ui';

/**
 * Composition root: picks the screen for the current step and wires panes to
 * hooks. Flow rules live in useCaptureFlow, not here.
 */
const AppContent: React.FC = () => {
  const { status, blackholeMissing, isCollectingContext, isStopping, sessionId, requestContext, cancelContext, confirmContext, stopCapture } =
    useCaptureFlow();
  const [activeView, setActiveView] = useState<AppView>('session');
  const { askQuestion } = useChatThreadContext('ask');
  const getLiveContext = useLiveTranscriptContext();

  const askAndFocusChat = (question: string) => {
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
        onHistory={() => setActiveView(activeView === 'history' ? 'session' : 'history')}
        onLibrary={() => setActiveView(activeView === 'library' ? 'session' : 'library')}
      />

      {status === 'idle' && activeView !== 'history' && activeView !== 'library' ? (
        <>
          <IdleScreen
            onStart={requestContext}
            onHistory={() => setActiveView('history')}
            onLibrary={() => setActiveView('library')}
            blackholeMissing={blackholeMissing}
          />
          {isCollectingContext && (
            <MeetingContextModal onConfirm={confirmContext} onCancel={cancelContext} />
          )}
        </>
      ) : activeView === 'library' ? (
        <div className="flex-1 overflow-hidden animate-fade-in">
          <ProjectLibrary />
        </div>
      ) : activeView === 'history' ? (
        <div className="flex-1 overflow-y-auto px-5 pt-4 relative custom-scrollbar flex flex-col gap-4 animate-fade-in">
          <HistoryPane />
        </div>
      ) : (
        <LiveSessionDashboard
          isLive={status === 'live'}
          onAskChat={askAndFocusChat}
          getLiveContext={getLiveContext}
        />
      )}
    </AppShell>
  );
};

export const App: React.FC = () => (
  <ChatThreadProvider>
    <AppContent />
  </ChatThreadProvider>
);
