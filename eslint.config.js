import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // testdata：实采 MPEG-TS 分片的扩展名恰好与 TypeScript 撞车，解析二进制流必然报错
  // worktree 三个位置都要排：它们开在主工作区目录树下，不排就会把别的分支的代码算进本分支的 lint
  globalIgnores([
    'dist', '.remember', '.superpowers', '.playwright-mcp', 'recon', 'node_modules', 'testdata',
    '.worktrees', '.worktree', '.claude/worktrees',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
