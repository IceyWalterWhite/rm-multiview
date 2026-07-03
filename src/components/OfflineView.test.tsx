import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OfflineView } from './OfflineView';

describe('OfflineView', () => {
  it('shows the no-live mask on the first screen', () => {
    render(<OfflineView />);
    expect(screen.getByText(/当前没有直播/)).toBeVisible();
  });

  it('still renders the embedded community tools below, so it can be scrolled into view', () => {
    render(<OfflineView />);
    // ReservedPanel keeps embedding the community tool sites regardless of live state
    expect(screen.getByTitle('华南虎赛程分析软件')).toBeVisible();
  });
});
