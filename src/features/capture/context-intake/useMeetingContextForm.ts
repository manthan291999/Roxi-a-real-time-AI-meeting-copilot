import { useCallback, useMemo, useState } from 'react';
import { MeetingContext, MeetingPreset, MeetingRole, ProjectSelection } from '../../../shared/types';

export interface MeetingContextForm {
  description: string;
  selectedPresetId?: string;
  selectedRoleId?: string;
  project?: ProjectSelection;
  selectedDocIds: string[];
  setDescription: (value: string) => void;
  applyPreset: (preset: MeetingPreset) => void;
  selectRole: (role: MeetingRole) => void;
  setProject: (project: ProjectSelection) => void;
  toggleDoc: (docId: string) => void;
  /** The assembled context, or undefined when nothing was filled in. */
  toMeetingContext: () => MeetingContext | undefined;
}

/**
 * Form state for the pre-capture intake, kept out of the presentation components
 * so MeetingContextModal only composes and the chips stay dumb.
 */
export function useMeetingContextForm(): MeetingContextForm {
  const [description, setDescription] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>();
  const [selectedRole, setSelectedRole] = useState<MeetingRole | undefined>();
  const [project, setProject] = useState<ProjectSelection | undefined>();
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);

  /** Typing by hand clears the preset highlight — the text no longer matches it. */
  const handleDescriptionChange = useCallback((value: string) => {
    setDescription(value);
    setSelectedPresetId(undefined);
  }, []);

  const applyPreset = useCallback((preset: MeetingPreset) => {
    setSelectedPresetId((current: string | undefined) => {
      const isDeselecting = current === preset.id;
      setDescription(isDeselecting ? '' : preset.description);
      return isDeselecting ? undefined : preset.id;
    });
  }, []);

  const selectRole = useCallback((role: MeetingRole) => {
    setSelectedRole((current: MeetingRole | undefined) => (current?.id === role.id ? undefined : role));
  }, []);

  const toggleDoc = useCallback((docId: string) => {
    setSelectedDocIds((prev) => {
      if (prev.includes(docId)) return prev.filter((id) => id !== docId);
      if (prev.length >= 3) return prev; // max 3 documents
      return [...prev, docId];
    });
  }, []);

  const toMeetingContext = useCallback((): MeetingContext | undefined => {
    const trimmed = description.trim();
    if (!trimmed && !selectedRole && !project && selectedDocIds.length === 0) return undefined;
    return { 
      description: trimmed || undefined, 
      role: selectedRole, 
      project,
      docIds: selectedDocIds.length > 0 ? selectedDocIds : undefined
    };
  }, [description, selectedRole, project, selectedDocIds]);

  return useMemo(
    () => ({
      description,
      selectedPresetId,
      selectedRoleId: selectedRole?.id,
      project,
      selectedDocIds,
      setDescription: handleDescriptionChange,
      applyPreset,
      selectRole,
      setProject,
      toggleDoc,
      toMeetingContext,
    }),
    [description, selectedPresetId, selectedRole, project, selectedDocIds, handleDescriptionChange, applyPreset, selectRole, toggleDoc, toMeetingContext],
  );
}
