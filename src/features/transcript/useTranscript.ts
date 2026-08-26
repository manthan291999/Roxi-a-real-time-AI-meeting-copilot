import { useState, useRef, useCallback, useEffect, useContext } from 'react';
import { TxLine } from '../../types';
import { ServicesContext } from '../../context/ServicesContext';
import { SpeakerEntry } from './SpeakerRenameModal';

let lineIdCounter = 0;
function newId() { return String(++lineIdCounter); }

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function useTranscript() {
  const [lines, setLines] = useState<TxLine[]>([]);
  const [sessionSpeakers, setSessionSpeakers] = useState<SpeakerEntry[]>([]);
  
  const partialIdRef = useRef<string | null>(null);
  const lastActiveSpeakerRef = useRef<string | null>(null);

  const services = useContext(ServicesContext);

  const setPartialId = useCallback((id: string | null) => {
    partialIdRef.current = id;
  }, []);

  useEffect(() => {
    if (!services) return;

    const eventBus = services.eventBus;
    const speakerRepo = services.speakerRepo;

    const unsubs: (() => void)[] = [];

    eventBus.onTranscriptPartial(e => {
      const { text, speaker } = e;
      const time = nowTime();
      setLines(prev => {
        const pid = partialIdRef.current;
        if (pid) {
          return prev.map(l => l.id === pid ? { ...l, text, time } : l);
        }
        const id = newId();
        partialIdRef.current = id;
        return [...prev, { id, speaker, speakerIdx: speakerRepo.resolveIndex(speaker), text, partial: true, time }];
      });
    }).then(u => unsubs.push(u));

    eventBus.onTranscriptFinal(e => {
      const { text, speaker, sttLabel } = e;
      lastActiveSpeakerRef.current = speaker;
      const time = nowTime();

      if (sttLabel) {
        setSessionSpeakers(prev => {
          const exists = prev.find(s => s.sttLabel === sttLabel);
          if (!exists) return [...prev, { sttLabel, displayName: speaker }];
          return prev.map(s => s.sttLabel === sttLabel ? { ...s, displayName: speaker } : s);
        });
      }

      setLines(prev => {
        const pid = partialIdRef.current;
        partialIdRef.current = null;
        if (pid) {
          return prev.map(l => l.id === pid ? { ...l, text, partial: false, time } : l);
        }
        const id = newId();
        return [...prev, { id, speaker, speakerIdx: speakerRepo.resolveIndex(speaker), text, partial: false, time }];
      });
    }).then(u => unsubs.push(u));

    return () => {
      unsubs.forEach(u => u());
    };
  }, [services]);

  return { lines, setLines, sessionSpeakers, setPartialId, lastActiveSpeakerRef };
}
