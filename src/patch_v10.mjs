// patch_v10.mjs —— 用 ins/ 下的最终版 helper 脚本覆盖构建产物
// 用途：把「弹窗可交互 / 报时大小 / 窗口守护」等一系列修复固化进构建链，保证从源码重建可复现。
// 幂等：每次都是整文件覆盖。
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = process.argv[2];
if (!appDir) {
  console.error('用法: node patch_v10.mjs <appDir>');
  process.exit(1);
}
const helperDir = join(appDir, 'runtime', 'electron-helper');
const files = ['main.js', 'preload.js', 'extras.js', 'index.html'];
for (const f of files) {
  const src = join(here, 'ins', f);
  const dst = join(helperDir, f);
  if (!existsSync(src)) {
    console.error('[skip] 缺少源文件 ' + src);
    continue;
  }
  copyFileSync(src, dst);
  console.log('[ok] ' + f + ' 已用 ins/ 最终版覆盖');
}
