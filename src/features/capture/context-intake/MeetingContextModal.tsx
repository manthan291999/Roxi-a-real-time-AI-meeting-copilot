import React, { useEffect } from 'react';
import { MeetingContext } from '../../../shared/types';
import { tokens, radius } from '../../../design-system';
import { StartCaptureButton } from '../StartCaptureButton';
import { MEETING_PRESETS, MEETING_ROLES } from './presets';
import { useMeetingContextForm } from './useMeetingContextForm';
import { DescriptionField } from './DescriptionField';
import { FieldLabel } from './FieldLabel';
import { IntakeBrand } from './IntakeBrand';
import { QuickSelectChips } from './QuickSelectChips';
import { RolePicker } from './RolePicker';
import { ProjectPicker } from './ProjectPicker';
import { useProjectPicker } from './useProjectPicker';
import { useServices } from '../../../context/useServices';
import { useDocumentLibrary } from '../../library/useDocumentLibrary';
import { ContextDocumentPicker } from './ContextDocumentPicker';

interface MeetingContextModalProps {
  /** Receives the assembled context, or undefined when the user skips. */
  onConfirm: (context?: MeetingContext) => void;
  onCancel: () => void;
}

/**
 * Pre-capture intake. Composition only — form state lives in useMeetingContextForm
 * and the options come from presets.ts, so this file stays layout.
 */
export const MeetingContextModal: React.FC<MeetingContextModalProps> = ({ onConfirm, onCancel }) => {
  const form = useMeetingContextForm();
  const services = useServices();
  const picker = useProjectPicker(services.projectRepository);
  const { documents, progressMap, addDocument } = useDocumentLibrary(0);

  useEffect(() => {
    form.setProject(picker.selection);
  }, [picker.selection, form.setProject]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    /* absolute, not fixed: keeps the scrim clipped to AppShell's rounded panel
       instead of painting square corners over the transparent window. */
    <div
      className="absolute inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: tokens.scrim, backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Meeting context"
    >
      <div
        className="flex w-full max-w-[520px] max-h-full flex-col p-6 animate-card-enter"
        style={{
          borderRadius: radius.panel + 8,
          background: tokens.sheet,
          border: `1px solid ${tokens.hairline}`,
          boxShadow: tokens.sheetShadow,
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
        }}
      >
        {/* Only the middle scrolls, so the footer's actions stay reachable in
            the short (780px) widget window. */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto custom-scrollbar">
          <IntakeBrand />

          <header className="flex shrink-0 flex-col gap-2">
            <h2 className="text-[26px] font-bold leading-tight tracking-tight" style={{ color: tokens.paper }}>
              What is this meeting about?
            </h2>
            <p className="text-[14px] leading-relaxed" style={{ color: tokens.mute }}>
              Providing context helps Roxi AI focus its analysis on what matters most to you.
            </p>
          </header>

          <DescriptionField value={form.description} onChange={form.setDescription} />

          <section className="flex shrink-0 flex-col gap-3">
            <FieldLabel>Quick select</FieldLabel>
            <QuickSelectChips
              presets={MEETING_PRESETS}
              selectedPresetId={form.selectedPresetId}
              onSelect={form.applyPreset}
            />
          </section>

          <section className="flex shrink-0 flex-col gap-3">
            <FieldLabel>Who are you in this meeting?</FieldLabel>
            <RolePicker
              roles={MEETING_ROLES}
              selectedRoleId={form.selectedRoleId}
              onSelect={form.selectRole}
            />
          </section>

          <section className="flex shrink-0 flex-col gap-3">
            <ProjectPicker
              projects={picker.projects}
              isLoading={picker.isLoading}
              selection={picker.selection}
              onSelectExisting={picker.selectExisting}
              onSetNewName={picker.setNewName}
              onSelectUnsorted={picker.selectUnsorted}
              displayIdPreview={picker.displayIdPreview}
            />
          </section>

          <ContextDocumentPicker 
            documents={documents}
            selectedDocIds={form.selectedDocIds}
            progressMap={progressMap}
            onToggle={form.toggleDoc}
            onUpload={addDocument}
          />
        </div>

        <footer className="mt-5 flex shrink-0 items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => onConfirm(undefined)}
            className="text-[14px] transition-opacity ease-[cubic-bezier(.2,.8,.2,1)] hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)] rounded"
            style={{ color: tokens.mute }}
          >
            Skip this context
          </button>
          <StartCaptureButton onClick={() => onConfirm(form.toMeetingContext())} />
        </footer>
      </div>
    </div>
  );
};
