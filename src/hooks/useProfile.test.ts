import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProfile, DEFAULT_PROFILE } from './useProfile';

beforeEach(() => localStorage.clear());

describe('useProfile', () => {
  it('returns default when empty', () => {
    const { result } = renderHook(() => useProfile());
    expect(result.current.profile).toEqual(DEFAULT_PROFILE);
  });

  it('persists updates to localStorage', () => {
    const { result } = renderHook(() => useProfile());
    act(() => result.current.setProfile({ ...DEFAULT_PROFILE, nickname: '强强', schoolName: '清华大学', position: '校友' }));
    expect(result.current.profile.nickname).toBe('强强');
    const { result: r2 } = renderHook(() => useProfile());
    expect(r2.current.profile.schoolName).toBe('清华大学');
  });
});
