// Brings jest-dom's matcher types into tsc; vitest.setup.ts registers them at runtime but sits outside tsconfig's src include.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthBrand } from '../components';

describe('AuthBrand', () => {
  it.each(['light', 'onBrand'] as const)('names the product "Roxi" with its descriptor (%s)', (tone) => {
    const { container } = render(<AuthBrand tone={tone} />);
    expect(screen.getByText('Roxi')).toBeInTheDocument();
    expect(screen.getByText('Meeting copilot')).toBeInTheDocument();
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
    // The mark is decorative; the name carries the meaning.
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
