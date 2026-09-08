import React, { useEffect, useState } from 'react';
import { Project } from '../../shared/types';
import { useServices } from '../../context/useServices';
import { ProjectList } from './ProjectList';
import { ProjectDetail } from './ProjectDetail';

/**
 * The main route for the library screen.
 * Fetches projects and manages the master/detail selection state.
 */
export const ProjectLibrary: React.FC = () => {
  const { projectRepository, documentService } = useServices();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<number | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    projectRepository.list().then(list => {
      if (!cancelled) {
        setProjects(list);
        if (list.length > 0 && selectedId === undefined) {
          setSelectedId(list[0].id);
        }
        setIsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [projectRepository]); // omit selectedId to prevent resetting on every change

  const selectedProject = projects.find(p => p.id === selectedId);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Master pane (Sidebar) */}
      <div className="w-80 flex-shrink-0 border-r" style={{ borderColor: 'var(--t-hairline)' }}>
        <ProjectList 
          projects={projects} 
          isLoading={isLoading}
          selectedId={selectedId} 
          onSelect={setSelectedId} 
        />
      </div>

      {/* Detail pane */}
      <div className="flex-1 min-w-0 flex flex-col relative bg-transparent">
        {selectedProject ? (
          <ProjectDetail project={selectedProject} documentService={documentService} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--t-mute)' }}>
            {isLoading ? 'Loading projects...' : 'No project selected'}
          </div>
        )}
      </div>
    </div>
  );
};
