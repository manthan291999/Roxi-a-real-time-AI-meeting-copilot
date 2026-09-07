import React from 'react';
import { Meeting } from '../../shared/types';
import { tokens, radius, easing } from '../../design-system/tokens';

interface MeetingDetailModalProps {
  meeting: Meeting | null;
  onClose: () => void;
}

export const MeetingDetailModal: React.FC<MeetingDetailModalProps> = ({ meeting, onClose }) => {
  if (!meeting) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col pointer-events-auto">
      <div 
        className="flex-1 cursor-pointer transition-opacity"
        style={{ background: 'rgba(0, 0, 0, 0.4)' }}
        onClick={onClose}
      />
      <div 
        className="flex flex-col h-[75%] rounded-t-[16px] overflow-hidden"
        style={{ 
          background: tokens.panelRaised,
          boxShadow: '0 -4px 16px rgba(0,0,0,0.2)',
          transition: `transform 0.3s ${easing.calm}`
        }}
      >
        <div className="flex items-center justify-between px-5 py-4 shrink-0 border-b" style={{ borderColor: tokens.hairline }}>
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: tokens.paper }}>Meeting Transcript</h2>
            <div className="text-[12px] opacity-70" style={{ color: tokens.mute }}>
              {new Date(meeting.date).toLocaleString()}
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 cursor-pointer"
            style={{ color: tokens.mute }}
          >
            ✕
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar text-[14px] leading-relaxed whitespace-pre-wrap" style={{ color: tokens.paper }}>
          {('transcript' in meeting ? (meeting as any).transcript : null) || <span className="italic" style={{ color: tokens.muteDim }}>No transcript available for this meeting.</span>}
        </div>
      </div>
    </div>
  );
};
