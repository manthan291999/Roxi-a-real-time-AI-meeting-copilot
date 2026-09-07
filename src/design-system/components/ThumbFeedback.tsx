import React from 'react';

interface ThumbFeedbackProps {
  onThumbUp?: () => void;
  onThumbDown?: () => void;
}

export const ThumbFeedback: React.FC<ThumbFeedbackProps> = ({ onThumbUp, onThumbDown }) => {
  return (
    <div className="flex gap-2">
      <button onClick={onThumbUp} className="hover:bg-[#34343d] p-1 rounded transition-colors" title="Helpful">
        👍
      </button>
      <button onClick={onThumbDown} className="hover:bg-[#34343d] p-1 rounded transition-colors" title="Not helpful">
        👎
      </button>
    </div>
  );
};
