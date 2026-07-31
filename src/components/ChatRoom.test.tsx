import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ChatRoom } from './ChatRoom';
import { DEFAULT_PROFILE } from '../hooks/useProfile';
import type { Danmaku } from '../types';

const mk = (id: string, text: string): Danmaku => ({
  id, text, nickname: 'n', schoolName: 's', position: '队员', racingAge: 0, badge: '', sendTime: 0, userId: 0,
});
const noop = () => {};

function renderRoom(messages: Danmaku[]) {
  const props = { zoneName: 'z', profile: DEFAULT_PROFILE, isComplete: true, onSend: noop, onEditIdentity: noop };
  const utils = render(<ChatRoom {...props} messages={messages} />);
  const list = utils.container.querySelector('.chatroom-list') as HTMLElement;
  const rerenderWith = (msgs: Danmaku[]) => utils.rerender(<ChatRoom {...props} messages={msgs} />);
  return { ...utils, list, rerenderWith };
}

function mockScrollBox(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
}

describe('ChatRoom danmaku disabled', () => {
  it('shows a notice instead of the composer when danmaku is disabled', () => {
    const props = { zoneName: 'z', profile: DEFAULT_PROFILE, isComplete: true, onSend: noop, onEditIdentity: noop };
    const { container, getByText, queryByRole } = render(
      <ChatRoom {...props} messages={[]} danmakuEnabled={false} />,
    );
    expect(getByText('本场直播未开启弹幕')).toBeInTheDocument();
    expect(queryByRole('button', { name: '发送' })).toBeNull();
    expect(container.querySelector('.composer-input')).toBeNull();
  });
});

describe('ChatRoom auto-scroll', () => {
  it('follows new messages while the user is at the bottom', () => {
    const { list, rerenderWith } = renderRoom([mk('1', 'a')]);
    mockScrollBox(list, 1000, 300);
    list.scrollTop = 700; // 正贴底（1000-700-300=0）
    fireEvent.scroll(list);
    rerenderWith([mk('1', 'a'), mk('2', 'b')]);
    expect(list.scrollTop).toBe(1000);
  });

  it('does not yank the list back down while the user reads history', () => {
    const { list, rerenderWith } = renderRoom([mk('1', 'a')]);
    mockScrollBox(list, 1000, 300);
    list.scrollTop = 100; // 上翻看历史
    fireEvent.scroll(list);
    rerenderWith([mk('1', 'a'), mk('2', 'b')]);
    expect(list.scrollTop).toBe(100);
  });

  it('is keyboard scrollable', () => {
    const { list } = renderRoom([]);
    expect(list).toHaveAttribute('tabindex', '0');
  });
});

describe('ChatRoom new-message pill', () => {
  const pill = () => screen.queryByRole('button', { name: /有新消息/ });

  it('shows a jump-to-bottom pill when messages arrive while reading history', () => {
    const { list, rerenderWith } = renderRoom([mk('1', 'a')]);
    mockScrollBox(list, 1000, 300);
    list.scrollTop = 100; // 上翻
    fireEvent.scroll(list);
    rerenderWith([mk('1', 'a'), mk('2', 'b')]);
    expect(pill()).toBeInTheDocument();
  });

  it('does not show the pill while stuck to the bottom', () => {
    const { list, rerenderWith } = renderRoom([mk('1', 'a')]);
    mockScrollBox(list, 1000, 300);
    list.scrollTop = 700; // 贴底
    fireEvent.scroll(list);
    rerenderWith([mk('1', 'a'), mk('2', 'b')]);
    expect(pill()).toBeNull();
  });

  it('clicking the pill returns to the bottom and hides it', () => {
    const { list, rerenderWith } = renderRoom([mk('1', 'a')]);
    mockScrollBox(list, 1000, 300);
    // jsdom 无真实滚动；给 scrollTo 一个落到 scrollTop 的实现
    list.scrollTo = ((o?: ScrollToOptions) => { list.scrollTop = Number(o?.top ?? 0); }) as typeof list.scrollTo;
    list.scrollTop = 100;
    fireEvent.scroll(list);
    rerenderWith([mk('1', 'a'), mk('2', 'b')]);
    fireEvent.click(pill()!);
    expect(list.scrollTop).toBe(1000);
    expect(pill()).toBeNull();
  });

  it('scrolling back to the bottom manually dismisses the pill', () => {
    const { list, rerenderWith } = renderRoom([mk('1', 'a')]);
    mockScrollBox(list, 1000, 300);
    list.scrollTop = 100;
    fireEvent.scroll(list);
    rerenderWith([mk('1', 'a'), mk('2', 'b')]);
    expect(pill()).toBeInTheDocument();
    list.scrollTop = 700; // 手动拖回底
    fireEvent.scroll(list);
    expect(pill()).toBeNull();
  });
});
