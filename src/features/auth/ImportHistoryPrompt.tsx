import React, { useState } from 'react';
import { tokens, radius, typeScale } from '../../design-system';
import { useAccount } from './AccountContext';
import { AuthNotice, PrimaryButton, SecondaryButton } from './components';
import { importPromptKey, readFlag, useLocalImport, writeFlag } from './useLocalImport';
import { ImportProgressBar, importResultText } from './ImportProgressBar';

const fmt = (n: number) => n.toLocaleString();

/**
 * First sign-in on a Mac that already has meetings: offer to move them into
 * the workspace. Shows once per user; Settings > Account can import any time.
 */
export const ImportHistoryPrompt: React.FC = () => {
  const { account, canImport } = useAccount();
  const userId = account.user?.id;
  const { stats, phase, progress, error, start } = useLocalImport();
  // Which user closed it this session. The stored flag is read on every
  // render because the account loads after this component mounts.
  const [closedFor, setClosedFor] = useState<string | null>(null);

  if (!userId || !canImport || !stats || stats.meetings === 0) return null;
  if (closedFor === userId || readFlag(importPromptKey(userId)) !== null) return null;

  const close = (flag: 'dismissed' | 'imported') => {
    writeFlag(importPromptKey(userId), flag);
    setClosedFor(userId);
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: tokens.scrim, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-prompt-title"
    >
      <div
        className="w-full max-w-[440px] flex flex-col gap-5 p-6 animate-card-enter"
        style={{
          borderRadius: radius.panel + 4,
          background: tokens.sheet,
          border: `1px solid ${tokens.hairline}`,
          boxShadow: tokens.sheetShadow,
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
        }}
      >
        <header className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: tokens.signal }}>
            Past meetings found
          </span>
          <h2 id="import-prompt-title" style={{ color: tokens.paper, fontSize: typeScale.title.fontSize + 2, fontWeight: 700, letterSpacing: typeScale.title.letterSpacing }}>
            Add your history to {account.workspace?.orgName ?? 'your workspace'}
          </h2>
          <p style={{ color: tokens.mute, fontSize: typeScale.body.fontSize, lineHeight: typeScale.body.lineHeight }}>
            This Mac has <strong style={{ color: tokens.paper }}>{fmt(stats.meetings)} meetings</strong> with{' '}
            {fmt(stats.transcriptLines)} transcript lines. Import them so they are backed up to your account and
            searchable from any device. Nothing on this Mac is changed or deleted.
          </p>
        </header>

        {phase !== 'idle' && progress && <ImportProgressBar progress={progress} done={phase === 'done'} />}
        {phase === 'done' && progress && <AuthNotice tone="success">{importResultText(progress)}</AuthNotice>}
        {phase === 'error' && error && <AuthNotice tone="error">{error}</AuthNotice>}

        <div className="flex flex-col gap-2.5">
          {phase === 'done' ? (
            <PrimaryButton type="button" onClick={() => close('imported')}>
              Done
            </PrimaryButton>
          ) : (
            <>
              <PrimaryButton type="button" loading={phase === 'running'} onClick={() => void start()}>
                {phase === 'running'
                  ? 'Importing…'
                  : phase === 'error'
                    ? 'Try again'
                    : `Import ${fmt(stats.meetings)} meetings`}
              </PrimaryButton>
              <SecondaryButton onClick={() => close('dismissed')} disabled={phase === 'running'}>
                Not now
              </SecondaryButton>
            </>
          )}
        </div>
        {phase === 'idle' && (
          <p style={{ color: tokens.muteDim, fontSize: typeScale.caption.fontSize }}>
            You can also do this later from Settings.
          </p>
        )}
      </div>
    </div>
  );
};
