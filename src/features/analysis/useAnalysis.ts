import { useState, useEffect } from 'react';
import { useServices } from '../../context';

export function useAnalysis() {
  const { eventBus } = useServices();
  const [risks, setRisks] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);

  useEffect(() => {
    const unlistenRisks = eventBus.onMeetingRisks((r) => setRisks(r));
    const unlistenDecisions = eventBus.onMeetingDecisions((d) => setDecisions(d));
    const unlistenActions = eventBus.onMeetingActionItems((a) => setActions(a));

    return () => {
      unlistenRisks();
      unlistenDecisions();
      unlistenActions();
    };
  }, [eventBus]);

  return {
    risks,
    decisions,
    actions
  };
}
