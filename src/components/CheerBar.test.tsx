/// <reference types="node" />
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHEER_BUBBLES } from '../config';
import { CheerBar } from './CheerBar';

const themeCss = readFileSync('src/theme.css', 'utf8');

const RED = '江南大学霞客湾校区 SHARK';
const BLUE = '山东理工大学 齐奇';
const OFFICIAL = 'https://www.robomaster.com/zh-CN/live';

const base = {
  redVotes: 2628,
  blueVotes: 2397,
  redLabel: RED,
  blueLabel: BLUE,
  canVote: false as boolean,
  officialUrl: OFFICIAL,
};

function stubMedia(matching: string | null) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: matching !== null && q.includes(matching),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('CheerBar', () => {
  it('renders both team labels and the initial vote counts', () => {
    render(<CheerBar {...base} />);
    expect(screen.getByText(RED)).toBeInTheDocument();
    expect(screen.getByText(BLUE)).toBeInTheDocument();
    expect(screen.getByText('2,628')).toBeInTheDocument();
    expect(screen.getByText('2,397')).toBeInTheDocument();
  });

  it('splits the bar in half when neither side has votes yet', () => {
    const { container } = render(<CheerBar {...base} redVotes={0} blueVotes={0} />);
    expect(container.querySelector<HTMLElement>('.cheer__fill--red')?.style.width).toBe('50%');
    expect(container.querySelector<HTMLElement>('.cheer__fill--blue')?.style.width).toBe('50%');
  });

  it('clamps the VS badge so a landslide never pushes it off the track', () => {
    const { container } = render(<CheerBar {...base} redVotes={10000} blueVotes={0} />);
    expect(container.querySelector<HTMLElement>('.cheer__vs')?.style.left).toBe('92%');
  });

  it('lights both delta chips when both sides gain in the same poll', () => {
    const { container, rerender } = render(<CheerBar {...base} />);
    act(() => { rerender(<CheerBar {...base} redVotes={2688} blueVotes={2452} />); });
    const chips = container.querySelectorAll('.cheer__chip.is-on');
    expect(chips).toHaveLength(2);
    expect(container.querySelector('.cheer__chip--red')?.textContent).toBe('+60');
    expect(container.querySelector('.cheer__chip--blue')?.textContent).toBe('+55');
  });

  it('keeps the VS pulse and puts gain icons in the matching delta chips', () => {
    const { container, rerender } = render(<CheerBar {...base} />);
    act(() => { rerender(<CheerBar {...base} redVotes={2700} blueVotes={2450} />); });
    expect(container.querySelector('.cheer__vs')).toHaveClass('is-pulse');
    expect(container.querySelectorAll('.cheer__bubble')).toHaveLength(0);
    expect(container.querySelector<HTMLImageElement>('.cheer__chip--red img')?.src).toBe(CHEER_BUBBLES.red[0]);
    expect(container.querySelector<HTMLImageElement>('.cheer__chip--blue img')?.src).toBe(CHEER_BUBBLES.blue[0]);
  });

  it('only marks the side that actually gained', () => {
    const { container, rerender } = render(<CheerBar {...base} />);
    act(() => { rerender(<CheerBar {...base} blueVotes={2500} />); });
    expect(container.querySelectorAll('.cheer__chip.is-on')).toHaveLength(1);
    expect(container.querySelector('.cheer__chip--blue')?.className).toContain('is-on');
    expect(container.querySelectorAll('.cheer__bubble--red')).toHaveLength(0);
  });

  it('retires the transient gain chip and its icon after their lifetime', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<CheerBar {...base} />);
    act(() => { rerender(<CheerBar {...base} redVotes={2700} />); });
    expect(container.querySelector('.cheer__chip--red img')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2500); });
    expect(container.querySelectorAll('.cheer__chip.is-on')).toHaveLength(0);
    expect(container.querySelector('.cheer__chip--red img')).toBeNull();
  });

  it('keeps the VS badge inert instead of linking to the official cheer page', () => {
    const { container } = render(<CheerBar {...base} />);
    expect(container.querySelector('.cheer a')).toBeNull();
    expect(container.querySelector('.cheer__vs')?.tagName).toBe('SPAN');
  });

  it('stays completely inert while voting is unavailable', () => {
    const { container } = render(<CheerBar {...base} canVote={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('.cheer__team--red')?.tagName).toBe('DIV');
  });

  it('makes each half of the bar its own vote target instead of adding a pill', async () => {
    const onVote = vi.fn();
    const { container } = render(<CheerBar {...base} canVote onVote={onVote} />);
    const red = screen.getByRole('button', { name: `为${RED}助威` });
    // 点的就是这支队伍那半边本身（队名、票数都在按钮里），不是另立的一颗小按钮
    expect(red).toHaveClass('cheer__team--red');
    expect(red).toHaveTextContent(RED);
    expect(container.querySelectorAll('button')).toHaveLength(2);

    await userEvent.click(red);
    expect(onVote).toHaveBeenCalledWith('red');
    await userEvent.click(screen.getByRole('button', { name: `为${BLUE}助威` }));
    expect(onVote).toHaveBeenCalledWith('blue');
  });

  it('extends the vote hit area below the 6px track rather than growing the row', () => {
    // 轨道只有 .375rem 高，靠它自己接不住手指；命中区必须往下延到轨道那一半
    expect(themeCss).toMatch(/\.cheer__team--vote::after\s*\{[^}]*inset:0 0 -/);
  });

  it('surfaces the error message from the data layer', () => {
    render(<CheerBar {...base} error="请先补全个人信息" />);
    expect(screen.getByRole('alert')).toHaveTextContent('请先补全个人信息');
  });

  it('keeps a screen-reader summary with the exact counts', () => {
    const { container } = render(<CheerBar {...base} />);
    const summary = container.querySelector<HTMLElement>('.sr-only');
    expect(summary?.textContent)
      .toContain(`红方 ${RED} 2628 票`);
    expect(themeCss).toMatch(/\.sr-only\s*\{[^}]*position:absolute/);
  });

  it('overlays the bar on the main stage without reserving video space', () => {
    expect(themeCss).toMatch(/\.main-stage\s*>\s*\.cheer\s*\{[^}]*position:absolute[^}]*bottom:0/);
    expect(themeCss).not.toMatch(/\.main-stage\s*>\s*\.video-wrap\s*\{[^}]*position:relative/);
  });

  it('under reduced motion the counts land on the new value without a spring', () => {
    stubMedia('reduced-motion');
    const { rerender } = render(<CheerBar {...base} />);
    rerender(<CheerBar {...base} redVotes={3000} />);
    expect(screen.getByText('3,000')).toBeInTheDocument();
  });

  it('keeps the gain icon static under reduced motion', () => {
    stubMedia('reduced-motion');
    const { container, rerender } = render(<CheerBar {...base} />);
    act(() => { rerender(<CheerBar {...base} redVotes={2700} />); });
    expect(container.querySelectorAll('.cheer__bubble')).toHaveLength(0);
    expect(container.querySelector('.cheer__chip--red')?.textContent).toBe('+72');
    expect(container.querySelector<HTMLImageElement>('.cheer__chip--red img')?.src).toBe(CHEER_BUBBLES.red[0]);
  });
});
