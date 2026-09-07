import React from 'react';
import { tokens } from '../../design-system';
import { SuggestScope } from './useSuggestFilters';

interface SuggestFilterToggleProps {
  scope: SuggestScope;
  onChange: (scope: SuggestScope) => void;
}

const SCOPES: { id: SuggestScope; label: string }[] = [
  { id: 'latest', label: 'Latest' },
  { id: 'all', label: 'All' },
];

export const SuggestFilterToggle: React.FC<SuggestFilterToggleProps> = ({ scope, onChange }) => (
  <div
    className="flex rounded-full p-[2px] border"
    style={{ backgroundColor: tokens.panelRaised, borderColor: tokens.hairlineSoft }}
  >
    {SCOPES.map((option) => {
      const isActive = option.id === scope;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={isActive}
          className="px-3 py-1 rounded-full text-[12px] font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: isActive ? tokens.overlay : 'transparent',
            color: isActive ? tokens.paper : tokens.mute,
          }}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);
