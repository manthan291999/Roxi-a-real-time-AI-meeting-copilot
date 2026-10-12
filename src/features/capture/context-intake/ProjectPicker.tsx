import React from 'react';
import { Project, ProjectRef, ProjectSelection } from '../../../shared/types';
import { tokens, radius, ChevronDownIcon } from '../../../design-system';

interface ProjectPickerProps {
  projects: Project[];
  isLoading: boolean;
  selection: ProjectSelection;
  onSelectExisting: (project: ProjectRef) => void;
  onSetNewName: (name: string) => void;
  onSelectUnsorted: () => void;
  displayIdPreview: string | null;
}

const FIELD_CLASS =
  'w-full h-10 border px-3 text-[13px] outline-none transition-[border-color,box-shadow] focus:border-[var(--t-signal-line)] focus:shadow-[0_0_0_4px_var(--t-signal-focus)] placeholder:text-[var(--t-mute-dim)]';

const FIELD_STYLE: React.CSSProperties = {
  borderRadius: radius.control,
  background: tokens.card,
  borderColor: tokens.hairline,
  color: tokens.paper,
};

/**
 * Pure presentation: renders the project picker.
 * All state lives in useProjectPicker. This component has no useState, no useEffect.
 */
export const ProjectPicker: React.FC<ProjectPickerProps> = ({
  projects, isLoading, selection, onSelectExisting, onSetNewName, onSelectUnsorted, displayIdPreview
}) => (
  <div className="flex flex-col gap-2">
    <div className="flex items-center gap-2">
      <div className="relative flex-1 min-w-0">
        <select
          aria-label="Project"
          className={`${FIELD_CLASS} appearance-none pr-9 cursor-pointer disabled:cursor-wait disabled:opacity-60`}
          style={FIELD_STYLE}
          value={
            selection.kind === 'existing' ? selection.project.id.toString()
              : selection.kind === 'new' ? 'new'
              : 'unsorted'
          }
          onChange={(e) => {
            const val = e.target.value;
            if (val === 'unsorted') onSelectUnsorted();
            else if (val === 'new') onSetNewName('New Project');
            else {
              const p = projects.find(x => x.id.toString() === val);
              if (p) onSelectExisting(p);
            }
          }}
          disabled={isLoading}
        >
          <option value="unsorted">Unsorted</option>
          {projects.map(p => (
            <option key={p.id} value={p.id.toString()}>{p.name} ({p.code})</option>
          ))}
          <option value="new">+ New project</option>
        </select>
        <ChevronDownIcon
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
          style={{ color: tokens.mute }}
        />
      </div>

      {selection.kind === 'new' && (
        <input
          type="text"
          aria-label="New project name"
          placeholder="Project name…"
          className={`${FIELD_CLASS} flex-1 min-w-0`}
          style={FIELD_STYLE}
          value={selection.name}
          onChange={(e) => onSetNewName(e.target.value)}
        />
      )}
    </div>

    {displayIdPreview && (
      <span className="px-1 text-[12px]" style={{ color: tokens.mute }}>
        Project code{' '}
        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: tokens.signalDim, color: tokens.signal }}>
          {displayIdPreview}
        </span>
      </span>
    )}
  </div>
);
