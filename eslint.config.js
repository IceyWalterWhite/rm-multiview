import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // testdata：实采 MPEG-TS 分片的扩展名恰好与 TypeScript 撞车，解析二进制流必然报错
  globalIgnores(['dist', '.remember', '.superpowers', '.playwright-mcp', '.worktrees', 'recon', 'node_modules', 'testdata']),
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
