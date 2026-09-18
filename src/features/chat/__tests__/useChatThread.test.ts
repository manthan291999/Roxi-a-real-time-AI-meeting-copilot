import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChatThread } from '../useChatThread';
import { ServicesProvider } from '../../../context/ServicesProvider';
import { IChatService } from '../../../shared/interfaces/IChatService';
import { IEventBus } from '../../../shared/interfaces/IEventBus';
import { ChatReplyEvent } from '../../../shared/types/chat';

/**
 * A fake event bus with real multi-subscriber fan-out for onChatReply —
 * matching the one thing that actually matters here: the production
 * TauriEventBus is one global subscription every mounted thread listens on.
 * A fake that only remembered the last-registered callback would hide
 * exactly the bug `accepts()` exists to fix (see useChatThread.ts's doc
 * comment) instead of exercising it.
 */
function createFakeEventBus(): IEventBus & { emitReply: (event: ChatReplyEvent) => void } {
  const replyListeners: Array<(event: ChatReplyEvent) => void> = [];
  const noop = () => () => {};

  return new Proxy({} as IEventBus & { emitReply: (event: ChatReplyEvent) => void }, {
    get(_target, prop) {
      if (prop === 'onChatReply') {
        return (cb: (event: ChatReplyEvent) => void) => {
          replyListeners.push(cb);
          return () => {
            const i = replyListeners.indexOf(cb);
            if (i >= 0) replyListeners.splice(i, 1);
          };
        };
      }
      if (prop === 'emitReply') {
        return (event: ChatReplyEvent) => replyListeners.forEach((cb) => cb(event));
      }
      return noop;
    },
  });
}

function createFakeChatService(overrides: Partial<IChatService> = {}): IChatService {
  return {
    ask: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderThread(threadId: 'ask' | 'history', chatService: IChatService, eventBus: IEventBus) {
  return renderHook(() => useChatThread(threadId), {
    wrapper: ({ children }) =>
      React.createElement(ServicesProvider, { services: { chatService, eventBus }, children }),
  });
}

describe('useChatThread — accepts() guard', () => {
  it('only appends a reply to the thread that is actually waiting on one', async () => {
    // Both threads mounted at once, exactly like the app does (Ask tab +
    // history browser can both be alive), sharing the same global bus fake —
    // the real bug was that they shared the same *global* subscription with
    // no per-thread filter.
    const eventBus = createFakeEventBus();
    const ask = renderThread('ask', createFakeChatService(), eventBus);
    const history = renderThread('history', createFakeChatService(), eventBus);

    await act(async () => {
      await ask.result.current.askQuestion('what did we decide?');
    });
    expect(ask.result.current.isLoading).toBe(true);
    expect(history.result.current.isLoading).toBe(false);

    // No threadId on the reply — pre-stamped events route to whichever
    // thread is actually pending, which is 'ask' here.
    act(() => eventBus.emitReply({ answer: 'We decided to ship Friday.' }));

    await waitFor(() =>
      expect(ask.result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', content: 'We decided to ship Friday.' }),
        ]),
      ),
    );
    // The bug this guard fixes: the same reply, delivered to BOTH threads by
    // the shared bus, must not also land in the thread that never asked
    // anything.
    expect(history.result.current.messages).toEqual([]);
  });

  it('drops a duplicate delivery of the same terminal event instead of appending twice', async () => {
    const eventBus = createFakeEventBus();
    const { result } = renderThread('ask', createFakeChatService(), eventBus);

    await act(async () => {
      await result.current.askQuestion('one question');
    });

    act(() => eventBus.emitReply({ threadId: 'ask', answer: 'first answer' }));
    // Transport repeats the delivery — pendingRef was already cleared by the
    // first terminal event, so acceptsTerminal must reject this one.
    act(() => eventBus.emitReply({ threadId: 'ask', answer: 'first answer' }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const assistantMessages = result.current.messages.filter((m) => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
  });

  it('ignores a reply addressed to a different thread even while this one is pending', async () => {
    const eventBus = createFakeEventBus();
    const { result } = renderThread('ask', createFakeChatService(), eventBus);

    await act(async () => {
      await result.current.askQuestion('a question only ask should answer');
    });

    act(() => eventBus.emitReply({ threadId: 'history', answer: 'meant for the other thread' }));

    // Still loading: an explicitly-addressed reply for another thread must
    // not settle this one.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.messages.some((m) => m.content === 'meant for the other thread')).toBe(
      false,
    );
  });
});
