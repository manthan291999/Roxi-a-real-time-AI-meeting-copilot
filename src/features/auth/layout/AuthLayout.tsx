import React from 'react';
import { tokens } from '../../../design-system';
import { AuthBrand } from '../components';
import { BrandPanel } from './BrandPanel';

/**
 * The split frame every sign-in screen sits in: brand panel on the left, the
 * form on the right. Owns layout only; which form shows is the caller's job.
 *
 * On a narrow window the brand panel hides and a compact lockup appears
 * above the form (`.auth-compact-brand`, styles.css).
 */
export const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex-1 flex min-h-0 animate-fade-in">
    <BrandPanel />
    <section
      className="flex-1 min-w-0 overflow-y-auto custom-scrollbar flex flex-col items-center px-6 pt-14 pb-10"
      style={{ background: tokens.sheet }}
    >
      <div className="auth-compact-brand justify-center pb-8">
        <AuthBrand />
      </div>
      <div className="w-full max-w-[400px] my-auto animate-card-enter">{children}</div>
    </section>
  </div>
);
