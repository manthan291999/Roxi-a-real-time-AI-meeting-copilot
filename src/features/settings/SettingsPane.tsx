import React, { useMemo, useState } from 'react';
import { tokens, radius, SearchIcon, CloseIcon, ChevronLeftIcon, ChevronRightIcon } from '../../design-system';
import { useAccount } from '../auth/AccountContext';
import { Avatar } from './AccountSection';
import { PaneHeader } from './settingsUi';
import { SETTINGS_CATEGORIES, SettingsContext } from './settingsSections';

type SettingsPaneProps = SettingsContext;

/** The sidebar's top card, like the Apple Account row at the top of System Settings. */
const AccountCard: React.FC<{ selected: boolean; onClick: () => void }> = ({ selected, onClick }) => {
  const { account } = useAccount();
  const user = account.configured ? account.user : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={`w-full flex items-center gap-2.5 p-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--t-focus-ring)] ${selected ? '' : 'hover:bg-[var(--t-overlay-hover)]'}`}
      style={{ borderRadius: radius.control, background: selected ? tokens.signalDim : 'transparent' }}
    >
      {user ? (
        <Avatar name={user.fullName} email={user.email} size={36} />
      ) : (
        <Avatar name="Roxi" email={null} size={36} />
      )}
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[13px] font-semibold truncate" style={{ color: selected ? tokens.signal : tokens.paper }}>
          {user ? user.fullName || user.email : 'Local-only mode'}
        </span>
        <span className="text-[12px] truncate" style={{ color: tokens.mute }}>
          {user ? account.workspace?.orgName ?? 'Roxi account' : 'Meetings stay on this Mac'}
        </span>
      </span>
    </button>
  );
};

/**
 * Settings, laid out like macOS System Settings: a searchable category list
 * on the left and grouped rows on the right. Every row shows real state or a
 * real action; options that only exist in .env are listed under Advanced
 * rather than drawn as switches that would do nothing.
 */
export const SettingsPane: React.FC<SettingsPaneProps> = (props) => {
  const [selectedId, setSelectedId] = useState(SETTINGS_CATEGORIES[1].id);
  const [query, setQuery] = useState('');
  /** Which half the one-column layout shows; ignored while both columns fit. */
  const [narrowView, setNarrowView] = useState<'list' | 'content'>('list');

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      SETTINGS_CATEGORIES.filter(
        (c) => c.id !== 'account' && (!needle || `${c.label} ${c.keywords}`.toLowerCase().includes(needle)),
      ),
    [needle],
  );

  const select = (id: string) => {
    setSelectedId(id);
    setNarrowView('content');
  };

  const current = SETTINGS_CATEGORIES.find((c) => c.id === selectedId) ?? SETTINGS_CATEGORIES[0];
  const Icon = current.icon;
  const Pane = current.Pane;

  return (
    <div
      className="flex-1 min-h-0 border-t border-[var(--t-hairline-soft)] animate-fade-in"
      style={{ ['--split-list-width' as string]: '240px' }}
    >
      <div className="roxi-split" data-view={narrowView}>
        <nav aria-label="Settings" className="roxi-split-list flex min-h-0 flex-col">
          <div className="shrink-0 flex flex-col gap-2 px-3 pt-3 pb-2">
            <label
              className="h-7 flex items-center gap-1.5 px-2 transition-shadow focus-within:shadow-[0_0_0_3px_var(--t-signal-focus)]"
              style={{ borderRadius: 7, background: tokens.panelRaised, color: tokens.mute }}
            >
              <SearchIcon className="w-3.5 h-3.5 shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))}
                placeholder="Search"
                aria-label="Search settings"
                className="flex-1 min-w-0 bg-transparent text-[13px] outline-none placeholder:text-[var(--t-mute)] [&::-webkit-search-cancel-button]:hidden"
                style={{ color: tokens.paper }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="w-4 h-4 rounded-full flex items-center justify-center"
                  style={{ background: tokens.muteDim, color: tokens.ink }}
                >
                  <CloseIcon className="w-2.5 h-2.5" />
                </button>
              )}
            </label>
            <AccountCard selected={selectedId === 'account'} onClick={() => select('account')} />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 pb-3 flex flex-col gap-0.5">
            {visible.length === 0 && (
              <p className="px-3 py-6 text-center text-[12px]" style={{ color: tokens.mute }}>
                No settings match “{query.trim()}”.
              </p>
            )}
            {visible.map((c) => {
              const selected = c.id === selectedId;
              const RowIcon = c.icon;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c.id)}
                  aria-current={selected ? 'page' : undefined}
                  className={`w-full h-8 flex items-center gap-2.5 px-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--t-focus-ring)] ${selected ? '' : 'hover:bg-[var(--t-overlay-hover)]'}`}
                  style={{ borderRadius: radius.chip, background: selected ? tokens.signal : 'transparent' }}
                >
                  <span
                    aria-hidden="true"
                    className="w-[22px] h-[22px] shrink-0 rounded-[6px] flex items-center justify-center"
                    style={{
                      background: selected ? tokens.onSignal : tokens.signal,
                      color: selected ? tokens.signal : tokens.onSignal,
                    }}
                  >
                    <RowIcon className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1 truncate text-[13px]" style={{ color: selected ? tokens.onSignal : tokens.paper, fontWeight: selected ? 600 : 400 }}>
                    {c.label}
                  </span>
                  <ChevronRightIcon
                    className="roxi-split-back w-3.5 h-3.5 shrink-0"
                    style={{ color: selected ? tokens.onSignal : tokens.mute }}
                  />
                </button>
              );
            })}
          </div>
        </nav>

        <div className="roxi-split-content flex min-h-0 flex-col">
          <div className="roxi-split-back shrink-0 h-11 items-center px-3 border-b" style={{ borderColor: tokens.hairlineSoft }}>
            <button
              type="button"
              onClick={() => setNarrowView('list')}
              className="h-7 flex items-center gap-0.5 pl-1 pr-2 rounded-[7px] text-[13px] hover:bg-[var(--t-overlay-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--t-focus-ring)]"
              style={{ color: tokens.signal }}
            >
              <ChevronLeftIcon className="w-4 h-4" />
              Settings
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <div key={current.id} className="mx-auto w-full max-w-[600px] flex flex-col gap-6 px-7 py-7 animate-fade-in">
              <PaneHeader icon={<Icon className="w-6 h-6" />} title={current.label} subtitle={current.subtitle} />
              <Pane {...props} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
