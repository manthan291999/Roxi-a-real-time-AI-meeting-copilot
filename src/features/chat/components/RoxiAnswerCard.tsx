import React, { useMemo, useState } from 'react';
import { ChatMessage } from '../../../shared/types';
import { tokens, ChevronDownIcon } from '../../../design-system';
import { SourceChip } from './SourceChip';

interface Props {
  message: ChatMessage;
  onFollowUpClick?: (question: string) => void;
}

/** Splits a line on inline citation tokens like `[M64]`, `[D2]`, `[G1]`, `[L1]`. */
const CITATION_SPLIT = /(\[[A-Z]\d+\])/g;
/** Matches one isolated meeting-ref token, e.g. `[M64]` — captures the id. */
const MEETING_TOKEN = /^\[M(\d+)\]$/;
/** Matches any isolated citation token, to tell one apart from surrounding prose. */
const CITATION_TOKEN = /^\[[A-Z]\d+\]$/;

/**
 * Splits a line of answer text on citation tokens and resolves any that name
 * a meeting to its bolded, signal-colored name via `names`. A meeting ref
 * with no stored name (recorded before this feature shipped) still drops the
 * bracket — it renders as the plain "Meeting #64" label instead, matching
 * the Sources card's own fallback. Document/glossary/live tokens with
 * nothing to resolve against render unchanged.
 */
function renderCitedLine(line: string, names: Map<string, string>, keyPrefix: string): React.ReactNode {
  const parts = line.split(CITATION_SPLIT);
  if (parts.length === 1) return line;
  return parts.map((part, i) => {
    if (!CITATION_TOKEN.test(part)) return part;
    const ref = part.slice(1, -1);
    const name = names.get(ref);
    if (name) {
      return (
        <strong key={`${keyPrefix}-${i}`} style={{ color: tokens.signal, fontWeight: 600 }}>
          {name}
        </strong>
      );
    }
    const meetingMatch = part.match(MEETING_TOKEN);
    if (meetingMatch) return `Meeting #${meetingMatch[1]}`;
    return part;
  });
}

export const RoxiAnswerCard: React.FC<Props> = ({ message, onFollowUpClick }) => {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const hasSources = message.sources && message.sources.length > 0;
  const hasFollowUps = message.followUps && message.followUps.length > 0;

  const citedMeetingNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const source of message.sources || []) {
      if (source.sourceType === 'meeting' && source.ref && source.meetingName) {
        map.set(source.ref, source.meetingName);
      }
    }
    return map;
  }, [message.sources]);

  return (
    <div className="flex w-full justify-start animate-fade-in">
      <div className="flex gap-3 max-w-[90%]">
        {/* Roxi Avatar */}
        <div 
          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-1"
          style={{ background: tokens.panelRaised, border: `1px solid ${tokens.hairline}` }}
        >
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: tokens.signal }}></div>
        </div>

        {/* Card Content */}
        <div className="flex flex-col gap-3 pt-1.5">
          {/* Answer Text */}
          <div 
            className="text-[14px] leading-relaxed"
            style={{ color: tokens.paper }}
          >
            {message.content.split('\n').map((line, i) => (
              <React.Fragment key={i}>
                {renderCitedLine(line, citedMeetingNames, `line-${i}`)}
                <br />
              </React.Fragment>
            ))}
          </div>

          {/* Sources section */}
          {hasSources && (
            <div className="mt-2">
              <button 
                onClick={() => setSourcesExpanded(!sourcesExpanded)}
                className="text-[12px] flex items-center gap-1 hover:opacity-80 transition-opacity mb-2"
                style={{ color: tokens.mute }}
              >
                <ChevronDownIcon
                  className="w-3.5 h-3.5 transition-transform ease-[cubic-bezier(.2,.8,.2,1)]"
                  style={{ transform: sourcesExpanded ? 'rotate(180deg)' : 'none' }}
                />
                {message.sources!.length} Sources
              </button>
              
              {sourcesExpanded && (
                <div className="flex flex-wrap gap-2">
                  {message.sources!.map((source, idx) => (
                    <SourceChip key={idx} source={source} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Follow-up Chips */}
          {hasFollowUps && (
            <div className="flex flex-wrap gap-2 mt-2">
              {message.followUps!.map((question, idx) => (
                <button
                  key={idx}
                  onClick={() => onFollowUpClick?.(question)}
                  className="text-[12px] px-3 py-1.5 rounded-full transition-all hover:scale-[1.02] active:scale-[0.98] text-left"
                  style={{ 
                    background: tokens.panelRaised, 
                    border: `1px solid ${tokens.hairline}`,
                    color: tokens.paper 
                  }}
                >
                  {question}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
