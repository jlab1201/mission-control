import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { AgentStatus } from '@/types';

describe('StatusBadge', () => {
  it('renders ACTIVE status label', () => {
    render(<StatusBadge status="active" />);
    expect(screen.getByText('ACTIVE')).toBeTruthy();
  });

  it('renders IDLE status label', () => {
    render(<StatusBadge status="idle" />);
    expect(screen.getByText('IDLE')).toBeTruthy();
  });

  it('renders DONE status label for completed', () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText('DONE')).toBeTruthy();
  });

  it('renders FAILED status label', () => {
    render(<StatusBadge status="failed" />);
    expect(screen.getByText('FAILED')).toBeTruthy();
  });

  it('applies correct text color for active status', () => {
    render(<StatusBadge status="active" />);
    const label = screen.getByText('ACTIVE');
    expect(label).toHaveStyle({ color: 'var(--success)' });
  });

  it('applies correct text color for failed status', () => {
    render(<StatusBadge status="failed" />);
    const label = screen.getByText('FAILED');
    expect(label).toHaveStyle({ color: 'var(--danger)' });
  });

  it('applies correct text color for completed status', () => {
    render(<StatusBadge status="completed" />);
    const label = screen.getByText('DONE');
    expect(label).toHaveStyle({ color: 'var(--accent-secondary)' });
  });

  it('applies correct text color for idle status', () => {
    render(<StatusBadge status="idle" />);
    const label = screen.getByText('IDLE');
    expect(label).toHaveStyle({ color: 'var(--text-muted)' });
  });

  it('renders fallback (idle) for unrecognized status without throwing', () => {
    // Component uses `?? STATUS_CONFIG['idle']` — unknown status falls back to idle
    expect(() => render(<StatusBadge status={'unknown' as AgentStatus} />)).not.toThrow();
    expect(screen.getByText('IDLE')).toBeTruthy();
  });
});
