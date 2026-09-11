import { useCallback, useMemo, useState } from 'react';
import { MeetingContext, MeetingPreset, MeetingRole, ProjectSelection } from '../../../shared/types';

export interface MeetingContextForm {
  name: string;
  description: string;
  selectedPresetId?: string;
  selectedRoleId?: string;
  project?: ProjectSelection;
  selectedDocIds: string[];
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  applyPreset: (preset: MeetingPreset) => void;
  selectRole: (role: MeetingRole) => void;
  setProject: (project: ProjectSelection) => void;
  toggleDoc: (docId: string) => void;
  /** The assembled context. `name` is required — callers gate on it separately. */
  toMeetingContext: () => MeetingContext;
}

/**
 * Form state for the pre-capture intake, kept out of the presentation components
 * so MeetingContextModal only composes and the chips stay dumb.
 */
export function useMeetingContextForm(): MeetingContextForm {
  const [name, setName] = useState('');
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

  const toMeetingContext = useCallback((): MeetingContext => {
    const trimmedDescription = description.trim();
    return {
      name: name.trim(),
      description: trimmedDescription || undefined,
      role: selectedRole,
      project,
      docIds: selectedDocIds.length > 0 ? selectedDocIds : undefined
    };
  }, [name, description, selectedRole, project, selectedDocIds]);

  return useMemo(
    () => ({
      name,
      description,
      selectedPresetId,
      selectedRoleId: selectedRole?.id,
      project,
      selectedDocIds,
      setName,
      setDescription: handleDescriptionChange,
      applyPreset,
      selectRole,
      setProject,
      toggleDoc,
      toMeetingContext,
    }),
    [name, description, selectedPresetId, selectedRole, project, selectedDocIds, handleDescriptionChange, applyPreset, selectRole, toggleDoc, toMeetingContext],
  );
}
