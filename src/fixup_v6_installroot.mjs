// fixup_v6_installroot.mjs —— 把已打上 patch_v6 的 app 修正为「提示音目录在安装根目录」+ 浮层 base 参数
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const appDir = process.argv[2] || 'D:\\DeepSeek\\DSH-pet\\app';
const helperDir = join(appDir, 'runtime', 'electron-helper');
const insDir = join(process.argv[3] || 'G:\\文件\\DSH工作区\\.pet-build', 'ins');

// 1) standalone.js：SFX 目录改到安装根目录
{
  const p = join(appDir, 'lib', 'standalone.js');
  let src = readFileSync(p, 'utf8');
  const old = `\tconst SFX_KINDS = {\n\t\tnotify: join(PACKAGE_ROOT, "sounds", "notify"),\n\t\tchime: join(PACKAGE_ROOT, "sounds", "chime")\n\t};`;
  const neu = `\t// 提示音目录放在**安装根目录**下（<安装目录>\\\\sounds\\\\notify 与 \\\\sounds\\\\chime），可用环境变量 DSH_PET_INSTALL_ROOT 覆盖。\n\tconst INSTALL_ROOT = (() => {\n\t\tconst envRoot = String(process.env.DSH_PET_INSTALL_ROOT ?? "").trim();\n\t\tif (envRoot !== "") return envRoot;\n\t\ttry { return dirname(PACKAGE_ROOT); } catch (e) { return PACKAGE_ROOT; }\n\t})();\n\tconst SFX_KINDS = {\n\t\tnotify: join(INSTALL_ROOT, "sounds", "notify"),\n\t\tchime: join(INSTALL_ROOT, "sounds", "chime")\n\t};`;
  if (!src.includes(old)) {
    console.log('[skip] standalone.js：未找到旧 SFX 块');
  } else {
    src = src.replace(old, neu);
    writeFileSync(p, src, 'utf8');
    console.log('[ok] standalone.js：提示音目录改为安装根目录');
  }
}

// 2) main.js：浮层 query 增加 base
{
  const p = join(helperDir, 'main.js');
  let src = readFileSync(p, 'utf8');
  const old = `    anim: String(data.anim || '抽陀螺'),\n  });`;
  const neu = `    anim: String(data.anim || '抽陀螺'),\n    base: origin,\n  });`;
  if (!src.includes(old)) {
    console.log('[skip] main.js：未找到 qs 块');
  } else {
    src = src.replace(old, neu);
    writeFileSync(p, src, 'utf8');
    console.log('[ok] main.js：浮层 query 增加 base');
  }
}

// 3) 复制最新的 extras.js / todo-overlay.html
for (const name of ['extras.js', 'todo-overlay.html']) {
  copyFileSync(join(insDir, name), join(helperDir, name));
  console.log('[ok] 复制 ' + name);
}
