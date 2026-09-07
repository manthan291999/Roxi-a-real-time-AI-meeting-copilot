import React, { useState } from 'react';
import { ChatMessage } from '../../../shared/types';
import { tokens, radius, ChevronDownIcon } from '../../../design-system';

interface Props {
  message: ChatMessage;
  onFollowUpClick?: (question: string) => void;
}

export const RoxiAnswerCard: React.FC<Props> = ({ message, onFollowUpClick }) => {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const hasSources = message.sources && message.sources.length > 0;
  const hasFollowUps = message.followUps && message.followUps.length > 0;

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
                {line}
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
                    <div 
                      key={idx}
                      className="text-[11px] p-2 rounded flex flex-col gap-1 max-w-[280px]"
                      style={{ 
                        background: 'rgba(255,255,255,0.03)', 
                        border: `1px solid ${tokens.hairline}`,
                        borderRadius: radius.card
                      }}
                    >
                      <div className="flex items-center justify-between font-medium" style={{ color: tokens.mute }}>
                        <span className="truncate pr-2">{source.meeting_title || 'Meeting'}</span>
                        <span>{source.date ? new Date(source.date).toLocaleDateString() : ''}</span>
                      </div>
                      <div className="line-clamp-3" style={{ color: tokens.paper }}>
                        <span className="font-medium mr-1" style={{ color: tokens.signal }}>{source.speaker}:</span>
                        {source.text}
                      </div>
                    </div>
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
                    background: 'rgba(255,255,255,0.05)', 
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
