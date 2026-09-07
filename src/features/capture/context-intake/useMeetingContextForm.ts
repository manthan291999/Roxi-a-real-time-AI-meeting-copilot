import { useCallback, useMemo, useState } from 'react';
import { MeetingContext, MeetingPreset, MeetingRole } from '../../../shared/types';

export interface MeetingContextForm {
  description: string;
  selectedPresetId?: string;
  selectedRoleId?: string;
  setDescription: (value: string) => void;
  applyPreset: (preset: MeetingPreset) => void;
  selectRole: (role: MeetingRole) => void;
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

  const toMeetingContext = useCallback((): MeetingContext | undefined => {
    const trimmed = description.trim();
    if (!trimmed && !selectedRole) return undefined;
    return { description: trimmed || undefined, role: selectedRole };
  }, [description, selectedRole]);

  return useMemo(
    () => ({
      description,
      selectedPresetId,
      selectedRoleId: selectedRole?.id,
      setDescription: handleDescriptionChange,
      applyPreset,
      selectRole,
      toMeetingContext,
    }),
    [description, selectedPresetId, selectedRole, handleDescriptionChange, applyPreset, selectRole, toMeetingContext],
  );
}
