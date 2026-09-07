import React from 'react';
import { tokens } from '../../design-system/tokens';

interface EmptyStateProps {
  message: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message }) => {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-[14px] italic text-center px-4" style={{ color: tokens.muteDim }}>
        {message}
      </div>
    </div>
  );
};
