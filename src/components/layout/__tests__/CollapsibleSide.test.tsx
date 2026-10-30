// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleSide } from '../CollapsibleSide.tsx';

describe('CollapsibleSide', () => {
  beforeEach(() => localStorage.clear());

  it('keeps children mounted when collapsed, so the OrderPanel still takes chart Execute clicks', () => {
    render(<CollapsibleSide><div data-testid="child">panel</div></CollapsibleSide>);
    fireEvent.click(screen.getByTestId('right-collapse-toggle'));
    expect(screen.getByTestId('right-panel').dataset.collapsed).toBe('1');
    const child = screen.getByTestId('child');
    expect(child.parentElement!.style.display).toBe('none');
  });
});
