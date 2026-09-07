import React, { useEffect, useRef, useState } from 'react';
import { tokens, radius } from '../../design-system';

interface SpeakerRenameModalProps {
  /** Raw STT label being renamed, e.g. "Speaker A". */
  sttLabel: string;
  /** The name currently shown for that label. */
  currentName: string;
  onCancel: () => void;
  onSubmit: (displayName: string) => Promise<void>;
}

export const SpeakerRenameModal: React.FC<SpeakerRenameModalProps> = ({
  sttLabel,
  currentName,
  onCancel,
  onSubmit,
}) => {
  const [value, setValue] = useState(currentName === sttLabel ? '' : currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (!name || saving) return;

    setSaving(true);
    setError(null);
    try {
      await onSubmit(name);
      onCancel();
    } catch (err) {
      // The repository has already rolled the name back, so the transcript
      // still shows the truth; this just explains why nothing changed.
      setError(
        typeof err === 'string' ? err : 'Could not save the name. Is a session running?'
      );
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={onCancel}
      role="presentation"
    >
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[320px] p-5 shadow-2xl"
        style={{
          // See MeetingDetailModal: sheets need their own readable ground.
          background: tokens.sheet,
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: `1px solid ${tokens.hairline}`,
          borderRadius: radius.card,
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Rename ${sttLabel}`}
      >
        <div className="text-[15px] font-semibold mb-1" style={{ color: tokens.paper }}>
          Rename speaker
        </div>
        <div className="text-[13px] mb-4" style={{ color: tokens.muteDim }}>
          Applies to every line from {sttLabel}, and is remembered for future meetings.
        </div>

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={sttLabel}
          maxLength={80}
          disabled={saving}
          className="w-full px-3 py-2 text-[14px] outline-none"
          style={{
            background: tokens.sheetInner,
            color: tokens.paper,
            border: `1px solid ${tokens.hairline}`,
            borderRadius: radius.chip,
          }}
        />

        {error && (
          <div className="mt-2 text-[12px]" style={{ color: tokens.risk }}>
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[13px]"
            style={{ color: tokens.muteDim, borderRadius: radius.chip }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value.trim() || saving}
            className="px-3 py-1.5 text-[13px] font-medium disabled:opacity-40"
            style={{ background: tokens.signal, color: '#fff', borderRadius: radius.chip }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};
