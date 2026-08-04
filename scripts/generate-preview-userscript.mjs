import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, 'public/rmlive-companion.user.js');
const defaultOutputPath = resolve(root, 'dist/rmlive-companion.preview.user.js');

function replaceRequired(source, matcher, replacement, label) {
  const result = source.replace(matcher, replacement);
  if (result === source) throw new Error(`Could not generate preview userscript: ${label}`);
  return result;
}

export function generatePreviewUserscript(outputPath = defaultOutputPath) {
  let source = readFileSync(sourcePath, 'utf8');
  source = replaceRequired(source, /^\/\/ @name\s+.*$/m, '// @name         RM 多视角直播助手（预发布验收）', 'name');
  source = replaceRequired(source, /^\/\/ @namespace\s+.*$/m, '// @namespace    https://edgeone.cool/', 'namespace');
  source = replaceRequired(source, /^\/\/ @description\s+.*$/m, '// @description  仅用于 EdgeOne HTTPS 预发布环境的官方投票与观看计时验收。', 'description');
  source = replaceRequired(source, /^\/\/ @match\s+https:\/\/rmlive\.cn\/\*$/m, '// @match        https://rm-multiview-*.edgeone.cool/*', 'production match');
  source = replaceRequired(source, /^\/\/ @match\s+https:\/\/www\.rmlive\.cn\/\*\r?\n/m, '', 'www production match');
  source = replaceRequired(source, /^\/\/ @updateURL.*\r?\n/m, '', 'update URL');
  source = replaceRequired(source, /^\/\/ @downloadURL.*\r?\n/m, '', 'download URL');
  source = replaceRequired(
    source,
    "  const ALLOWED_ORIGINS = new Set(['https://rmlive.cn', 'https://www.rmlive.cn']);",
    "  const ALLOWED_ORIGINS = new Set(['https://rmlive.cn', 'https://www.rmlive.cn']);\n"
      + "  const PREVIEW_ORIGIN = /^https:\\/\\/rm-multiview-[a-z0-9]+\\.edgeone\\.cool$/;\n"
      + "\n"
      + "  function isAllowedPageOrigin(origin) {\n"
      + "    return ALLOWED_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin);\n"
      + "  }",
    'preview-origin guard',
  );
  source = replaceRequired(
    source,
    '|| !ALLOWED_ORIGINS.has(event.origin)',
    '|| !isAllowedPageOrigin(event.origin)',
    'message-origin guard',
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, source, 'utf8');
  return outputPath;
}

generatePreviewUserscript(process.argv[2] ? resolve(process.argv[2]) : defaultOutputPath);
