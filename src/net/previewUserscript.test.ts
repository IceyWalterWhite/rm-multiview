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

    // 预览域必须用 @include 而不是 @match：Chrome 的 match pattern 规范里 host 只允许
    // `*`、`*.` 开头或不含通配的具体域名，`rm-multiview-*.edgeone.cool` 这种**中间通配**非法，
    // Tampermonkey 会直接丢弃该条规则 —— 脚本装上了却永远不运行（2026-08-05 实测踩到）。
    // 通配符形式而非正则形式：Tampermonkey 编辑器的 lint 会对正则里的 `\/` 转义报错（实测）。
    expect(source).toContain('// @include      https://rm-multiview-*.edgeone.cool/*');
    expect(source).not.toMatch(/^\/\/ @match/m);
    expect(source).not.toMatch(/^\/\/ @(updateURL|downloadURL)/m);
    expect(source).toContain('const PREVIEW_ORIGIN = /^https:\\/\\/rm-multiview-[a-z0-9]+\\.edgeone\\.cool$/;');
    expect(source).toContain('!isAllowedPageOrigin(event.origin)');
    expect(source).toContain('heartbeat: `${OFFICIAL_ORIGIN}/registration/watchHeartbeat`');
  });
});
