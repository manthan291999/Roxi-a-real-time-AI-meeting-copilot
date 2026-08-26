import { useState, useEffect, useContext } from 'react';
import { SCard, TCard, RCard, Significance } from '../../types';
import { ServicesContext } from '../../context/ServicesContext';

let lineIdCounter = 10000;
function newId() { return String(++lineIdCounter); }

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function useAnalysis(lastActiveSpeakerRef: React.MutableRefObject<string | null>) {
  const [summaries, setSummaries] = useState<SCard[]>([]);
  const [technicals, setTechnicals] = useState<TCard[]>([]);
  const [replies, setReplies] = useState<RCard[]>([]);

  const services = useContext(ServicesContext);

  useEffect(() => {
    if (!services) return;

    const eventBus = services.eventBus;
    const speakerRepo = services.speakerRepo;

    const unsubs: (() => void)[] = [];

    eventBus.onContextExplanation(e => {
      const { text, speaker } = e;
      setSummaries(prev => [...prev, { id: newId(), text, sig: 'medium', time: nowTime(), speaker: speaker || 'System', speakerIdx: speakerRepo.resolveIndex(speaker || 'System') }]);
    }).then(u => unsubs.push(u));

    eventBus.onTechnicalExplanation(e => {
      const { text, speaker } = e;
      setTechnicals(prev => [...prev, { id: newId(), text, sig: 'medium', time: nowTime(), speaker: speaker || 'System', speakerIdx: speakerRepo.resolveIndex(speaker || 'System') }]);
    }).then(u => unsubs.push(u));

    eventBus.onChunkSignificance(sigStr => {
      const sig = sigStr.toLowerCase() as Significance;
      setSummaries(prev => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], sig };
        return updated;
      });
      setTechnicals(prev => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], sig };
        return updated;
      });
    }).then(u => unsubs.push(u));

    eventBus.onMeetingDecisions(decisions => {
      const activeSpeaker = lastActiveSpeakerRef.current || 'System';
      const speakerIdx = speakerRepo.resolveIndex(activeSpeaker);
      decisions.forEach(d => {
        setReplies(prev => [...prev, { id: newId(), text: d.text, type: 'decision', speaker: activeSpeaker, speakerIdx }]);
      });
    }).then(u => unsubs.push(u));

    eventBus.onMeetingActionItems(actionItems => {
      actionItems.forEach(a => {
        setReplies(prev => [...prev, { id: newId(), text: a.text, type: 'action', assignee: a.assignee ?? undefined }]);
      });
    }).then(u => unsubs.push(u));

    eventBus.onSuggestedResponse(e => {
      const { text, speaker } = e;
      setReplies(prev => [...prev, { id: newId(), text, type: 'reply', speaker: speaker || 'System', speakerIdx: speakerRepo.resolveIndex(speaker || 'System') }]);
    }).then(u => unsubs.push(u));

    return () => {
      unsubs.forEach(u => u());
    };
  }, [services, lastActiveSpeakerRef]);

  return { summaries, setSummaries, technicals, setTechnicals, replies, setReplies };
}
