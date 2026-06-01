import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageItem } from './MessageItem';
import type { Danmaku } from '../types';
import { COLOR_VETERAN, COLOR_COMMON } from '../config';

const base: Danmaku = { id: '1', text: '加油', nickname: '强强', schoolName: '清华大学', position: '校友', racingAge: 0, badge: 'electronicTenth', sendTime: 0, userId: 0 };

describe('MessageItem', () => {
  it('renders text, nickname, school and tag', () => {
    render(<MessageItem d={base} />);
    expect(screen.getByText('加油')).toBeInTheDocument();
    expect(screen.getByText('强强')).toBeInTheDocument();
    expect(screen.getByText('清华大学')).toBeInTheDocument();
    expect(screen.getByText('校友')).toBeInTheDocument();
  });
  it('uses gold color for 老队员', () => {
    render(<MessageItem d={{ ...base, position: '老队员', racingAge: 2 }} />);
    expect(screen.getByText('2年老队员')).toHaveStyle({ color: COLOR_VETERAN });
  });
  it('uses common color for 队员', () => {
    render(<MessageItem d={{ ...base, position: '队员', racingAge: 1 }} />);
    expect(screen.getByText('1年队员')).toHaveStyle({ color: COLOR_COMMON });
  });
  it('shows badge node only when badge present', () => {
    const { rerender } = render(<MessageItem d={base} />);
    expect(screen.getByTestId('badge')).toBeInTheDocument();
    rerender(<MessageItem d={{ ...base, badge: '' }} />);
    expect(screen.queryByTestId('badge')).toBeNull();
  });
});
