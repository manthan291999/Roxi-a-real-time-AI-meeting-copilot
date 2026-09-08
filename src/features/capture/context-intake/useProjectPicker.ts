import { useCallback, useEffect, useMemo, useState } from 'react';
import { Project, ProjectRef, ProjectSelection, deriveProjectCode } from '../../../shared/types';
import { IProjectRepository } from '../../../shared/interfaces';

export interface ProjectPickerState {
  projects: Project[];
  isLoading: boolean;
  selection: ProjectSelection;
  /** Call when user picks an existing project from the list. */
  selectExisting(project: ProjectRef): void;
  /** Call when user types a new-project name. */
  setNewName(name: string): void;
  /** Call when user explicitly chooses "No project". */
  selectUnsorted(): void;
  /** Preview of the display_id — e.g. "ACME-008". Null until a project is selected. */
  displayIdPreview: string | null;
}

/**
 * All picker state lives here, not in the component.
 * The component stays a pure layout shell.
 */
export function useProjectPicker(repository: IProjectRepository): ProjectPickerState {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selection, setSelection] = useState<ProjectSelection>({ kind: 'unsorted' });

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    repository.list().then(list => {
      if (!cancelled) {
        setProjects(list);
        setIsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [repository]);

  const selectExisting = useCallback((project: ProjectRef) => {
    setSelection({ kind: 'existing', project });
  }, []);

  const setNewName = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setSelection({ kind: 'unsorted' });
    } else {
      setSelection({ kind: 'new', name: trimmed });
    }
  }, []);

  const selectUnsorted = useCallback(() => {
    setSelection({ kind: 'unsorted' });
  }, []);

  /** Preview the CODE-NNN display id without a server round-trip. */
  const displayIdPreview = useMemo(() => {
    if (selection.kind === 'existing') {
      const count = selection.project ? '???' : null; // In a full implementation we'd know seq here
      return count ? `${selection.project.code}-${count}` : null;
    }
    if (selection.kind === 'new') {
      const code = deriveProjectCode(selection.name);
      return `${code}-001`; // first meeting in a new project
    }
    return null;
  }, [selection]);

  return { projects, isLoading, selection, selectExisting, setNewName, selectUnsorted, displayIdPreview };
}
