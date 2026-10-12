import React, { useState } from 'react';
import { tokens } from '../../design-system';
import { useAccount } from '../auth/AccountContext';
import { useLocalImport } from '../auth/useLocalImport';
import { ImportProgressBar, importResultText } from '../auth/ImportProgressBar';
import { SettingsGroup, SettingsRow, RowValue, SettingsButton, StatusValue } from './settingsUi';

const PLAN_LABEL: Record<string, string> = { free: 'Free', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export function initials(name: string | null, email: string | null): string {
  const source = (name ?? '').trim() || (email ?? '').split('@')[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** The round initials badge, at sidebar size or pane size. */
export const Avatar: React.FC<{ name: string | null; email: string | null; size: number }> = ({ name, email, size }) => (
  <span
    aria-hidden="true"
    className="shrink-0 rounded-full flex items-center justify-center font-bold"
    style={{ width: size, height: size, fontSize: size * 0.38, background: tokens.signalDim, color: tokens.signal }}
  >
    {initials(name, email)}
  </span>
);

/** Settings › Account: who is signed in, the workspace, and signing out. */
export const AccountSection: React.FC = () => {
  const { account, signOut } = useAccount();
  const [signingOut, setSigningOut] = useState(false);

  if (!account.configured) {
    return (
      <SettingsGroup
        title="Account"
        footer="Add SUPABASE_URL and SUPABASE_ANON_KEY to the .env file at the repo root to turn on accounts and cloud workspaces."
      >
        <SettingsRow label="Local-only mode" detail="Meetings stay on this Mac. No sign-in needed.">
          <StatusValue tone="ok">On this Mac</StatusValue>
        </SettingsRow>
      </SettingsGroup>
    );
  }

  const user = account.user;
  if (!user) return null;
  const ws = account.workspace;

  return (
    <>
      <div
        className="flex items-center gap-4 p-4 border"
        style={{ borderRadius: 10, background: tokens.card, borderColor: tokens.hairline, boxShadow: tokens.cardInset }}
      >
        <Avatar name={user.fullName} email={user.email} size={52} />
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-[15px] font-semibold truncate" style={{ color: tokens.paper }}>
            {user.fullName || user.email}
          </span>
          {user.fullName && <span className="text-[13px] truncate" style={{ color: tokens.mute }}>{user.email}</span>}
        </div>
        <SettingsButton
          tone="destructive"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true);
            try {
              await signOut();
            } finally {
              setSigningOut(false);
            }
          }}
        >
          {signingOut ? 'Signing Out…' : 'Sign Out'}
        </SettingsButton>
      </div>

      <SettingsGroup title="Workspace">
        {ws ? (
          <>
            <SettingsRow label="Organization"><RowValue>{ws.orgName}</RowValue></SettingsRow>
            <SettingsRow label="Plan">
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: tokens.signalDim, color: tokens.signal }}>
                {PLAN_LABEL[ws.plan] ?? ws.plan}
              </span>
            </SettingsRow>
            <SettingsRow label="Your role"><RowValue>{ROLE_LABEL[ws.role] ?? ws.role}</RowValue></SettingsRow>
          </>
        ) : (
          <SettingsRow label="Roxi cloud">
            <StatusValue tone="warn">Can't reach it right now</StatusValue>
          </SettingsRow>
        )}
      </SettingsGroup>
    </>
  );
};

/** Settings › Privacy & Data: copy meetings saved on this Mac into the signed-in workspace. */
export const ImportHistoryGroup: React.FC = () => {
  const { canImport } = useAccount();
  const { stats, phase, progress, error, start } = useLocalImport();
  if (!canImport || !stats) return null;

  return (
    <SettingsGroup
      title="Import to your workspace"
      footer={
        phase === 'idle' && stats.meetings > 0
          ? 'Copies your past meetings into your workspace. Safe to run more than once: meetings already imported are skipped.'
          : undefined
      }
    >
      <SettingsRow
        label="Saved on this Mac"
        detail={
          stats.meetings === 0
            ? 'No local meetings to import.'
            : `${stats.meetings.toLocaleString()} meetings · ${stats.transcriptLines.toLocaleString()} transcript lines`
        }
      >
        {stats.meetings > 0 && (
          <SettingsButton tone="primary" disabled={phase === 'running'} onClick={() => void start()}>
            {phase === 'running' ? 'Importing…' : phase === 'done' ? 'Import Again' : 'Import Meetings'}
          </SettingsButton>
        )}
      </SettingsRow>
      {phase !== 'idle' && (
        <div className="px-3.5 py-3 flex flex-col gap-2">
          {progress && <ImportProgressBar progress={progress} done={phase === 'done'} />}
          {phase === 'done' && progress && (
            <p className="text-[12px]" style={{ color: tokens.decision }}>{importResultText(progress)}</p>
          )}
          {phase === 'error' && error && (
            <p className="text-[12px]" role="alert" style={{ color: tokens.danger }}>{error}</p>
          )}
        </div>
      )}
    </SettingsGroup>
  );
};
