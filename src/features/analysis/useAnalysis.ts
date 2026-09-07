import { useState, useEffect } from 'react';
import { useServices } from '../../context';
import { MeetingDecision, MeetingActionItem, MeetingRisk } from '../../shared/types';

export function useAnalysis() {
  const { eventBus } = useServices();
  const [risks, setRisks] = useState<MeetingRisk[]>([]);
  const [decisions, setDecisions] = useState<MeetingDecision[]>([]);
  const [actions, setActions] = useState<MeetingActionItem[]>([]);

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
