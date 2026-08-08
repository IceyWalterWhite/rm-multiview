import { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RobotPanel, type RobotPanelProps } from './RobotPanel';

function setup(over: Partial<RobotPanelProps> = {}) {
  const onPin = vi.fn();
  const onHoverChange = vi.fn();
  const props: RobotPanelProps = {
    viewId: 'fight2026001',
    name: '红方·英雄',
    team: 'red',
    hp: 320,
    maxHp: 400,
    status: 'alive',
    pinned: false,
    hasSelection: true,
    onPin,
    onHoverChange,
    hostRef: createRef<HTMLDivElement>(),
    ...over,
  };
  return { onPin, onHoverChange, ...render(<RobotPanel {...props} />) };
}

describe('RobotPanel', () => {
  it('leads with the robot name and the icon-only pin button', () => {
    setup();
    expect(screen.getByText('红方·英雄')).toBeInTheDocument();
    const pin = screen.getByRole('button', { name: '固定到上方' });
    expect(pin.textContent).toBe(''); // 仅图标，不带文字标签
  });

  it('removes the 第一视角 suffix from the robot name', () => {
    setup({ name: '红方英雄第一视角' });
    expect(screen.getByText('红方英雄')).toBeInTheDocument();
    expect(screen.queryByText('红方英雄第一视角')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '红方英雄 详情' })).toBeInTheDocument();
  });

  it('shows current / max hp with a bar', () => {
    const { container } = setup();
    expect(screen.getByText('320 / 400')).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('.rp__hp-fill')?.style.width).toBe('80%');
  });

  it('says the robot is down instead of printing a stale number', () => {
    const { container } = setup({ status: 'dead', hp: 0, maxHp: 400 });
    expect(screen.getByText('已阵亡')).toBeInTheDocument();
    expect(container.querySelector('.rp__hp')?.className).toContain('is-dead');
  });

  it('admits when the hp reading is unavailable', () => {
    setup({ hp: null, maxHp: null });
    expect(screen.getByText('血量读不到')).toBeInTheDocument();
  });

  it('pins the robot into the selected slot', async () => {
    const { onPin } = setup();
    await userEvent.click(screen.getByRole('button', { name: '固定到上方' }));
    expect(onPin).toHaveBeenCalledTimes(1);
  });

  it('greys out and explains why when no grid tile is selected', async () => {
    const { onPin } = setup({ hasSelection: false });
    const pin = screen.getByRole('button', { name: '固定到上方' });
    expect(pin).toHaveAttribute('aria-disabled', 'true');

    // 置灰但仍接得住点击 —— 不然观众只知道"点不动"，不知道该先做什么
    await userEvent.click(pin);
    expect(onPin).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('请选择待替换的视角');
  });

  it('gives a different reason when the stream is already up in the grid', async () => {
    const { onPin } = setup({ pinned: true });
    const pin = screen.getByRole('button', { name: '固定到上方' });
    expect(pin).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(pin);
    expect(onPin).not.toHaveBeenCalled();
    // 两种置灰的原因必须能分辨
    expect(screen.getByRole('status')).toHaveTextContent('已经在上面的机位网格里了');
  });

  it('replaces the live preview with 已固定 once the stream is in the grid', () => {
    const { container, rerender } = setup();
    expect(container.querySelector('.rp__preview canvas')).toBeInTheDocument();

    rerender(
      <RobotPanel
        viewId="fight2026001" name="红方·英雄" team="red" hp={320} maxHp={400} status="alive"
        pinned hasSelection onPin={vi.fn()} onHoverChange={vi.fn()} hostRef={createRef<HTMLDivElement>()}
      />,
    );
    expect(screen.getByText('已固定')).toBeInTheDocument();
    expect(container.querySelector('.rp__preview canvas')).not.toBeInTheDocument();
  });

  it('freezes the follow loop while the pointer rests on the card', async () => {
    const { onHoverChange, container } = setup();
    const card = container.querySelector('.rp__card')!;
    await userEvent.hover(card);
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
    await userEvent.unhover(card);
    expect(onHoverChange).toHaveBeenLastCalledWith(false);
  });
});
