import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useServices } from '../../context';
import { SuggestCardType } from '../../shared/types';
import { buildRefinePrompt, cleanRefinedText, currentReplyText } from './refine';

/**
 * A refine in flight. One at a time, app-wide: the sidecar processes one Ask
 * at a time anyway, and a second spinner on a second card would promise
 * parallelism that does not exist.
 */
export interface RefineInFlight {
  cardId: string;
  /** Shown on the card while it runs, e.g. 'Make it shorter'. */
  label: string;
}

export interface SuggestAnswersState {
  cards: SuggestCardType[];
  removeCard: (id: string) => void;

  /** The refine currently running, or null. */
  refining: RefineInFlight | null;
  /** Card id -> message, for a refine that failed. Cleared on the next try. */
  refineError: { cardId: string; message: string } | null;
  /**
   * Rewrite one card in place. `label` is what the card shows while it runs
   * and afterwards; `instruction` is what the model is actually told.
   */
  refineCard: (cardId: string, instruction: string, label: string) => void;
  /** Put a refined card back to the reply the pipeline produced. */
  undoRefine: (cardId: string) => void;
}

/**
 * Thread id namespace for refine turns: `refine:<attempt>:<cardId>`.
 *
 * A refine goes through the same chat sidecar as an Ask but is not a chat
 * turn: it must not land in the Ask thread's transcript. The card id rides in
 * the thread id (the sidecar echoes it back verbatim) so a reply can be
 * matched to the card that asked for it without a second correlation map.
 *
 * The attempt counter makes every refine its own thread. The graph keeps a
 * checkpointer keyed by thread id, and each refine is meant to be independent
 * — reusing one thread for "shorter" then "more formal" would leave the second
 * run resuming the first one's state. Card ids are `sg_<base36>` (see
 * suggestCardMapper.toCardId), so they never contain the ':' this splits on.
 */
const REFINE_THREAD_PREFIX = 'refine:';

const refineThreadId = (cardId: string, attempt: number) =>
  `${REFINE_THREAD_PREFIX}${attempt}:${cardId}`;

const cardIdFromThread = (threadId?: string | null): string | null => {
  if (!threadId || !threadId.startsWith(REFINE_THREAD_PREFIX)) return null;
  const rest = threadId.slice(REFINE_THREAD_PREFIX.length);
  const separator = rest.indexOf(':');
  return separator === -1 ? null : rest.slice(separator + 1) || null;
};

const SuggestAnswersContext = createContext<SuggestAnswersState | null>(null);

interface SuggestAnswersProviderProps {
  children: React.ReactNode;
  /**
   * The current capture session's id, from useCaptureSession — null when no
   * session is running. A change to a new (non-null) id means a new meeting
   * has started, and is the signal to drop the previous meeting's cards.
   *
   * Without this, cards accumulated for one meeting were still sitting here,
   * unseen, the moment the next one started: the provider is mounted once for
   * the whole app window (see below) and had nothing telling it a new session
   * had begun, so a fresh capture opened straight onto a stranger's stale
   * "Ready to say" card from whenever the last meeting left off.
   */
  sessionId: number | null;
}

/**
 * Owns the suggested-answer cards for the whole widget.
 *
 * Mounted above the tab/view switcher in App.tsx (alongside ChatThreadProvider
 * and TranscriptProvider) so its event-bus subscription and accumulated cards
 * survive switching to History/Library and back — SuggestAnswersPane mounts
 * and unmounts as tabs change, so this state has to live above it.
 */
export const SuggestAnswersProvider: React.FC<SuggestAnswersProviderProps> = ({ children, sessionId }) => {
  const { eventBus, chatService } = useServices();
  const [cards, setCards] = useState<SuggestCardType[]>([]);
  // PERF FIX #7: Use a Set in a ref for O(1) duplicate detection instead of the
  // previous O(n) deduplicateCards scan over the entire cards array. Over a long
  // meeting with many suggestions, this prevents the state update from getting
  // progressively slower as the cards array grows.
  const seenIds = useRef<Set<string>>(new Set());

  /**
   * Mirrors `cards` so refineCard can read the card it is about to rewrite
   * without listing `cards` as a dependency — that would rebuild the callback
   * on every incoming suggestion and re-render every card with it.
   */
  const cardsRef = useRef<SuggestCardType[]>(cards);
  cardsRef.current = cards;

  const [refining, setRefining] = useState<RefineInFlight | null>(null);
  const [refineError, setRefineError] = useState<{ cardId: string; message: string } | null>(null);

  /**
   * Read inside event handlers, so it mirrors `refining` in a ref — a stale
   * closure would drop the reply for the card actually waiting on one.
   */
  const refiningRef = useRef<RefineInFlight | null>(null);

  /** Monotonic, so each refine gets a thread of its own. See refineThreadId. */
  const refineAttempt = useRef(0);

  // A new session starting is the one moment a clean slate is correct: not on
  // stop (the dashboard is already hidden behind the idle screen by then, so
  // clearing there would just be invisible bookkeeping a beat early) but
  // definitely before the next meeting's own cards start arriving.
  useEffect(() => {
    if (sessionId === null) return;
    seenIds.current.clear();
    setCards([]);
    // A refine still in flight belongs to a card that no longer exists.
    refiningRef.current = null;
    setRefining(null);
    setRefineError(null);
  }, [sessionId]);

  useEffect(() => {
    const unlisten = eventBus.onSuggestAnswer((card) => {
      // O(1) check — no array scan needed
      if (seenIds.current.has(card.id)) return;
      seenIds.current.add(card.id);
      setCards(prev => [...prev, card]);
    });

    return () => {
      unlisten();
    };
  }, [eventBus]);

  const removeCard = useCallback((id: string) => {
    seenIds.current.delete(id);
    setCards(prev => prev.filter(c => c.id !== id));
  }, []);

  /**
   * The refine round-trip.
   *
   * Replies arrive on the same `chat_reply` event as an Ask, so this listens
   * alongside the chat threads and takes only what is addressed to a
   * `refine:` thread. The chat threads ignore those for the mirror-image
   * reason (their own id will not match), so neither ever sees the other's.
   */
  useEffect(() => {
    const settle = () => {
      refiningRef.current = null;
      setRefining(null);
    };

    const unlistenReply = eventBus.onChatReply((reply) => {
      const cardId = cardIdFromThread(reply?.threadId);
      // Not a refine, or a duplicate delivery after this one already settled.
      if (!cardId || refiningRef.current?.cardId !== cardId) return;

      const label = refiningRef.current.label;
      const refined = cleanRefinedText(reply?.answer ?? '');
      settle();

      if (!refined) {
        setRefineError({ cardId, message: 'The rewrite came back empty. Try again.' });
        return;
      }

      setCards(prev =>
        prev.map(card => {
          if (card.id !== cardId) return card;
          return {
            ...card,
            text: refined,
            // The rewrite is one piece of prose, so the bullet form no longer
            // describes it. Dropping them is what makes the card re-render
            // through its prose branch instead of showing a stale list.
            bullets: undefined,
            // Written once — see SuggestCardType.original.
            original: card.original ?? { text: card.text, bullets: card.bullets },
            refinedWith: label,
          };
        }),
      );
    });

    const unlistenError = eventBus.onChatError((err) => {
      const cardId = cardIdFromThread(err?.threadId);
      if (!cardId || refiningRef.current?.cardId !== cardId) return;
      settle();
      setRefineError({ cardId, message: err?.message || 'Could not rewrite that. Try again.' });
    });

    return () => {
      unlistenReply();
      unlistenError();
    };
  }, [eventBus]);

  const refineCard = useCallback(
    (cardId: string, instruction: string, label: string) => {
      // One at a time. A second click while one runs is a no-op rather than a
      // queued rewrite of a card whose text is about to change underneath it.
      if (refiningRef.current) return;

      const card = cardsRef.current.find(c => c.id === cardId);
      if (!card || !currentReplyText(card)) return;

      const inFlight = { cardId, label };
      refiningRef.current = inFlight;
      setRefining(inFlight);
      setRefineError(null);

      void chatService
        .ask(buildRefinePrompt(card, instruction), {
          threadId: refineThreadId(cardId, (refineAttempt.current += 1)),
          // 'direct': this is a rewrite of text already on screen, so there is
          // nothing to retrieve and retrieval would only add latency.
          mode: 'direct',
          // The one place the app pins webMode. Absent is correct for a
          // question (so CHATBOT_WEB_SEARCH_MODE stays the only switch), but a
          // refine is a text transform, and a rewritten sentence that quietly
          // picked up a fact off the web is a failure, not a feature.
          webMode: 'never',
        })
        .catch((error: unknown) => {
          refiningRef.current = null;
          setRefining(null);
          setRefineError({
            cardId,
            message: error instanceof Error ? error.message : 'Could not reach Roxi.',
          });
        });
    },
    [chatService],
  );

  const undoRefine = useCallback((cardId: string) => {
    setRefineError(null);
    setCards(prev =>
      prev.map(card => {
        if (card.id !== cardId || !card.original) return card;
        const { original, ...rest } = card;
        return { ...rest, text: original.text, bullets: original.bullets, refinedWith: undefined };
      }),
    );
  }, []);

  const value: SuggestAnswersState = {
    cards,
    removeCard,
    refining,
    refineError,
    refineCard,
    undoRefine,
  };

  return <SuggestAnswersContext.Provider value={value}>{children}</SuggestAnswersContext.Provider>;
};

/** The suggested-answer cards. Throws if used outside the provider. */
export function useSuggestAnswersContext(): SuggestAnswersState {
  const ctx = useContext(SuggestAnswersContext);
  if (!ctx) {
    throw new Error('useSuggestAnswersContext must be used within a SuggestAnswersProvider');
  }
  return ctx;
}
