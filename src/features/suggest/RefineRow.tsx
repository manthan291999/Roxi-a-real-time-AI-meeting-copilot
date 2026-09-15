import React, { useEffect, useRef, useState } from 'react';
import { tokens, durations, easing, typeScale } from '../../design-system';
import { PlusIcon, CloseIcon, SparkleIcon } from '../../design-system/icons';
import { REFINE_PRESETS } from './refine';

interface RefineRowProps {
  /** Applies a refinement to this card. */
  onRefine: (instruction: string, label: string) => void;
  /** Restores the pipeline's original reply; absent when nothing to undo. */
  onUndo?: () => void;
  /** Label of the refinement running right now, or null. */
  pendingLabel: string | null;
  /** True while ANY card is refining — the others disable rather than queue. */
  busy: boolean;
}

/**
 * The refinement controls on a suggestion card.
 *
 * These act on the card they sit in and replace its text in place. They used
 * to be a single row under the whole pane that forwarded the label to the Ask
 * tab as a question — which read as a refinement but produced a chat message
 * about the reply instead of a changed reply, and had no way to say WHICH
 * suggestion it meant once more than one was on screen.
 */
export const RefineRow: React.FC<RefineRowProps> = ({ onRefine, onUndo, pendingLabel, busy }) => {
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (customOpen) inputRef.current?.focus();
  }, [customOpen]);

  const submitCustom = () => {
    const instruction = custom.trim();
    if (!instruction || busy) return;
    // The user's own words are both the instruction and the label — echoing
    // them back on the card is what makes the applied change legible.
    onRefine(instruction, instruction);
    setCustom('');
    setCustomOpen(false);
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    backgroundColor: active ? tokens.signalDim : tokens.overlay,
    borderColor: active ? tokens.signalLine : tokens.hairline,
    color: active ? tokens.signal : tokens.paper,
    fontSize: typeScale.caption.fontSize,
    fontWeight: typeScale.caption.fontWeight,
    outlineColor: tokens.focusRing,
    transition: `background-color ${durations.fast}ms ${easing.calm}, border-color ${durations.fast}ms ${easing.calm}, color ${durations.fast}ms ${easing.calm}`,
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {REFINE_PRESETS.map((preset) => {
        const isPending = pendingLabel === preset.label;
        return (
          <button
            key={preset.id}
            type="button"
            disabled={busy}
            onClick={() => onRefine(preset.instruction, preset.label)}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
            style={chipStyle(isPending)}
          >
            {isPending && (
              /* Its own signal->technical gradient, so it takes no colour
                 from here — it is already the "Roxi is working" accent. */
              <SparkleIcon className="w-3 h-3 animate-pulse" />
            )}
            {preset.label}
          </button>
        );
      })}

      {customOpen ? (
        <span
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5"
          style={{ backgroundColor: tokens.overlay, borderColor: tokens.signalLine }}
        >
          <input
            ref={inputRef}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitCustom(); }
              if (e.key === 'Escape') { setCustomOpen(false); setCustom(''); }
            }}
            placeholder="e.g. add a deadline"
            aria-label="Custom refinement"
            className="bg-transparent outline-none w-40 py-0.5"
            style={{
              color: tokens.paper,
              fontSize: typeScale.caption.fontSize,
            }}
          />
          <button
            type="button"
            onClick={() => { setCustomOpen(false); setCustom(''); }}
            aria-label="Cancel custom refinement"
            className="shrink-0 rounded-full p-0.5 cursor-pointer"
            style={{ color: tokens.muteDim }}
          >
            <CloseIcon className="w-3 h-3" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setCustomOpen(true)}
          title="Write your own instruction"
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-3 py-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
          style={{
            borderColor: tokens.neutralLine,
            color: tokens.mute,
            fontSize: typeScale.caption.fontSize,
            fontWeight: typeScale.caption.fontWeight,
            outlineColor: tokens.focusRing,
          }}
        >
          <PlusIcon className="w-3.5 h-3.5" />
          Custom
        </button>
      )}

      {onUndo && (
        <button
          type="button"
          onClick={onUndo}
          disabled={busy}
          className="ml-auto rounded-full px-2 py-1 cursor-pointer underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2"
          style={{
            color: tokens.muteDim,
            fontSize: typeScale.caption.fontSize,
            outlineColor: tokens.focusRing,
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
};
