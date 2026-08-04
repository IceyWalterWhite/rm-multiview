import { describe, expect, it } from 'vitest';
import {
  CHEER_INFO_POLL_MS,
  CHEER_TARGET_POLL_MS,
  companionScriptUrlFor,
} from './config';

describe('cheer polling intervals', () => {
  it('refreshes votes every 5 seconds', () => {
    expect(CHEER_INFO_POLL_MS).toBe(5_000);
  });

  it('refreshes the current match every 10 seconds', () => {
    expect(CHEER_TARGET_POLL_MS).toBe(10_000);
  });
});

describe('companion script URL', () => {
  it('uses the preview-only userscript on an EdgeOne preview host', () => {
    expect(companionScriptUrlFor('rm-multiview-dpuae20rpy3m.edgeone.cool'))
      .toBe('/rmlive-companion.preview.user.js');
  });

  it('uses the production userscript everywhere else', () => {
    expect(companionScriptUrlFor('rmlive.cn')).toBe('/rmlive-companion.user.js');
  });
});
