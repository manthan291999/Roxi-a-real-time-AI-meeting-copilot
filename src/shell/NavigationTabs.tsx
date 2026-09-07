import React from 'react';
import { tokens, radius, easing } from '../design-system/tokens';
import { WidgetTab } from '../shared/types/ui';

interface NavigationTabsProps {
  activeTab: WidgetTab;
  onChange: (tab: WidgetTab) => void;
}

const TABS: { id: WidgetTab; label: string }[] = [
  { id: 'suggest', label: 'Suggest' },
  { id: 'ask', label: 'Ask' },
  { id: 'listen', label: 'Listen' },
];

/** Pill-segmented tab control — see docs/design-direction-memo.md's TabControl spec. */
export const NavigationTabs: React.FC<NavigationTabsProps> = ({ activeTab, onChange }) => {
  return (
    <div
      className="flex items-center gap-1 mx-4 mt-3 p-1 z-20"
      style={{
        borderRadius: radius.panel - 8,
        background: tokens.panelRaised,
        border: `1px solid ${tokens.hairlineSoft}`,
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className="flex-1 h-9 text-[17px] font-semibold cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-focus-ring)]"
            style={{
              borderRadius: radius.chip,
              background: isActive ? tokens.signalDim : 'transparent',
              color: isActive ? tokens.signal : tokens.mute,
              border: `1px solid ${isActive ? tokens.signalLine : 'transparent'}`,
              transition: `all 0.2s ${easing.calm}`,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
