// 第四轮补丁：独立配置 + 菜单终稿（去速聊/退出置底/大小/最小化）+ 最小化到托盘 + 尺寸路由
// 用法: node patch_v4.mjs <app 目录>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const appDir = process.argv[2];
if (!appDir) {
  console.error("用法: node patch_v4.mjs <app 目录>");
  process.exit(2);
}
const standalonePath = join(appDir, "lib", "standalone.js");
const spritePath = join(appDir, "runtime", "electron-helper", "sprite.js");
const mainPath = join(appDir, "runtime", "electron-helper", "main.js");
const preloadPath = join(appDir, "runtime", "electron-helper", "preload.js");

function readText(p) {
  return readFileSync(p, "utf8");
}
function once(src, label, needle, file) {
  const n = src.split(needle).length - 1;
  if (n !== 1) throw new Error(`[${file}] 锚点「${label}」命中 ${n} 次（应为 1 次）`);
  return src;
}
function replaceOnce(src, label, needle, replacement, file) {
  once(src, label, needle, file);
  return src.split(needle).join(replacement);
}

// ---------------- standalone.js：独立配置目录 + 尺寸路由 ----------------
let s = readText(standalonePath);
if (s.includes('join(dshHome, "dsh-pet-standalone")')) {
  console.log("[skip] standalone.js 已是独立配置目录");
} else {
  s = replaceOnce(
    s,
    "apply userRoot",
    '\tconst userRoot = join(dshHome, "dsh-pet");\n\tconst userConfigPath = join(userRoot, "main-config.jsonc");',
    '\tconst userRoot = join(dshHome, "dsh-pet-standalone");\n\tconst dshSharedRoot = join(dshHome, "dsh-pet");\n\tconst userConfigPath = join(userRoot, "main-config.jsonc");',
    "standalone.js"
  );
  s = replaceOnce(
    s,
    "首启复制 DSH 配置",
    '\tmigrateUserConfig(configPaths, (msg) => console.log("[dsh-pet] " + msg));',
    '\tmigrateUserConfig(configPaths, (msg) => console.log("[dsh-pet] " + msg));\n' +
      '\t// 独立版：首次运行自动生成自己的配置（从 DSH 那份复制一次，之后各管各的）\n' +
      '\ttry {\n' +
      '\t\tif (!existsSync(userConfigPath)) {\n' +
      '\t\t\tconst sharedConfig = join(dshSharedRoot, "main-config.jsonc");\n' +
      '\t\t\tif (existsSync(sharedConfig)) {\n' +
      '\t\t\t\tmkdirSync(userRoot, { recursive: true });\n' +
      '\t\t\t\twriteFileSync(userConfigPath, String(readFileSync(sharedConfig, "utf8")).replace(/"display"\\s*:\\s*"(?:none|web)"/g, \'"display": "desktop"\'), "utf8");\n' +
      '\t\t\t\tconsole.log("[dsh-pet] 已生成独立配置文件（复制自 DSH）：" + userConfigPath);\n' +
      '\t\t\t}\n' +
      '\t\t}\n' +
      '\t} catch (e) {\n' +
      '\t\tconsole.log("[dsh-pet] 生成独立配置失败：" + (e instanceof Error ? e.message : String(e)));\n' +
      '\t}',
    "standalone.js"
  );
  s = replaceOnce(
    s,
    "configPathsFor userRoot",
    '\tconst userRoot = join(home, "dsh-pet");',
    '\tconst userRoot = join(home, "dsh-pet-standalone");',
    "standalone.js"
  );
  writeFileSync(standalonePath, s, "utf8");
  console.log("[ok] standalone.js 独立配置目录");
}

// 独立版 AI 配置：<DSH_HOME>/dsh-pet-standalone/ai-config.json（与 DSH 分开，旧路径迁移一次）
let s3 = readText(standalonePath);
if (/petAiConfigPath\(\)\s*\{\s*\r?\n\treturn join\(petDshHome\(\), "dsh-pet-standalone"/.test(s3)) {
  console.log("[skip] AI 配置已是独立路径");
} else {
  s3 = replaceOnce(
    s3,
    "AI 配置路径",
    '/** 独立版 AI 配置文件：<DSH_HOME>/dsh-pet/ai-config.json（首次启动自动生成） */\nfunction petAiConfigPath() {\n\treturn join(petDshHome(), "dsh-pet", "ai-config.json");\n}',
    '/** 独立版 AI 配置文件：<DSH_HOME>/dsh-pet-standalone/ai-config.json（首次启动自动生成，与 DSH 完全分开） */\nfunction petAiConfigPath() {\n\treturn join(petDshHome(), "dsh-pet-standalone", "ai-config.json");\n}\n/** 旧版共用路径（迁移用）：<DSH_HOME>/dsh-pet/ai-config.json */\nfunction petAiLegacyConfigPath() {\n\treturn join(petDshHome(), "dsh-pet", "ai-config.json");\n}',
    "standalone.js"
  );
  s3 = replaceOnce(
    s3,
    "AI 配置迁移",
    '\tconst file = petAiConfigPath();',
    '\tconst file = petAiConfigPath();\n' +
      '\t// 从旧共用路径迁移一次（用户填过的 key/模型不丢），之后两边各改各的\n' +
      '\tif (!existsSync(file)) {\n' +
      '\t\tconst legacy = petAiLegacyConfigPath();\n' +
      '\t\ttry {\n' +
      '\t\t\tif (existsSync(legacy)) {\n' +
      '\t\t\t\tmkdirSync(dirname(file), { recursive: true });\n' +
      '\t\t\t\twriteFileSync(file, readFileSync(legacy, "utf8"), "utf8");\n' +
      '\t\t\t\tlogger?.info?.(`[dsh-pet] 已把旧 AI 配置复制为独立版配置：${file}`);\n' +
      '\t\t\t}\n' +
      '\t\t} catch (e) {\n' +
      '\t\t\tlogger?.warn?.(`[dsh-pet] 迁移旧 AI 配置失败：${e instanceof Error ? e.message : String(e)}`);\n' +
      '\t\t}\n' +
      '\t}',
    "standalone.js"
  );
  writeFileSync(standalonePath, s3, "utf8");
  console.log("[ok] AI 配置独立路径 + 迁移");
}

// 尺寸路由：POST /pet/size?pet=<id>&size=<n>
let s2 = readText(standalonePath);
if (s2.includes('rest === "pet/size"')) {
  console.log("[skip] /pet/size 路由已存在");
} else {
  const sizeRoute = `\t\tif (rest === "pet/size") {
\t\t\tif (method !== "POST") return {
\t\t\t\tkind: "json",
\t\t\t\tstatus: 405,
\t\t\t\tobj: { error: "method not allowed" }
\t\t\t};
\t\t\tconst petIdSize = String(url.searchParams.get("pet") ?? "");
\t\t\tconst sizeRaw = Number(url.searchParams.get("size"));
\t\t\tif (!Number.isFinite(sizeRaw) || sizeRaw < 200 || sizeRaw > 1200) return {
\t\t\t\tkind: "json",
\t\t\t\tstatus: 400,
\t\t\t\tobj: { ok: false, message: "size 需要 200..1200" }
\t\t\t};
\t\t\ttry {
\t\t\t\tconst cfgSize = readAllConfig(configPaths);
\t\t\t\tconst foundSize = findPetInstance(cfgSize, petIdSize);
\t\t\t\tif (!foundSize) return {
\t\t\t\t\tkind: "json",
\t\t\t\t\tstatus: 404,
\t\t\t\t\tobj: { ok: false, message: "没有这只宠物：" + petIdSize }
\t\t\t\t};
\t\t\t\tconst entryPets = Array.isArray(cfgSize[foundSize.entry]?.pets) ? cfgSize[foundSize.entry].pets : [];
\t\t\t\tconst nextPets = entryPets.map((p) => p && p.id === foundSize.pet.id ? {
\t\t\t\t\t...p,
\t\t\t\t\tsize: Math.round(sizeRaw)
\t\t\t\t} : p);
\t\t\t\tconst existingSize = readUserConfig(configPaths);
\t\t\t\tconst savedSize = saveUserConfig({ pets: nextPets }, existingSize);
\t\t\t\tif (!savedSize) return {
\t\t\t\t\tkind: "json",
\t\t\t\t\tstatus: 400,
\t\t\t\t\tobj: { ok: false, message: "保存配置失败" }
\t\t\t\t};
\t\t\t\tawait mkdir(userRoot, { recursive: true });
\t\t\t\tawait writeFile(userConfigPath, JSON.stringify(savedSize, null, 2), "utf8");
\t\t\t\tsyncDesktop();
\t\t\t\treturn {
\t\t\t\t\tkind: "json",
\t\t\t\t\tstatus: 200,
\t\t\t\t\tobj: { ok: true, pet: petIdSize, size: Math.round(sizeRaw) }
\t\t\t\t};
\t\t\t} catch (e) {
\t\t\t\treturn {
\t\t\t\t\tkind: "json",
\t\t\t\t\tstatus: 500,
\t\t\t\t\tobj: { ok: false, message: e instanceof Error ? e.message : String(e) }
\t\t\t\t};
\t\t\t}
\t\t}
`;
  s2 = replaceOnce(s2, "插入 /pet/size", '\t\tif (rest === "chat/clear") {', sizeRoute + '\t\tif (rest === "chat/clear") {', "standalone.js");
  writeFileSync(standalonePath, s2, "utf8");
  console.log("[ok] /pet/size 路由");
}

// ---------------- sprite.js：菜单终稿 ----------------
let sp = readText(spritePath);
if (sp.includes("action: 'set-size'")) {
  console.log("[skip] 菜单终稿已存在");
} else {
  const oldTools = `    const tools = [];
    tools.push(
      { label: '碎碎念', action: 'whisper' },
      { label: '对话', action: 'chat' },
      { label: '速聊', children: [
        { label: '夸夸我', action: 'chat-quick', prompt: '夸夸我吧，一句话就好' },
        { label: '讲个笑话', action: 'chat-quick', prompt: '讲个冷笑话给我听' },
        { label: '你在干嘛', action: 'chat-quick', prompt: '你现在在干什么呀' },
        { label: '安慰我', action: 'chat-quick', prompt: '我今天有点累，安慰我一下' },
      ] },
      { label: '随机动作', action: 'random-anim' },
      { label: '清空对话记忆', action: 'chat-clear' },
      { label: '重载配置', action: 'reload' },
      { label: '退出', action: 'quit' },
    );
    const tree = tools.concat(S.buildMenuTree(this.animations));`;
  const newTools = `    const tools = [];
    tools.push(
      { label: '碎碎念', action: 'whisper' },
      { label: '对话', action: 'chat' },
      { label: '清空对话记忆', action: 'chat-clear' },
      { label: '大小', children: [
        { label: '小 (360)', action: 'set-size', size: 360 },
        { label: '标准 (462)', action: 'set-size', size: 462 },
        { label: '大 (600)', action: 'set-size', size: 600 },
        { label: '特大 (760)', action: 'set-size', size: 760 },
      ] },
      { label: '最小化到任务栏', action: 'minimize' },
      { label: '随机动作', action: 'random-anim' },
      { label: '重载配置', action: 'reload' },
    );
    const tree = tools.concat(S.buildMenuTree(this.animations));
    tree.push({ label: '退出', action: 'quit' });`;
  sp = replaceOnce(sp, "菜单工具项终稿", oldTools, newTools, "sprite.js");

  // 去掉「速聊」的 chat-quick 分支，换成 大小 / 最小化
  const oldBranch = `    if (leaf.action === 'chat-quick') {
      const quickText = String(leaf.prompt || '').trim();
      if (!quickText) return;
      fetch(BASE + '/chat?pet=' + encodeURIComponent(this.pet.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: quickText }),
      }).catch(() => {});
      return;
    }`;
  const newBranch = `    if (leaf.action === 'set-size') {
      const nextSize = Math.round(Number(leaf.size) || 0);
      if (nextSize >= 200 && nextSize <= 1200) {
        fetch(BASE + '/pet/size?pet=' + encodeURIComponent(this.pet.id) + '&size=' + nextSize, {
          method: 'POST',
        }).catch(() => {});
      }
      return;
    }
    if (leaf.action === 'minimize') {
      if (window.petBridge && typeof window.petBridge.minimizeToTray === 'function') {
        window.petBridge.minimizeToTray();
      }
      return;
    }`;
  sp = replaceOnce(sp, "去掉速聊分支", oldBranch, newBranch, "sprite.js");
  writeFileSync(spritePath, sp, "utf8");
  console.log("[ok] sprite.js 菜单终稿（去速聊 / 大小 / 最小化 / 退出置底）");
}

// ---------------- helper main.js：最小化到托盘 ----------------
let m = readText(mainPath);
if (m.includes("pet:minimize-to-tray")) {
  console.log("[skip] 托盘最小化已存在");
} else {
  m = replaceOnce(
    m,
    "electron 解构加 Tray/Menu/nativeImage",
    "const { app, BrowserWindow, ipcMain, screen, shell, protocol } = electronApi;",
    "const { app, BrowserWindow, ipcMain, screen, shell, protocol, Tray, Menu, nativeImage } = electronApi;",
    "main.js"
  );
  const trayCode = `// ---- DSH-Pet-Windows 追加：最小化到任务栏（通知区）并右键恢复 ----
let petTray = null;
const trayHidden = new Set();
function trayIconPath() {
  const transparent = path.join(__dirname, '..', '..', 'assets', 'logo-transparent.png');
  try {
    if (require('node:fs').existsSync(transparent)) return transparent;
  } catch {}
  return path.join(__dirname, '..', '..', 'assets', 'logo.png');
}
function destroyTray() {
  if (!petTray) return;
  try {
    petTray.destroy();
  } catch {}
  petTray = null;
}
function showAllHidden() {
  for (const w of trayHidden) {
    try {
      if (!w.isDestroyed()) w.showInactive();
    } catch {}
  }
  trayHidden.clear();
  destroyTray();
}
function ensureTray() {
  if (petTray) return petTray;
  try {
    let img = nativeImage.createFromPath(trayIconPath());
    if (img.isEmpty()) img = nativeImage.createEmpty();
    petTray = new Tray(img);
    petTray.setToolTip('DSH 桌宠（已最小化，右键可恢复）');
    petTray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '恢复桌宠', click: () => showAllHidden() },
        { type: 'separator' },
        { label: '退出桌宠', click: () => app.quit() },
      ]),
    );
    petTray.on('double-click', () => showAllHidden());
  } catch (e) {
    console.error('[dsh-pet] 托盘创建失败:', String(e && e.message ? e.message : e));
    petTray = null;
  }
  return petTray;
}

const windows = new Map();`;
  m = replaceOnce(m, "托盘模块", "const windows = new Map();", trayCode, "main.js");

  const ipcCode = `  // ---- DSH-Pet-Windows 追加：最小化到托盘 / 从托盘恢复 ----
  ipcMain.on('pet:minimize-to-tray', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    trayHidden.add(win);
    try {
      win.hide();
    } catch {}
    ensureTray();
  });
  ipcMain.on('pet:restore-from-tray', () => showAllHidden());
  ipcMain.on('pet:set-bounds', (event, bounds) => {`;
  m = replaceOnce(m, "托盘 ipc", "  ipcMain.on('pet:set-bounds', (event, bounds) => {", ipcCode, "main.js");
  writeFileSync(mainPath, m, "utf8");
  console.log("[ok] main.js 托盘最小化");
}

// ---------------- preload.js：暴露托盘最小化 ----------------
let pl = readText(preloadPath);
if (pl.includes("minimizeToTray")) {
  console.log("[skip] preload 已暴露 minimizeToTray");
} else {
  pl = replaceOnce(
    pl,
    "preload minimizeToTray",
    "  setInteractive(interactive) {",
    "  // 最小化到任务栏（通知区），右键托盘图标可恢复\n  minimizeToTray() {\n    ipcRenderer.send('pet:minimize-to-tray');\n  },\n  restoreFromTray() {\n    ipcRenderer.send('pet:restore-from-tray');\n  },\n  setInteractive(interactive) {",
    "preload.js"
  );
  writeFileSync(preloadPath, pl, "utf8");
  console.log("[ok] preload.js 托盘最小化");
}

// ---------------- helper：独立缓存目录（不与 DSH 的 helper 抢同一个 Chromium profile） ----------------
{
  const mp = join(appDir, "runtime", "electron-helper", "main.js");
  let mm = readText(mp);
  if (mm.includes("DSH_PET_APP_NAME")) {
    console.log("[skip] helper 独立缓存名已存在");
  } else {
    mm = replaceOnce(
      mm,
      "helper app.setName",
      "app.setName('dsh-pet-electron-helper');",
      "app.setName(process.env.DSH_PET_APP_NAME || 'dsh-pet-electron-helper');",
      "main.js"
    );
    writeFileSync(mp, mm, "utf8");
    console.log("[ok] helper 独立缓存名");
  }
  let st = readText(standalonePath);
  if (st.includes("DSH_PET_APP_NAME")) {
    console.log("[skip] spawn env 已带 DSH_PET_APP_NAME");
  } else {
    st = replaceOnce(
      st,
      "spawn env app name",
      "\t\tDSH_PET_HOST_PID: String(hostPid),",
      '\t\tDSH_PET_HOST_PID: String(hostPid),\n\t\tDSH_PET_APP_NAME: "dsh-pet-standalone-helper",',
      "standalone.js"
    );
    writeFileSync(standalonePath, st, "utf8");
    console.log("[ok] spawn env DSH_PET_APP_NAME");
  }
}

console.log("done");
