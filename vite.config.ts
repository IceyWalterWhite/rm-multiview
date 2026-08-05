/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // worktree 都开在主工作区目录树下，vitest 默认的 exclude 不含它们 —— 不排掉的话
    // 一次 `vitest run` 会把每个 worktree 的测试也跑一遍（274 文件 / 75s，而非 40 / 5s），
    // 且分支上按 cwd 找文件的测试（如 officialUserscript 读 public/*.user.js）会假失败
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
      '**/.worktree/**',
      '**/.claude/worktrees/**',
    ],
  },
})
