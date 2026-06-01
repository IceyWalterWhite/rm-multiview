import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DanmakuComposer } from './DanmakuComposer';
import { DEFAULT_PROFILE } from '../hooks/useProfile';

describe('DanmakuComposer', () => {
  it('calls onSend with typed text and clears input', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    const profile = { ...DEFAULT_PROFILE, nickname: '强强', schoolName: '清华大学', position: '校友' };
    render(<DanmakuComposer profile={profile} isComplete onSend={onSend} onEditIdentity={() => {}} />);
    const input = screen.getByRole('textbox'); // by role, not placeholder copy (which is user-editable)
    await userEvent.type(input, '！！');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onSend).toHaveBeenCalledWith('！！');
    expect((input as HTMLInputElement).value).toBe('');
  });
  it('prompts identity edit when incomplete', async () => {
    const onEditIdentity = vi.fn();
    render(<DanmakuComposer profile={DEFAULT_PROFILE} isComplete={false} onSend={vi.fn()} onEditIdentity={onEditIdentity} />);
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(onEditIdentity).toHaveBeenCalled();
  });
});
