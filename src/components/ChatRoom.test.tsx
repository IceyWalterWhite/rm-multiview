import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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
