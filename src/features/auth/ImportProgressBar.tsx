import React from 'react';
import { tokens, typeScale } from '../../design-system';
import { ImportProgress } from '../../shared/types/account';

export function importResultText(p: ImportProgress): string {
  const imported = `Imported ${p.imported.toLocaleString()} ${p.imported === 1 ? 'meeting' : 'meetings'}.`;
  if (p.skipped === 0) return imported;
  return `${imported} ${p.skipped.toLocaleString()} ${p.skipped === 1 ? 'was' : 'were'} already in your workspace.`;
}

export interface ProgressColors {
  track: string;
  fill: string;
  done: string;
  text: string;
}

const LIGHT_COLORS: ProgressColors = { track: tokens.hairline, fill: tokens.signal, done: tokens.decision, text: tokens.mute };

/** `colors` lets a surface with its own palette reuse the bar. */
export const ImportProgressBar: React.FC<{ progress: ImportProgress; done: boolean; colors?: ProgressColors }> = ({
  progress,
  done,
  colors = LIGHT_COLORS,
}) => {
  const pct = progress.total === 0 ? 100 : Math.round((progress.processed / progress.total) * 100);
  const { track, text } = colors;
  const fill = done ? colors.done : colors.fill;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-[6px] w-full rounded-full overflow-hidden"
        style={{ background: track }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Import progress"
      >
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: fill }} />
      </div>
      <span style={{ color: text, fontSize: typeScale.caption.fontSize, fontVariantNumeric: 'tabular-nums' }}>
        {progress.processed.toLocaleString()} of {progress.total.toLocaleString()} meetings
      </span>
    </div>
  );
};
