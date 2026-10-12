import React, { useEffect, useState } from 'react';
import pkg from '../../../package.json';
import {
  tokens,
  Toggle,
  UserCircleIcon,
  MicIcon,
  SpeakerWaveIcon,
  RoxiMark,
  RoxiWordmark,
  ChatBubbleIcon,
  LibraryIcon,
  ShieldCheckIcon,
  KeyboardIcon,
  SlidersIcon,
  InfoIcon,
  CoinIcon,
} from '../../design-system';
import { useServices } from '../../context/useServices';
import { useChatThreadContext } from '../chat';
import { useDocumentLibrary } from '../library/useDocumentLibrary';
import { AccountSection, ImportHistoryGroup } from './AccountSection';
import { PlanSection } from '../billing/PlanSection';
import { SettingsGroup, SettingsRow, RowValue, StatusValue, SettingsButton, Keys } from './settingsUi';

/** Everything a category pane may need from the app around it. */
export interface SettingsContext {
  isLive: boolean;
  isConnecting: boolean;
  provider: string;
  sessionId: number | null;
  blackholeMissing: boolean;
  onRecheckBlackhole?: () => Promise<void> | void;
  onOpenLibrary?: () => void;
}

export interface SettingsCategory {
  id: string;
  label: string;
  subtitle: string;
  icon: React.FC<{ className?: string }>;
  /** Extra words the sidebar search matches, so "blackhole" finds Audio & Capture. */
  keywords: string;
  Pane: React.FC<SettingsContext>;
}

// ── Audio & Capture ───────────────────────────────────────────────────────

const AudioPane: React.FC<SettingsContext> = ({ isLive, isConnecting, provider, sessionId, blackholeMissing, onRecheckBlackhole }) => {
  const [checking, setChecking] = useState(false);
  const status = isLive ? 'Live' : isConnecting ? 'Connecting' : 'Not recording';

  return (
    <>
      <SettingsGroup
        title="Audio sources"
        footer={
          blackholeMissing
            ? 'To hear the other people on a call, install BlackHole with “brew install blackhole-2ch”, add it to a Multi-Output Device in Audio MIDI Setup, and make that device your sound output.'
            : 'Roxi hears you through the microphone and everyone else through BlackHole 2ch.'
        }
      >
        <SettingsRow icon={<MicIcon className="w-3.5 h-3.5" />} label="Microphone">
          <RowValue>System default input</RowValue>
        </SettingsRow>
        <SettingsRow icon={<SpeakerWaveIcon className="w-3.5 h-3.5" />} label="System audio" detail="BlackHole 2ch virtual device">
          <StatusValue tone={blackholeMissing ? 'warn' : 'ok'}>{blackholeMissing ? 'Not installed' : 'Installed'}</StatusValue>
          {blackholeMissing && onRecheckBlackhole && (
            <SettingsButton
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                try {
                  await onRecheckBlackhole();
                } finally {
                  setChecking(false);
                }
              }}
            >
              {checking ? 'Checking…' : 'Check Again'}
            </SettingsButton>
          )}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Current session">
        <SettingsRow label="Status">
          <StatusValue tone={isLive ? 'ok' : isConnecting ? 'warn' : 'idle'}>{status}</StatusValue>
        </SettingsRow>
        {(isLive || isConnecting) && (
          <>
            <SettingsRow label="Transcription provider"><RowValue>{provider || '—'}</RowValue></SettingsRow>
            <SettingsRow label="Session ID"><RowValue mono>{sessionId != null ? String(sessionId) : '—'}</RowValue></SettingsRow>
          </>
        )}
      </SettingsGroup>
    </>
  );
};

// ── Ask Roxi ──────────────────────────────────────────────────────────────

const KnowledgeRow: React.FC<{ threadId: 'ask' | 'history'; label: string; detail: string }> = ({ threadId, label, detail }) => {
  const { mode, setMode, isLoading } = useChatThreadContext(threadId);
  return (
    <SettingsRow label={label} detail={detail}>
      <Toggle
        id={`settings-knowledge-${threadId}`}
        checked={mode !== 'direct'}
        onChange={(on) => setMode(on ? 'rag' : 'direct')}
        label={`Knowledge for ${label}`}
        disabled={isLoading}
        className="[&>div]:sr-only"
      />
    </SettingsRow>
  );
};

const AskPane: React.FC<SettingsContext> = () => (
  <>
    <SettingsGroup
      title="Knowledge"
      footer="With Knowledge on, Roxi searches your meetings and documents and cites where each answer came from. Off, it answers from the AI model alone. The same switch sits above each chat box."
    >
      <KnowledgeRow threadId="ask" label="During meetings" detail="The Ask Roxi panel in a live session" />
      <KnowledgeRow threadId="history" label="Past Meetings" detail="Ask Roxi in the Past Meetings view" />
    </SettingsGroup>
    <SettingsGroup title="How answers are found" footer="Web search and the chat model are set in the .env file. See Advanced.">
      <SettingsRow label="Meeting history" detail="Keyword search over every transcript"><RowValue>Full-text index</RowValue></SettingsRow>
      <SettingsRow label="Documents" detail="Meaning-based search over the files in your Library"><RowValue>Vector search</RowValue></SettingsRow>
    </SettingsGroup>
  </>
);

// ── Library ───────────────────────────────────────────────────────────────

const LibraryPane: React.FC<SettingsContext> = ({ onOpenLibrary }) => {
  const { documents } = useDocumentLibrary(0);
  const { projectRepository } = useServices();
  const [projectCount, setProjectCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    projectRepository.list().then((p) => alive && setProjectCount(p.length)).catch(() => alive && setProjectCount(null));
    return () => {
      alive = false;
    };
  }, [projectRepository]);

  const ready = documents.filter((d) => d.status === 'ready').length;
  const indexing = documents.filter((d) => d.status === 'indexing').length;
  const failed = documents.filter((d) => d.status === 'failed').length;

  return (
    <SettingsGroup title="Knowledge base" footer="Attach up to three of these to a meeting when you start a capture.">
      <SettingsRow label="Projects"><RowValue>{projectCount ?? '—'}</RowValue></SettingsRow>
      <SettingsRow label="Documents ready"><RowValue>{ready}</RowValue></SettingsRow>
      {indexing > 0 && (
        <SettingsRow label="Indexing"><StatusValue tone="warn">{indexing} in progress</StatusValue></SettingsRow>
      )}
      {failed > 0 && (
        <SettingsRow label="Failed to index"><StatusValue tone="warn">{failed}</StatusValue></SettingsRow>
      )}
      {onOpenLibrary && (
        <SettingsRow label="Manage projects and documents">
          <SettingsButton onClick={onOpenLibrary}>Open Library</SettingsButton>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
};

// ── Privacy & Data ────────────────────────────────────────────────────────

const PrivacyPane: React.FC<SettingsContext> = () => (
  <>
    <SettingsGroup title="Where your data lives">
      <SettingsRow label="Transcripts and meeting notes" detail="meeting_history.db on this Mac">
        <StatusValue tone="ok">On this Mac</StatusValue>
      </SettingsRow>
      <SettingsRow label="Search memory" detail="Local Qdrant stores vectors and IDs only, never the words themselves">
        <StatusValue tone="ok">On this Mac</StatusValue>
      </SettingsRow>
      <SettingsRow label="Memory retention" detail="Set with EPISODIC_RETENTION_DAYS"><RowValue>90 days by default</RowValue></SettingsRow>
    </SettingsGroup>
    <SettingsGroup
      title="Sent to AI providers"
      footer="Each provider handles this data under its own API terms. Roxi only sends what the feature needs."
    >
      <SettingsRow label="Meeting audio" detail="Streamed to your speech-to-text provider for live transcription">
        <RowValue>AssemblyAI or Speechmatics</RowValue>
      </SettingsRow>
      <SettingsRow label="Transcript text" detail="Used for explanations, suggested replies and Ask Roxi answers">
        <RowValue>OpenAI</RowValue>
      </SettingsRow>
    </SettingsGroup>
    <ImportHistoryGroup />
  </>
);

// ── Keyboard Shortcuts ────────────────────────────────────────────────────

const SHORTCUTS: { label: string; where: string; keys: string[] }[] = [
  { label: 'Show or hide Roxi', where: 'Anywhere on your Mac', keys: ['⌥', 'Space'] },
  { label: 'Start capture', where: 'New capture sheet', keys: ['⌘', '↵'] },
  { label: 'Close a sheet', where: 'New capture sheet', keys: ['Esc'] },
  { label: 'Send a question', where: 'Ask Roxi', keys: ['↵'] },
  { label: 'New line', where: 'Ask Roxi', keys: ['⇧', '↵'] },
  { label: 'Clear search', where: 'Past Meetings', keys: ['Esc'] },
];

const ShortcutsPane: React.FC<SettingsContext> = () => (
  <SettingsGroup title="Shortcuts" footer="⌥ Space works even when Roxi is hidden or another app is in front.">
    {SHORTCUTS.map((s) => (
      <SettingsRow key={s.label} label={s.label} detail={s.where}>
        <Keys keys={s.keys} />
      </SettingsRow>
    ))}
  </SettingsGroup>
);

// ── Advanced ──────────────────────────────────────────────────────────────

const ENV_SETTINGS: { name: string; label: string; detail: string }[] = [
  { name: 'STT_PROVIDER', label: 'Speech-to-text provider', detail: 'assemblyai or speechmatics' },
  { name: 'STT_LANGUAGES', label: 'Transcription languages', detail: 'Languages the provider listens for' },
  { name: 'STT_MIN_TURN_SILENCE', label: 'Turn silence (min / max)', detail: 'Also STT_MAX_TURN_SILENCE' },
  { name: 'LLM_BUDGET_SOFT', label: 'AI spend limits', detail: 'Soft warning; LLM_BUDGET_HARD stops calls' },
  { name: 'CHATBOT_MODEL', label: 'Ask Roxi model', detail: 'Also CHATBOT_LLM_ADAPTER, CHATBOT_EMBED_MODEL' },
  { name: 'CHATBOT_WEB_SEARCH_MODE', label: 'Web search', detail: 'auto, always or never' },
  { name: 'QDRANT_URL', label: 'Vector store address', detail: 'Default http://127.0.0.1:6333' },
];

const AdvancedPane: React.FC<SettingsContext> = () => (
  <SettingsGroup
    title="Configured in .env"
    footer="These live in the .env file at the root of the Roxi folder. Edit the file, then quit and reopen Roxi to apply."
  >
    {ENV_SETTINGS.map((e) => (
      <SettingsRow key={e.name} label={e.label} detail={e.detail}>
        <RowValue mono>{e.name}</RowValue>
      </SettingsRow>
    ))}
  </SettingsGroup>
);

// ── About ─────────────────────────────────────────────────────────────────

const AboutPane: React.FC<SettingsContext> = () => (
  <>
    <div
      className="flex flex-col items-center gap-2 py-7 px-6 text-center border"
      style={{ borderRadius: 10, background: tokens.card, borderColor: tokens.hairline, boxShadow: tokens.cardInset }}
    >
      <RoxiMark size={64} className="mb-1" style={{ filter: `drop-shadow(0 6px 14px ${tokens.signalLine})` }} />
      <RoxiWordmark className="text-[22px]" style={{ color: tokens.paper }} />
      <span className="text-[13px]" style={{ color: tokens.mute }}>Version {pkg.version}</span>
      <p className="mt-1 max-w-[380px] text-[13px] leading-relaxed" style={{ color: tokens.mute }}>
        Listens to your meetings, transcribes them live, and explains what was said, with decisions, action items,
        risks and suggested replies as they happen.
      </p>
    </div>
    <SettingsGroup title="Works with">
      <SettingsRow label="Meeting apps"><RowValue>Zoom, Google Meet, Teams, Slack</RowValue></SettingsRow>
      <SettingsRow label="Speech to text"><RowValue>AssemblyAI, Speechmatics</RowValue></SettingsRow>
      <SettingsRow label="AI"><RowValue>OpenAI</RowValue></SettingsRow>
    </SettingsGroup>
  </>
);

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'account', label: 'Account', subtitle: 'Your profile, workspace and plan', icon: UserCircleIcon, keywords: 'profile sign out workspace plan role email', Pane: () => <AccountSection /> },
  { id: 'audio', label: 'Audio & Capture', subtitle: 'Microphone, system audio and the current session', icon: MicIcon, keywords: 'blackhole microphone speaker session provider recording', Pane: AudioPane },
  { id: 'plan', label: 'Plan & Billing', subtitle: 'Your plan, free trial and prices in GBP', icon: CoinIcon, keywords: 'pricing price upgrade subscription trial billing pounds gbp pro team', Pane: () => <PlanSection /> },
  { id: 'ask', label: 'Ask Roxi', subtitle: 'How Roxi finds answers to your questions', icon: ChatBubbleIcon, keywords: 'chat knowledge search rag questions', Pane: AskPane },
  { id: 'library', label: 'Library', subtitle: 'Projects and reference documents', icon: LibraryIcon, keywords: 'documents projects files pdf upload', Pane: LibraryPane },
  { id: 'privacy', label: 'Privacy & Data', subtitle: 'Where your meetings are stored and who processes them', icon: ShieldCheckIcon, keywords: 'data storage retention import cloud security', Pane: PrivacyPane },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', subtitle: 'Keys that work across Roxi', icon: KeyboardIcon, keywords: 'keys hotkey option space', Pane: ShortcutsPane },
  { id: 'advanced', label: 'Advanced', subtitle: 'Providers, models and limits set in .env', icon: SlidersIcon, keywords: 'env config model budget language qdrant web', Pane: AdvancedPane },
  { id: 'about', label: 'About Roxi', subtitle: 'Version and what Roxi works with', icon: InfoIcon, keywords: 'version info', Pane: AboutPane },
];

