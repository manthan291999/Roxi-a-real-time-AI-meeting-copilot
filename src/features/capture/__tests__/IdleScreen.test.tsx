// Brings jest-dom's matcher types into tsc; vitest.setup.ts registers them at runtime but sits outside tsconfig's src include.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IdleScreen } from '../IdleScreen';

const MEETINGS = [
  { id: '4', title: 'Weekly product sync', date: '2026-09-26T10:00:00Z' },
  { id: '3', title: 'Design review', date: '2026-09-25T10:00:00Z' },
  { id: '2', title: 'Client kickoff', date: '2026-09-22T10:00:00Z' },
  { id: '1', title: 'Oldest', date: '2026-09-01T10:00:00Z' },
];

function renderIdle(props: Partial<React.ComponentProps<typeof IdleScreen>> = {}) {
  const handlers = { onStart: vi.fn(), onHistory: vi.fn(), onLibrary: vi.fn() };
  render(<IdleScreen {...handlers} blackholeMissing={false} {...props} />);
  return handlers;
}

describe('IdleScreen', () => {
  it('starts capture and reports system audio as connected', () => {
    const { onStart } = renderIdle();
    expect(screen.getByText('BlackHole 2ch')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start Capture' }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows at most three recent meetings and opens the one clicked', () => {
    const onOpenMeeting = vi.fn();
    const { onHistory } = renderIdle({ recentMeetings: MEETINGS, onOpenMeeting });

    expect(screen.queryByText('Oldest')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Design review'));
    expect(onOpenMeeting).toHaveBeenCalledWith(MEETINGS[1]);

    fireEvent.click(screen.getByRole('button', { name: 'Show All' }));
    expect(onHistory).toHaveBeenCalledTimes(1);
  });

  it('hides the Recent section when there is no history', () => {
    renderIdle({ recentMeetings: [] });
    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
  });

  it('shows the product clip on a first launch', () => {
    renderIdle({ recentMeetings: [] });
    expect(screen.getByTestId('idle-brag-clip')).toBeInTheDocument();
  });

  it('keeps showing the product clip once there is history', () => {
    renderIdle({ recentMeetings: MEETINGS });
    expect(screen.getByTestId('idle-brag-clip')).toBeInTheDocument();
  });

  it('replaces Start Capture with the setup card when BlackHole is missing', async () => {
    const onRecheckBlackhole = vi.fn().mockResolvedValue(undefined);
    renderIdle({ blackholeMissing: true, onRecheckBlackhole });

    expect(screen.queryByRole('button', { name: 'Start Capture' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('idle-brag-clip')).not.toBeInTheDocument();
    expect(screen.getByText('BlackHole 2ch not found')).toBeInTheDocument();
    expect(screen.getByText('brew install blackhole-2ch')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Check Again' }));
    await waitFor(() => expect(onRecheckBlackhole).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check Again' })).toBeEnabled());
  });
});
