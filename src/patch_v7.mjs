// patch_v7：待办整屏浮层的可见性 / 视频同源 / 补提醒窗口修复（在 patch_v6 之后运行）
// 用法：node patch_v7.mjs <app 目录>
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = process.argv[2];
if (!appDir) { console.error('用法: node patch_v7.mjs <app>'); process.exit(1); }
const here = dirname(fileURLToPath(import.meta.url));
const helperDir = join(appDir, 'runtime', 'electron-helper');
const mainPath = join(helperDir, 'main.js');
const standalonePath = join(appDir, 'lib', 'standalone.js');

// 1) 用 ins/ 下的最新版覆盖 extras.js 与 todo-overlay.html
for (const f of ['extras.js', 'todo-overlay.html']) {
  const src = join(here, 'ins', f);
  if (existsSync(src)) {
    copyFileSync(src, join(helperDir, f));
    console.log('[ok] 覆盖 ' + f);
  }
}

// 2) main.js：浮层改为可显示 + 同源 URL + base 带路由前缀
let m = readFileSync(mainPath, 'utf8');
let changed = false;

if (!m.includes("origin ? origin + '/dsh-pet-7340' : ''")) {
  m = m.replace('    base: origin,', "    base: origin ? origin + '/dsh-pet-7340' : '',");
  changed = true;
}

if (!m.includes("origin + '/dsh-pet-7340/overlay?'")) {
  m = m.replace(
    "  win.loadFile(path.join(__dirname, 'todo-overlay.html'), { query: Object.fromEntries(qs) });",
    "  if (origin) win.loadURL(origin + '/dsh-pet-7340/overlay?' + qs.toString());\n  else win.loadFile(path.join(__dirname, 'todo-overlay.html'), { query: Object.fromEntries(qs) });\n  win.show();"
  );
  changed = true;
}

// ready-to-show 里 showInactive 改为 show（透明窗口 showInactive 在本机不生效）
m = m.replace(/win\.showInactive\(\);/g, 'win.show();');

if (!m.includes('浮层状态 isVisible')) {
  m = m.replace(
    "    try { win.focus(); } catch (e) {}",
    "    try { win.focus(); } catch (e) {}\n    if (process.env.DSH_PET_DEBUG_OVERLAY === '1') setTimeout(() => { try { console.error('[dsh-pet] 浮层状态 isVisible=' + win.isVisible()); } catch (e) {} }, 500);"
  );
  changed = true;
}
if (changed) { writeFileSync(mainPath, m, 'utf8'); console.log('[ok] main.js 浮层修复'); }
else console.log('[skip] main.js 已修复');

// 3) standalone.js：待办补提醒窗口 + /overlay 路由
let s = readFileSync(standalonePath, 'utf8');
if (s.includes('delta > 20000')) {
  s = s.replace('if (delta < 0 || delta > 20000) continue;', 'if (delta < 0 || delta > 86400000) continue;');
  console.log('[ok] 待办补提醒窗口放宽到 24h');
}
if (!s.includes('rest === "overlay"')) {
  const anchor = '\t\tif (rest === "anim-file") {';
  const route = '\t\tif (rest === "overlay") {\n' +
    '\t\t\tif (method !== "GET") return { kind: "json", status: 405, obj: { error: "method not allowed" } };\n' +
    '\t\t\tconst file = join(PACKAGE_ROOT, "runtime", "electron-helper", "todo-overlay.html");\n' +
    '\t\t\tif (!existsSync(file)) return { kind: "json", status: 404, obj: { error: "overlay not found" } };\n' +
    '\t\t\treturn { kind: "file", file, contentType: "text/html; charset=utf-8" };\n' +
    '\t\t}\n';
  if (s.includes(anchor)) { s = s.replace(anchor, route + anchor); console.log('[ok] /overlay 路由'); }
  else console.log('[warn] 未找到 anim-file 锚点');
}
writeFileSync(standalonePath, s, 'utf8');
console.log('[done] patch_v7');
