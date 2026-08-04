import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

// 时码同步控件归属主视角右上角（与静音同处一区），不再挂在底部控制栏
describe('MainStage sync control', () => {
  it('places the sync control alongside the mute button', async () => {
    const onToggleSync = vi.fn();
    render(<MainStage {...baseProps} showDanmaku={false} syncOn onToggleSync={onToggleSync} syncTrim={0} onSyncTrim={() => {}} />);

    const tools = document.querySelector('.stage-tools');
    expect(tools).not.toBeNull();
    expect(tools!.querySelector('.sync-pill')).not.toBeNull();
    expect(tools!.querySelector('.mute-btn')).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /时码同步/ }));
    expect(onToggleSync).toHaveBeenCalled();
  });

  it('keeps the trim affordance reachable by its accessible name', async () => {
    const onSyncTrim = vi.fn();
    render(<MainStage {...baseProps} showDanmaku={false} syncOn onToggleSync={() => {}} syncTrim={0} onSyncTrim={onSyncTrim} />);
    await userEvent.click(screen.getByRole('button', { name: /同步微调/ }));
    expect(screen.getByRole('slider', { name: /同步微调/ })).toBeInTheDocument();
  });

  it('omits the sync control when the host supplies no handler', () => {
    render(<MainStage {...baseProps} showDanmaku={false} />);
    expect(document.querySelector('.sync-pill')).toBeNull();
    expect(document.querySelector('.mute-btn')).not.toBeNull();
  });
});
