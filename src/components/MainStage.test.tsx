import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MainStage } from './MainStage';
import type { StreamView } from '../types';

const main: StreamView = { id: 'm', role: '主视角', side: 'main', sources: [] };

const baseProps = { main, quality: '1080p' as const, titleFallback: '主视角', matchTitle: null, messages: [] };

describe('MainStage danmaku toggle', () => {
  it('shows the danmaku overlay when switched on', () => {
    render(<MainStage {...baseProps} showDanmaku />);
    expect(document.querySelector('.dm-overlay')).not.toBeNull();
  });

  it('hides the danmaku overlay when switched off', () => {
    render(<MainStage {...baseProps} showDanmaku={false} />);
    expect(document.querySelector('.dm-overlay')).toBeNull();
  });
});
