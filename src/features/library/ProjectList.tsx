import React from 'react';
import { Project } from '../../shared/types';

interface ProjectListProps {
  projects: Project[];
  isLoading: boolean;
  selectedId?: number;
  onSelect: (id: number) => void;
}

/**
 * Left sidebar rendering the list of projects.
 */
export const ProjectList: React.FC<ProjectListProps> = ({ projects, isLoading, selectedId, onSelect }) => {
  return (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar p-2 gap-1">
      {isLoading && projects.length === 0 && (
        <div className="p-4 text-xs text-center" style={{ color: 'var(--t-mute)' }}>Loading...</div>
      )}
      
      {!isLoading && projects.length === 0 && (
        <div className="p-4 text-xs text-center" style={{ color: 'var(--t-mute)' }}>No projects found.</div>
      )}

      {projects.map(project => {
        const isSelected = project.id === selectedId;
        
        return (
          <button
            key={project.id}
            onClick={() => onSelect(project.id)}
            className="flex flex-col items-start p-3 rounded-md text-left transition-colors duration-150"
            style={{ 
              backgroundColor: isSelected ? 'var(--t-overlay-hover)' : 'transparent',
              color: 'var(--t-paper)'
            }}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-semibold text-sm truncate pr-2">{project.name}</span>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--t-overlay)', color: 'var(--t-mute)' }}>
                {project.code}
              </span>
            </div>
            
            <div className="text-xs mt-1" style={{ color: 'var(--t-mute)' }}>
              {project.meeting_count === 1 ? '1 meeting' : `${project.meeting_count} meetings`}
              {project.documents && project.documents.length > 0 && ` • ${project.documents.length} docs`}
            </div>
          </button>
        );
      })}
    </div>
  );
};
