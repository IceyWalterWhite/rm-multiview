import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Profile } from '../types';
import { IdentityEditor } from './IdentityEditor';

const baseProfile: Profile = {
  nickname: 'UserA',
  schoolName: 'A大学',
  position: '校友',
  racingAge: 0,
  badge: '',
};

describe('IdentityEditor', () => {
  it('does not allow whitespace-only identity fields to be saved', () => {
    render(
      <IdentityEditor
        value={{ ...baseProfile, nickname: '   ' }}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('trims identity fields before saving', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <IdentityEditor
        value={{ ...baseProfile, nickname: '  UserA  ', schoolName: '  A大学  ' }}
        onSave={onSave}
        onClose={onClose}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onSave).toHaveBeenCalledWith({
      ...baseProfile,
      nickname: 'UserA',
      schoolName: 'A大学',
    });
    expect(onClose).toHaveBeenCalled();
  });
});
