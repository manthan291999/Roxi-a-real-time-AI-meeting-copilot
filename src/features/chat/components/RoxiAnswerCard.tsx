import React, { useMemo, useState } from 'react';
import { ChatMessage } from '../../../shared/types';
import { openExternalUrl } from '../../../services/externalLinks';
import { tokens, radius, ChevronDownIcon, Markdown } from '../../../design-system';
import { ChatSource } from '../../../shared/types';
import { SourceChip } from './SourceChip';

interface Props {
  message: ChatMessage;
  onFollowUpClick?: (question: string) => void;
}

/** Splits a line on inline citation tokens like `[M64]`, `[D2]`, `[G1]`, `[L1]`, `[W1]`. */
const CITATION_SPLIT = /(\[[A-Z]\d+\])/g;
/** Matches one isolated meeting-ref token, e.g. `[M64]` — captures the id. */
const MEETING_TOKEN = /^\[M(\d+)\]$/;
/** Matches any isolated citation token, to tell one apart from surrounding prose. */
const CITATION_TOKEN = /^\[[A-Z]\d+\]$/;

/** What a citation token resolves to. `url` is present only for web sources. */
interface Citation {
  label: string;
  url?: string;
}

/**
 * Build the ref -> citation map from the answer's own source cards.
 *
 * Meetings resolve to their name and read inline as prose, which is how this
 * has always worked. Web sources resolve to a link instead: replacing [W1]
 * with a hostname mid-sentence would break the line, so the token stays a
 * token and becomes clickable.
 */
function buildCitations(sources: ChatSource[] | undefined): Map<string, Citation> {
  const map = new Map<string, Citation>();
  for (const s of sources || []) {
    if (!s.ref) continue;
    if (s.sourceType === 'web' && s.url) {
      map.set(s.ref, { label: s.title || hostOf(s.url), url: s.url });
    } else if (s.sourceType === 'meeting' && s.meetingName) {
      map.set(s.ref, { label: s.meetingName });
    }
  }
  return map;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Splits a run of answer text on citation tokens and resolves what it can.
 *
 * A meeting ref becomes its bolded, signal-coloured name. A meeting ref with
 * no stored name (recorded before names shipped) still drops the bracket and
 * renders as "Meeting #64", matching the Sources card's own fallback. A web
 * ref becomes a small clickable marker that keeps its number, so the sentence
 * keeps its rhythm and the source is one click away. Anything unresolved
 * renders unchanged rather than disappearing.
 */
function renderCitedLine(
  line: string,
  citations: Map<string, Citation>,
  keyPrefix: string,
): React.ReactNode {
  const parts = line.split(CITATION_SPLIT);
  if (parts.length === 1) return line;
  return parts.map((part, i) => {
    if (!CITATION_TOKEN.test(part)) return part;
    const ref = part.slice(1, -1);
    const hit = citations.get(ref);

    if (hit?.url) {
      return (
        <button
          key={`${keyPrefix}-${i}`}
          type="button"
          onClick={() => openExternalUrl(hit.url)}
          title={hit.label}
          aria-label={`Source ${ref}: ${hit.label}`}
          className="align-super mx-[1px] px-[4px] text-[9px] font-semibold leading-[1.5] hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
          style={{
            color: tokens.signal,
            background: tokens.signalDim,
            border: `1px solid ${tokens.signalLine}`,
            borderRadius: radius.pill,
            outlineColor: tokens.focusRing,
          }}
        >
          {ref}
        </button>
      );
    }
    if (hit) {
      return (
        <strong key={`${keyPrefix}-${i}`} style={{ color: tokens.signal, fontWeight: 600 }}>
          {hit.label}
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
  /**
   * Answered with the Knowledge switch off. Marked explicitly because the
   * absence of source chips is otherwise ambiguous — it would read as a
   * search that found nothing rather than a search that never ran.
   */
  const isDirect = message.mode === 'direct';
  /**
   * This answer was actually checked against the web. Worth stating for the
   * same reason the line below states the opposite: with the Web switch on,
   * most answers still will not have searched, so the switch's position tells
   * the reader nothing about the reply in front of them.
   */
  const checkedWeb = Boolean(message.usedWebSearch);

  const citations = useMemo(() => buildCitations(message.sources), [message.sources]);

  return (
    <div className="flex w-full justify-start animate-fade-in">
      <div className="flex gap-3 max-w-[90%] min-w-0">
        {/* Roxi Avatar */}
        <div 
          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center mt-1"
          style={{ background: tokens.panelRaised, border: `1px solid ${tokens.hairline}` }}
        >
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: tokens.signal }}></div>
        </div>

        {/* Card Content */}
        <div className="flex flex-col gap-3 pt-1.5 min-w-0" style={{ color: tokens.paper }}>
          {/* Answer Text */}
          <Markdown
            className="text-[14px]"
            source={message.content}
            renderText={(text, key) => renderCitedLine(text, citations, key)}
            onLinkClick={openExternalUrl}
          />

          {checkedWeb && (
            <div
              className="text-[11px] flex items-center gap-1.5 mt-1"
              style={{ color: tokens.muteDim }}
            >
              <span aria-hidden="true">{'\u{1F310}'}</span>
              Checked the web for this
            </div>
          )}

          {/* Answered without retrieval — say so where sources would be. */}
          {isDirect && !hasSources && !checkedWeb && (
            <div
              className="text-[11px] flex items-center gap-1.5 mt-1"
              style={{ color: tokens.muteDim }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: tokens.muteDim }}
              />
              Answered without your meetings
            </div>
          )}

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
