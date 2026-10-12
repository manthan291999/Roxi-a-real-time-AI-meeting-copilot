// Brings jest-dom's matcher types into tsc; vitest.setup.ts registers them at runtime but sits outside tsconfig's src include.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const setMode = vi.fn();
vi.mock('../../auth/AccountContext', () => ({
  useAccount: () => ({ account: { configured: false, user: null, workspace: null }, canImport: false, signOut: vi.fn() }),
}));
vi.mock('../../auth/useLocalImport', () => ({
  useLocalImport: () => ({ stats: null, phase: 'idle', progress: null, error: null, start: vi.fn() }),
}));
vi.mock('../../chat', () => ({
  useChatThreadContext: () => ({ mode: 'rag', setMode, isLoading: false }),
}));
vi.mock('../../library/useDocumentLibrary', () => ({
  useDocumentLibrary: () => ({ documents: [{ docId: 'a', fileName: 'spec.pdf', status: 'ready' }] }),
}));
vi.mock('../../../context/useServices', () => ({
  useServices: () => ({ projectRepository: { list: () => Promise.resolve([{ id: 1 }, { id: 2 }]) } }),
}));

import { SettingsPane } from '../SettingsPane';

function renderSettings(props: Partial<React.ComponentProps<typeof SettingsPane>> = {}) {
  const handlers = { onRecheckBlackhole: vi.fn(), onOpenLibrary: vi.fn() };
  render(
    <SettingsPane isLive={false} isConnecting={false} provider="" sessionId={null} blackholeMissing={false} {...handlers} {...props} />,
  );
  return handlers;
}

describe('SettingsPane', () => {
  it('opens on Audio & Capture and reports BlackHole as installed', () => {
    renderSettings();
    expect(screen.getByRole('heading', { level: 1, name: 'Audio & Capture' })).toBeInTheDocument();
    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check Again' })).not.toBeInTheDocument();
  });

  it('offers Check Again when BlackHole is missing', async () => {
    const { onRecheckBlackhole } = renderSettings({ blackholeMissing: true });
    fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));
    expect(onRecheckBlackhole).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check Again' })).toBeEnabled());
  });

  it('filters categories by keyword and says when nothing matches', () => {
    renderSettings();
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'hotkey' } });
    expect(within(nav).getByRole('button', { name: /Keyboard Shortcuts/ })).toBeInTheDocument();
    expect(within(nav).queryByRole('button', { name: /Library/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'zzz' } });
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
  });

  it('switches the Knowledge preference for a chat thread', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Ask Roxi/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Knowledge for Past Meetings' }));
    expect(setMode).toHaveBeenCalledWith('direct');
  });

  it('shows local-only mode on the account card and pane', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /Local-only mode/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText('On this Mac')).toBeInTheDocument();
  });

  it('counts library content and opens the Library', async () => {
    const { onOpenLibrary } = renderSettings();
    fireEvent.click(screen.getByRole('button', { name: /^Library$/ }));
    expect(await screen.findByText('2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Library' }));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });
});
