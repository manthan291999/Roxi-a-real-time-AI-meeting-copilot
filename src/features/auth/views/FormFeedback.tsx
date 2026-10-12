import React from 'react';
import { AuthNotice } from '../components';
import { recoveryActionFor } from './recoveryActions';
import { FeedbackProps } from './viewProps';

/** The server's error (with its recovery action) and any success notice. */
export const FormFeedback: React.FC<FeedbackProps> = ({ error, notice, ...ctx }) => (
  <>
    {error && (
      <AuthNotice tone="error" action={recoveryActionFor(error.code, ctx)}>
        {error.message}
      </AuthNotice>
    )}
    {notice && <AuthNotice tone="success">{notice}</AuthNotice>}
  </>
);
