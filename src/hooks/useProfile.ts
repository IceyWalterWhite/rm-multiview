import { useCallback, useState } from 'react';
import type { Profile } from '../types';

const KEY = 'rm-multiview.profile';
export const DEFAULT_PROFILE: Profile = {
  nickname: '', schoolName: '', position: '校友', racingAge: 0, badge: '',
};

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function useProfile() {
  const [profile, setProfileState] = useState<Profile>(load);
  const setProfile = useCallback((p: Profile) => {
    setProfileState(p);
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore quota */ }
  }, []);
  const isComplete = profile.nickname.trim() !== '' && profile.schoolName.trim() !== '';
  return { profile, setProfile, isComplete };
}
