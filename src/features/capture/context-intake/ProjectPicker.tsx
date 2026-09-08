import React from 'react';
import { Project, ProjectRef, ProjectSelection } from '../../../shared/types';
import { tokens } from '../../../design-system';

interface ProjectPickerProps {
  projects: Project[];
  isLoading: boolean;
  selection: ProjectSelection;
  onSelectExisting: (project: ProjectRef) => void;
  onSetNewName: (name: string) => void;
  onSelectUnsorted: () => void;
  displayIdPreview: string | null;
}

/**
 * Pure presentation: renders the project picker.
 * All state lives in useProjectPicker. This component has no useState, no useEffect.
 */
export const ProjectPicker: React.FC<ProjectPickerProps> = ({
  projects, isLoading, selection, onSelectExisting, onSetNewName, onSelectUnsorted, displayIdPreview
}) => {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[14px] font-semibold tracking-tight" style={{ color: tokens.paper }}>
        Project Scope
      </label>
      
      <div className="flex items-center gap-3">
        <select
          className="flex-1 bg-transparent border rounded p-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          style={{ borderColor: tokens.hairline, color: tokens.paper }}
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

        {selection.kind === 'new' && (
          <input 
            type="text" 
            placeholder="Project name..." 
            className="flex-1 bg-transparent border rounded p-2 text-sm focus-visible:outline-none focus-visible:ring-2"
            style={{ borderColor: tokens.hairline, color: tokens.paper }}
            value={selection.name}
            onChange={(e) => onSetNewName(e.target.value)}
          />
        )}
      </div>

      {displayIdPreview && (
        <span className="text-xs mt-1" style={{ color: tokens.mute }}>
          Preview Code: <span className="font-mono">{displayIdPreview}</span>
        </span>
      )}
    </div>
  );
};
