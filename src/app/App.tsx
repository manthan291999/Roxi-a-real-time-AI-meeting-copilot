import React, { useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { WidgetHeader } from '../shell/WidgetHeader';
import { IdleScreen, MeetingContextModal, useCaptureFlow } from '../features/capture';
import { LiveSessionDashboard } from '../features/session';
import { ChatThreadProvider, useChatThreadContext, useLiveTranscriptContext } from '../features/chat';
import { TranscriptProvider } from '../features/transcript';
import { SuggestAnswersProvider } from '../features/suggest';
import { HistoryPane } from '../features/history';
import { ProjectLibrary } from '../features/library/ProjectLibrary';
import { AppView } from '../shared/types/ui';

/**
 * Composition root: picks the screen for the current step and wires panes to
 * hooks. Flow rules live in useCaptureFlow, not here.
 *
 * Takes `capture` as a prop rather than calling useCaptureFlow() itself: its
 * sessionId also has to reach TranscriptProvider/SuggestAnswersProvider, which
 * wrap this component from outside, so the single call lives in App and both
 * sides read from it.
 */
const AppContent: React.FC<{ capture: ReturnType<typeof useCaptureFlow> }> = ({ capture }) => {
  const { status, blackholeMissing, isCollectingContext, isStopping, sessionId, lastError, requestContext, cancelContext, confirmContext, stopCapture } =
    capture;
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
            lastError={lastError}
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

/**
 * Called here, above both providers, purely so its sessionId can reach them —
 * see AppContent's doc comment. Everything else about capture still flows
 * down to AppContent unchanged.
 */
export const App: React.FC = () => {
  const capture = useCaptureFlow();

  return (
    <ChatThreadProvider>
      <TranscriptProvider sessionId={capture.sessionId}>
        <SuggestAnswersProvider sessionId={capture.sessionId}>
          <AppContent capture={capture} />
        </SuggestAnswersProvider>
      </TranscriptProvider>
    </ChatThreadProvider>
  );
};
