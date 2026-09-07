import React from 'react';
import { useAnalysis } from './useAnalysis';
import { GlassCard, VerifiedIcon, AssignmentIcon, WarningIcon, tokens } from '../../design-system';

export const AnalysisPane: React.FC = () => {
  const { risks, decisions, actions } = useAnalysis();

  if (risks.length === 0 && decisions.length === 0 && actions.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[var(--t-mute-dim)] italic text-[14px]">
        No analysis generated yet...
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-6 h-full overflow-y-auto custom-scrollbar">
      {decisions.length > 0 && (
        <section>
          <h3 className="text-[var(--t-paper)] font-medium mb-3 flex items-center gap-2">
            <VerifiedIcon className="w-[18px] h-[18px]" style={{ color: tokens.decision }} />
            Decisions
          </h3>
          <div className="flex flex-col gap-2">
            {decisions.map((decision, i) => (
              <GlassCard key={i} animateEnter>
                <p className="text-[14px] text-[var(--t-paper)]">{decision.text}</p>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {actions.length > 0 && (
        <section>
          <h3 className="text-[var(--t-paper)] font-medium mb-3 flex items-center gap-2">
            <AssignmentIcon className="w-[18px] h-[18px]" style={{ color: tokens.signal }} />
            Action Items
          </h3>
          <div className="flex flex-col gap-2">
            {actions.map((action, i) => (
              <GlassCard key={i} animateEnter>
                <p className="text-[14px] text-[var(--t-paper)]">{action.text}</p>
              </GlassCard>
            ))}
          </div>
        </section>
      )}

      {risks.length > 0 && (
        <section>
          <h3 className="text-[var(--t-paper)] font-medium mb-3 flex items-center gap-2">
            <WarningIcon className="w-[18px] h-[18px]" style={{ color: tokens.risk }} />
            Risks Identified
          </h3>
          <div className="flex flex-col gap-2">
            {risks.map((risk, i) => (
              <GlassCard key={i} animateEnter>
                <p className="text-[14px] text-[var(--t-paper)]">{risk.text}</p>
              </GlassCard>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
