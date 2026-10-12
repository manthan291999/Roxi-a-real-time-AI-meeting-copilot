import React, { useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { WidgetHeader } from '../shell/WidgetHeader';
import { IdleScreen, MeetingContextModal, useCaptureFlow } from '../features/capture';
import { LiveSessionDashboard } from '../features/session';
import { ChatThreadProvider, useChatThreadContext, useLiveTranscriptContext } from '../features/chat';
import { TranscriptProvider } from '../features/transcript';
import { SuggestAnswersProvider } from '../features/suggest';
import { HistoryPane, MeetingDetailModal, useHistory, useMeetingDetail } from '../features/history';
import { ProjectLibrary } from '../features/library/ProjectLibrary';
import { SettingsPane } from '../features/settings';
import { AppView } from '../shared/types/ui';
import { AccountProvider, AuthGate, ImportHistoryPrompt } from '../features/auth';
import { TrialNotice, TrialPill, TrialProvider, UpgradeModal, useTrial } from '../features/billing';

/**
 * The ready screen plus the data it shows. Mounted only while idle, so the
 * Recent list reloads each time a capture ends and the user lands back here.
 */
const IdleHome: React.FC<Omit<React.ComponentProps<typeof IdleScreen>, 'recentMeetings' | 'onOpenMeeting'>> = (props) => {
  const { meetings } = useHistory();
  const { selectedMeeting, isLoadingDetail, openMeeting, closeMeeting } = useMeetingDetail();

  return (
    <>
      <IdleScreen {...props} recentMeetings={meetings} onOpenMeeting={openMeeting} />
      <MeetingDetailModal meeting={selectedMeeting} onClose={closeMeeting} isLoading={isLoadingDetail} />
    </>
  );
};

/**
 * Composition root: picks the screen for the current step and wires panes to
 * hooks. Flow rules live in useCaptureFlow, not here.
 *
 * Takes `capture` as a prop rather than calling useCaptureFlow() itself: its
 * sessionId also has to reach TranscriptProvider/SuggestAnswersProvider, which
 * wrap this component from outside, so the single call lives in SignedInApp and both
 * sides read from it.
 */
const AppContent: React.FC<{ capture: ReturnType<typeof useCaptureFlow> }> = ({ capture }) => {
  const { status, provider, blackholeMissing, recheckBlackhole, isCollectingContext, isStopping, sessionId, lastError, requestContext, cancelContext, confirmContext, stopCapture } =
    capture;
  const [activeView, setActiveView] = useState<AppView>('session');
  const { askQuestion } = useChatThreadContext('ask');
  const getLiveContext = useLiveTranscriptContext();
  const trial = useTrial();

  // Every capture that ends lands here, so this is when the trial figure moves.
  const refreshTrial = trial.refresh;
  React.useEffect(() => {
    if (status === 'idle') void refreshTrial();
  }, [status, refreshTrial]);

  // Once the trial is used up, Start shows the plans instead of the intake.
  const handleStart = trial.isExhausted ? trial.openUpgrade : requestContext;

  const askAndFocusChat = (question: string) => {
    if (question.trim()) askQuestion(question, getLiveContext());
  };

  const handleStop = React.useCallback(async () => {
    await stopCapture();
  }, [stopCapture]);

  const goLive = React.useCallback(() => setActiveView('session'), []);

  return (
    <AppShell>
      <WidgetHeader
        isLive={status === 'live'}
        isConnecting={status === 'connecting'}
        isStopping={isStopping}
        sessionId={sessionId}
        activeView={activeView}
        onStop={handleStop}
        onHistory={() => setActiveView(activeView === 'history' ? 'session' : 'history')}
        onLibrary={() => setActiveView(activeView === 'library' ? 'session' : 'library')}
        onSettings={() => setActiveView(activeView === 'settings' ? 'session' : 'settings')}
        onGoLive={goLive}
        trialBadge={<TrialPill isLive={status === 'live'} />}
      />

      {status === 'idle' && activeView !== 'history' && activeView !== 'library' && activeView !== 'settings' ? (
        <>
          <IdleHome
            onStart={handleStart}
            onHistory={() => setActiveView('history')}
            onLibrary={() => setActiveView('library')}
            blackholeMissing={blackholeMissing}
            onRecheckBlackhole={recheckBlackhole}
            lastError={lastError}
            notice={<TrialNotice />}
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
        // No padding or outer scroll: the pane's columns run edge to edge and each scrolls on its own.
        <div className="flex-1 min-h-0 overflow-hidden relative border-t border-[var(--t-hairline-soft)] animate-fade-in">
          <HistoryPane isLive={status === 'live'} onGoLive={goLive} />
        </div>
      ) : activeView === 'settings' ? (
        <SettingsPane
          isLive={status === 'live'}
          isConnecting={status === 'connecting'}
          provider={provider}
          sessionId={sessionId}
          blackholeMissing={blackholeMissing}
          onRecheckBlackhole={recheckBlackhole}
          onOpenLibrary={() => setActiveView('library')}
        />
      ) : (
        <LiveSessionDashboard
          isLive={status === 'live'}
          onAskChat={askAndFocusChat}
          getLiveContext={getLiveContext}
        />
      )}
      <ImportHistoryPrompt />
      <UpgradeModal />
    </AppShell>
  );
};

/**
 * Called here, above both providers, purely so its sessionId can reach them —
 * see AppContent's doc comment. Everything else about capture still flows
 * down to AppContent unchanged.
 */
const SignedInApp: React.FC = () => {
  const capture = useCaptureFlow();

  return (
    <TrialProvider>
      <ChatThreadProvider>
        <TranscriptProvider sessionId={capture.sessionId}>
          <SuggestAnswersProvider sessionId={capture.sessionId}>
            <AppContent capture={capture} />
          </SuggestAnswersProvider>
        </TranscriptProvider>
      </ChatThreadProvider>
    </TrialProvider>
  );
};

/**
 * The gate sits above the capture flow so nothing (capture hooks, chat
 * threads, event subscriptions) mounts before the user has signed in.
 */
export const App: React.FC = () => (
  <AccountProvider>
    <AuthGate>
      <SignedInApp />
    </AuthGate>
  </AccountProvider>
);
