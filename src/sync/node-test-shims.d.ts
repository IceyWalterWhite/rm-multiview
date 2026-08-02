// 测试专用最小 Node 声明：tsconfig.app 的 types 白名单刻意不含 "node"
// （避免 Node 全局泄进浏览器代码的类型图）。tsDemux.test.ts 需要读磁盘上的
// 真实分片 fixture，这里只声明用到的最小面。若未来引入 @types/node 请删除本文件。
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
// vitest 的模块包装器提供 __dirname（esbuild CJS 互操作）
declare const __dirname: string;
