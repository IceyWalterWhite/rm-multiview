import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = process.cwd();
const generator = resolve(root, 'scripts/generate-preview-userscript.mjs');
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('preview userscript build artifact', () => {
  it('is restricted to the EdgeOne preview domain and derives from the production script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rm-preview-userscript-'));
    tempDirs.push(dir);
    const output = join(dir, 'rmlive-companion.preview.user.js');

    execFileSync(process.execPath, [generator, output], { cwd: root });
    const source = readFileSync(output, 'utf8');

    expect(source).toContain('// @match        https://rm-multiview-*.edgeone.cool/*');
    expect(source).not.toContain('// @match        https://rmlive.cn/*');
    expect(source).not.toContain('// @match        https://www.rmlive.cn/*');
    expect(source).not.toMatch(/^\/\/ @(updateURL|downloadURL)/m);
    expect(source).toContain('const PREVIEW_ORIGIN = /^https:\\/\\/rm-multiview-[a-z0-9]+\\.edgeone\\.cool$/;');
    expect(source).toContain('!isAllowedPageOrigin(event.origin)');
    expect(source).toContain('heartbeat: `${OFFICIAL_ORIGIN}/registration/watchHeartbeat`');
  });
});
