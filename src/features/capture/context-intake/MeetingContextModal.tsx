import React, { useEffect } from 'react';
import { MeetingContext } from '../../../shared/types';
import { tokens, radius, typeScale } from '../../../design-system';
import { StartCaptureButton } from '../StartCaptureButton';
import { MEETING_PRESETS, MEETING_ROLES } from './presets';
import { useMeetingContextForm } from './useMeetingContextForm';
import { MeetingNameField } from './MeetingNameField';
import { DescriptionField } from './DescriptionField';
import { IntakeSection, OptionalNote } from './IntakeSection';
import { IntakeBrand } from './IntakeBrand';
import { QuickSelectChips } from './QuickSelectChips';
import { RolePicker } from './RolePicker';
import { ProjectPicker } from './ProjectPicker';
import { useProjectPicker } from './useProjectPicker';
import { useServices } from '../../../context/useServices';
import { useDocumentLibrary } from '../../library/useDocumentLibrary';
import { ContextDocumentPicker } from './ContextDocumentPicker';

interface MeetingContextModalProps {
  /**
   * Receives the assembled context. `name` is always present — both buttons
   * stay disabled until it's filled in; "Skip context" sends just the
   * name, discarding description/role/project/docs.
   */
  onConfirm: (context: MeetingContext) => void;
  onCancel: () => void;
}

const STRENGTH_LABELS = ['Name only', 'Light', 'Good', 'Strong', 'Complete'];

/** Four segments, one per optional group the user has filled. */
const ContextStrength: React.FC<{ filled: number }> = ({ filled }) => (
  <div className="flex items-center gap-2.5" aria-label={`Context strength: ${STRENGTH_LABELS[filled]}`} role="img">
    <div className="flex gap-1" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="h-1 w-6 rounded-full transition-colors duration-300"
          style={{ background: i < filled ? tokens.signal : tokens.hairline }}
        />
      ))}
    </div>
    <span className="text-[12px] font-medium" style={{ color: filled > 0 ? tokens.signal : tokens.muteDim }}>
      {STRENGTH_LABELS[filled]}
    </span>
  </div>
);

/**
 * Pre-capture intake. Composition only — form state lives in useMeetingContextForm
 * and the options come from presets.ts, so this file stays layout.
 */
export const MeetingContextModal: React.FC<MeetingContextModalProps> = ({ onConfirm, onCancel }) => {
  const form = useMeetingContextForm();
  const canStart = form.name.trim().length > 0;
  const services = useServices();
  const picker = useProjectPicker(services.projectRepository);
  const { documents, progressMap, addDocument } = useDocumentLibrary(0);

  const filled = [
    form.description.trim().length > 0,
    Boolean(form.selectedRoleId),
    form.project !== undefined && form.project.kind !== 'unsorted',
    form.selectedDocIds.length > 0,
  ].filter(Boolean).length;

  useEffect(() => {
    form.setProject(picker.selection);
  }, [picker.selection, form.setProject]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
      // ⌘↵ starts from anywhere in the sheet, including inside the textarea.
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canStart) {
        event.preventDefault();
        onConfirm(form.toMeetingContext());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, onConfirm, canStart, form]);

  return (
    /* absolute, not fixed: keeps the scrim clipped to AppShell's rounded panel
       instead of painting square corners over the transparent window. */
    <div
      className="absolute inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: tokens.scrim, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Meeting context"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <div
        className="relative flex w-full max-w-[560px] max-h-full flex-col overflow-hidden animate-card-enter"
        style={{
          borderRadius: radius.panel + 8,
          background: tokens.sheet,
          border: `1px solid ${tokens.hairline}`,
          boxShadow: tokens.sheetShadow,
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
        }}
      >
        {/* The same soft indigo glow that sits behind the ready screen's CTA. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[420px] h-[220px] rounded-full blur-3xl"
          style={{ background: tokens.signalDim }}
        />

        {/* Only the middle scrolls, so the footer's actions stay reachable in
            the short (780px) widget window. */}
        <div className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto custom-scrollbar px-6 pt-5 pb-6">
          <IntakeBrand onClose={onCancel} />

          <header className="flex shrink-0 flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: tokens.signal }}>
              New capture
            </span>
            <h2
              style={{
                color: tokens.paper,
                fontSize: typeScale.display.fontSize,
                lineHeight: typeScale.display.lineHeight,
                fontWeight: typeScale.display.fontWeight,
                letterSpacing: typeScale.display.letterSpacing,
              }}
            >
              Set up your meeting
            </h2>
            <p className="text-[14px] leading-relaxed" style={{ color: tokens.mute }}>
              Only the name is required. Every bit of context sharpens what Roxi explains and flags.
            </p>
            <div className="mt-1">
              <ContextStrength filled={filled} />
            </div>
          </header>

          <MeetingNameField value={form.name} onChange={form.setName} />

          <div className="h-px shrink-0" style={{ background: tokens.hairlineSoft }} />

          <IntakeSection step={1} title="What is this meeting about?" aside={<OptionalNote />}>
            <DescriptionField
              value={form.description}
              onChange={form.setDescription}
              footer={
                <QuickSelectChips
                  presets={MEETING_PRESETS}
                  selectedPresetId={form.selectedPresetId}
                  onSelect={form.applyPreset}
                />
              }
            />
          </IntakeSection>

          <IntakeSection step={2} title="Who are you in this meeting?" aside={<OptionalNote />}>
            <RolePicker
              roles={MEETING_ROLES}
              selectedRoleId={form.selectedRoleId}
              onSelect={form.selectRole}
            />
          </IntakeSection>

          <IntakeSection step={3} title="Project" aside={<OptionalNote />}>
            <ProjectPicker
              projects={picker.projects}
              isLoading={picker.isLoading}
              selection={picker.selection}
              onSelectExisting={picker.selectExisting}
              onSetNewName={picker.setNewName}
              onSelectUnsorted={picker.selectUnsorted}
              displayIdPreview={picker.displayIdPreview}
            />
          </IntakeSection>

          <ContextDocumentPicker
            step={4}
            documents={documents}
            selectedDocIds={form.selectedDocIds}
            progressMap={progressMap}
            onToggle={form.toggleDoc}
            onUpload={addDocument}
          />
        </div>

        <footer
          className="relative flex shrink-0 items-center justify-between gap-4 border-t px-6 py-4"
          style={{ borderColor: tokens.hairlineSoft, background: tokens.card }}
        >
          <button
            type="button"
            disabled={!canStart}
            onClick={() => canStart && onConfirm({ name: form.name.trim() })}
            className="text-[13px] font-medium transition-opacity ease-[cubic-bezier(.2,.8,.2,1)] hover:enabled:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)] rounded"
            style={{ color: tokens.mute }}
          >
            Skip context
          </button>
          <div className="flex items-center gap-3">
            {canStart ? (
              <kbd
                className="hidden min-[440px]:inline-flex h-[20px] px-1.5 items-center border font-sans text-[11px] font-medium"
                style={{ borderRadius: 5, borderColor: tokens.hairline, background: tokens.card, color: tokens.mute }}
              >
                ⌘ ↵
              </kbd>
            ) : (
              <span className="text-[12px]" style={{ color: tokens.muteDim }}>
                Name your meeting to start
              </span>
            )}
            <StartCaptureButton disabled={!canStart} onClick={() => onConfirm(form.toMeetingContext())} />
          </div>
        </footer>
      </div>
    </div>
  );
};
