#!/usr/bin/env node
/**
 * patch_v6.mjs —— 「报时 / 待办 / 提示音 / 通知播报」扩展（幂等）。
 *
 * 用法：node patch_v6.mjs <appDir>      例如 node patch_v6.mjs D:\DeepSeek\DSH-pet\app
 * appDir 需包含 lib\standalone.js 与 runtime\electron-helper\{main,preload,index.html}。
 *
 * 共 6 组改动：
 *   1) standalone.js：host 侧提示音目录 / 待办存储 / 调度器（每 5s 检查整点与待办）；
 *   2) standalone.js：新增路由 /sfx、/sfx/file、/todo、/todo/add、/todo/done、/todo/delete、/notify、/anim-file；
 *   3) runtime/electron-helper/main.js：待办全屏提醒浮层窗口（透明、置顶、点击查看详情）；
 *   4) runtime/electron-helper/preload.js：todoReminder / todoOpen / todoClose（供渲染端与浮层调用）；
 *   5) runtime/electron-helper/index.html：加载 extras.js；
 *   6) 复制本目录 ins\extras.js、ins\todo-overlay.html 到 helper 目录。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(process.argv[2] || join(here, '..', 'DSH-Pet-Windows', 'app'));
const helperDir = join(appDir, 'runtime', 'electron-helper');
const standalonePath = join(appDir, 'lib', 'standalone.js');
const mainPath = join(helperDir, 'main.js');
const preloadPath = join(helperDir, 'preload.js');
const indexPath = join(helperDir, 'index.html');

const results = [];
function edit(file, label, fn) {
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) {
    results.push(`[skip] ${label}`);
    return;
  }
  if (after === null) {
    results.push(`[fail] ${label}（锚点未找到）`);
    return;
  }
  writeFileSync(file, after, 'utf8');
  results.push(`[ok]   ${label}`);
}

// ---------------------------------------------------------------- 1) import + host extras
edit(standalonePath, 'standalone.js: node:path 增加 extname 导入', (src) => {
  if (src.includes('import { dirname, join, normalize, resolve, sep, extname }')) return src;
  return src.replace(
    'import { dirname, join, normalize, resolve, sep } from "node:path";',
    'import { dirname, join, normalize, resolve, sep, extname } from "node:path";'
  );
});

const HOST_BLOCK = `\t// ===== DSH-Pet extras（提示音 / 整点报时 / 待办，patch_v6 注入）=====
\tconst extrasState = { chimeKey: "" };
\t// 提示音目录放在**安装根目录**下（<安装目录>\\sounds\\notify 与 \\sounds\\chime），
\t// 可用环境变量 DSH_PET_INSTALL_ROOT 覆盖；PACKAGE_ROOT 是 <安装目录>\\app。
\tconst INSTALL_ROOT = (() => {
\t\tconst envRoot = String(process.env.DSH_PET_INSTALL_ROOT ?? "").trim();
\t\tif (envRoot !== "") return envRoot;
\t\ttry { return dirname(PACKAGE_ROOT); } catch (e) { return PACKAGE_ROOT; }
\t})();
\tconst SFX_KINDS = {
\t\tnotify: join(INSTALL_ROOT, "sounds", "notify"),
\t\tchime: join(INSTALL_ROOT, "sounds", "chime")
\t};
\tconst SFX_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"]);
\tconst SFX_MIME = {
\t\t".mp3": "audio/mpeg",
\t\t".wav": "audio/wav",
\t\t".ogg": "audio/ogg",
\t\t".m4a": "audio/mp4",
\t\t".flac": "audio/flac",
\t\t".aac": "audio/aac"
\t};
\tconst todoFile = join(userRoot, "todos.json");
\tconst ensureSfxDirs = () => {
\t\tfor (const [kind, dir] of Object.entries(SFX_KINDS)) try {
\t\t\tmkdirSync(dir, { recursive: true });
\t\t\tconst readme = join(dir, "说明.txt");
\t\t\tif (!existsSync(readme)) writeFileSync(readme, kind === "chime" ? "把「整点报时」的提示音（mp3 / wav / ogg / m4a / flac）放进这个目录，程序按文件名顺序轮流播放。\\n" : "把「系统通知」的提示音（mp3 / wav / ogg / m4a / flac）放进这个目录，程序按文件名顺序轮流播放。\\n", "utf8");
\t\t} catch (e) {}
\t};
\tconst listSfx = (kind) => {
\t\tconst dir = SFX_KINDS[kind];
\t\tif (!dir) return [];
\t\ttry {
\t\t\treturn readdirSync(dir).filter((n) => SFX_EXTS.has(extname(n).toLowerCase())).sort();
\t\t} catch (e) {
\t\t\treturn [];
\t\t}
\t};
\tconst readTodos = () => {
\t\ttry {
\t\t\tconst doc = JSON.parse(readFileSync(todoFile, "utf8"));
\t\t\treturn doc && Array.isArray(doc.todos) ? doc : { todos: [] };
\t\t} catch (e) {
\t\t\treturn { todos: [] };
\t\t}
\t};
\tconst writeTodos = (doc) => {
\t\ttry {
\t\t\tmkdirSync(userRoot, { recursive: true });
\t\t\twriteFileSync(todoFile, JSON.stringify(doc, null, 2), "utf8");
\t\t} catch (e) {}
\t};
\tconst parseHm = (s) => {
\t\tconst m = /^(\\d{1,2}):(\\d{2})$/.exec(String(s || ""));
\t\tif (!m) return null;
\t\tconst h = Number(m[1]);
\t\tconst mi = Number(m[2]);
\t\treturn h < 24 && mi < 60 ? { h, mi } : null;
\t};
\t/** 下一次触发时间（本地时区） */
\tconst todoNextDue = (t, now) => {
\t\tconst hm = parseHm(t.time) || { h: 9, mi: 0 };
\t\tconst rep = String(t.repeat || "none");
\t\tconst today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hm.h, hm.mi, 0, 0);
\t\tif (rep === "daily") return today.getTime() > now.getTime() ? today : new Date(today.getTime() + 86400000);
\t\tif (rep === "weekly") {
\t\t\tconst want = Number(t.weekday) || 0;
\t\t\tconst d = new Date(today);
\t\t\tfor (let i = 0; i < 8; i += 1) {
\t\t\t\tif (d.getDay() === want && d.getTime() > now.getTime()) return d;
\t\t\t\td.setDate(d.getDate() + 1);
\t\t\t}
\t\t\treturn d;
\t\t}
\t\tif (rep === "monthly") {
\t\t\tconst day = Math.min(Math.max(Number(t.monthday) || 1, 1), 31);
\t\t\tfor (let i = 0; i < 13; i += 1) {
\t\t\t\tconst d = new Date(now.getFullYear(), now.getMonth() + i, day, hm.h, hm.mi, 0, 0);
\t\t\t\tif (d.getDate() === day && d.getTime() > now.getTime()) return d;
\t\t\t}
\t\t\treturn today;
\t\t}
\t\tconst dateStr = String(t.date || "").trim();
\t\tif (!dateStr) return today;
\t\treturn new Date(dateStr + "T" + String(hm.h).padStart(2, "0") + ":" + String(hm.mi).padStart(2, "0") + ":00");
\t};
\tensureSfxDirs();
\tconst extrasTimer = setInterval(() => {
\t\ttry {
\t\t\tconst now = new Date();
\t\t\tconst mi = now.getMinutes();
\t\t\tif ((mi === 0 || mi === 30) && now.getSeconds() <= 30) {
\t\t\t\tconst key = now.getFullYear() + "-" + (now.getMonth() + 1) + "-" + now.getDate() + "-" + now.getHours() + "-" + mi;
\t\t\t\tif (extrasState.chimeKey !== key) {
\t\t\t\t\textrasState.chimeKey = key;
\t\t\t\t\tstate.writeSection("chime", { key, text: String(now.getHours()).padStart(2, "0") + ":" + (mi === 0 ? "00" : "30") });
\t\t\t\t}
\t\t\t}
\t\t\tconst doc = readTodos();
\t\t\tlet changed = false;
\t\t\tfor (const t of doc.todos) {
\t\t\t\tif (!t || t.done) continue;
\t\t\t\tconst due = todoNextDue(t, now);
\t\t\t\tif (!(due instanceof Date) || Number.isNaN(due.getTime())) continue;
\t\t\t\tconst delta = now.getTime() - due.getTime();
\t\t\t\tif (delta < 0 || delta > 20000) continue;
\t\t\t\tconst dueKey = String(due.getTime());
\t\t\t\tif (t.lastFiredKey === dueKey) continue;
\t\t\t\tt.lastFiredKey = dueKey;
\t\t\t\tt.lastFiredAt = now.toISOString();
\t\t\t\tchanged = true;
\t\t\t\tstate.writeSection("todoReminder", { id: t.id, title: t.title, detail: t.detail || "", anim: "抽陀螺", ts: Date.now() });
\t\t\t\tctx.logger?.info?.("[dsh-pet] 待办提醒：" + t.title);
\t\t\t}
\t\t\tif (changed) writeTodos(doc);
\t\t} catch (e) {
\t\t\tctx.logger?.warn?.("[dsh-pet] 报时/待办调度异常：" + (e instanceof Error ? e.message : String(e)));
\t\t}
\t}, 5000);
\textrasTimer.unref?.();
\tctx.effect(() => () => clearInterval(extrasTimer));
`;

edit(standalonePath, 'standalone.js: host extras（提示音 / 报时 / 待办调度）', (src) => {
  if (src.includes('DSH-Pet extras（提示音 / 整点报时 / 待办')) return src;
  const anchor = '\tconst handlePetRoute = async (rawUrl, method, body) => {';
  if (!src.includes(anchor)) return null;
  return src.replace(anchor, HOST_BLOCK + anchor);
});

// ---------------------------------------------------------------- 2) routes
const ROUTES_BLOCK = `\t\t// ===== extras 路由（提示音 / 待办 / 外部通知 / 动画文件，patch_v6）=====
\t\tif (rest === "sfx") {
\t\t\tif (method !== "GET") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
\t\t\tconst kind = String(url.searchParams.get("kind") || "chime");
\t\t\treturn { kind: "json", status: 200, obj: { ok: true, kind, files: listSfx(kind) } };
\t\t}
\t\tif (rest === "sfx/file") {
\t\t\tif (method !== "GET") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
\t\t\tconst kind = String(url.searchParams.get("kind") || "chime");
\t\t\tconst dir = SFX_KINDS[kind];
\t\t\tconst name = String(url.searchParams.get("name") || "").replace(/[\\\\/]/g, "");
\t\t\tconst file = dir && name ? join(dir, name) : "";
\t\t\tif (!file || !existsSync(file)) return { kind: "json", status: 404, obj: { error: "not found" } };
\t\t\treturn { kind: "file", file, contentType: SFX_MIME[extname(file).toLowerCase()] || "application/octet-stream" };
\t\t}
\t\tif (rest === "anim-file") {
\t\t\tif (method !== "GET") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
\t\t\tconst name = String(url.searchParams.get("name") || "").replace(/[\\\\/]/g, "");
\t\t\tconst ext = String(url.searchParams.get("ext") || ".webm");
\t\t\tif (!name) return { kind: "json", status: 404, obj: { error: "not found" } };
\t\t\tconst roots = [join(PACKAGE_ROOT, "assets", "webm"), join(PACKAGE_ROOT, "assets", "mov")];
\t\t\tfor (const root of roots) {
\t\t\t\tconst candidate = join(root, name + ext);
\t\t\t\tif (existsSync(candidate)) return { kind: "file", file: candidate, contentType: ext === ".mov" ? "video/quicktime" : "video/webm" };
\t\t\t}
\t\t\treturn { kind: "json", status: 404, obj: { error: "animation not found", name } };
\t\t}
\t\tif (rest === "notify") {
\t\t\tif (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
\t\t\tlet parsed = null;
\t\t\ttry { parsed = JSON.parse(body || "null"); } catch (e) { parsed = null; }
\t\t\tconst app = String(parsed?.app || "系统");
\t\t\tconst title = String(parsed?.title || "").trim();
\t\t\tconst text = String(parsed?.body || "").trim();
\t\t\tconst line = (app ? "【" + app + "】" : "") + (title || text || "收到一条通知");
\t\t\tstate.writeSection("extNotify", { app, title, text, ts: Date.now(), text: line });
\t\t\treturn { kind: "json", status: 200, obj: { ok: true } };
\t\t}
\t\tif (rest === "todo") {
\t\t\tif (method !== "GET") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
\t\t\treturn { kind: "json", status: 200, obj: { ok: true, todos: readTodos().todos } };
\t\t}
\t\tif (rest === "todo/add") {
\t\t\tif (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
\t\t\tlet parsed = null;
\t\t\ttry { parsed = JSON.parse(body || "null"); } catch (e) { parsed = null; }
\t\t\tconst title = String(parsed?.title || "").trim();
\t\t\tif (!title) return { kind: "json", status: 400, obj: { ok: false, message: "标题不能为空" } };
\t\t\tconst doc = readTodos();
\t\t\tconst item = {
\t\t\t\tid: "td_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
\t\t\t\ttitle: title.slice(0, 120),
\t\t\t\tdetail: String(parsed?.detail || "").slice(0, 2000),
\t\t\t\tdate: String(parsed?.date || ""),
\t\t\t\ttime: parseHm(parsed?.time) ? String(parsed.time) : "09:00",
\t\t\t\trepeat: ["none", "daily", "weekly", "monthly"].includes(String(parsed?.repeat)) ? String(parsed.repeat) : "none",
\t\t\t\tweekday: Math.min(Math.max(Number(parsed?.weekday) || 0, 0), 6),
\t\t\t\tmonthday: Math.min(Math.max(Number(parsed?.monthday) || 1, 1), 31),
\t\t\t\tdone: false,
\t\t\t\tcreatedAt: new Date().toISOString()
\t\t\t};
\t\t\tdoc.todos.push(item);
\t\t\twriteTodos(doc);
\t\t\treturn { kind: "json", status: 200, obj: { ok: true, todo: item, todos: doc.todos } };
\t\t}
\t\tif (rest === "todo/done" || rest === "todo/delete") {
\t\t\tif (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
\t\t\tlet parsed = null;
\t\t\ttry { parsed = JSON.parse(body || "null"); } catch (e) { parsed = null; }
\t\t\tconst id = String(parsed?.id || "");
\t\t\tconst doc = readTodos();
\t\t\tif (rest === "todo/done") for (const t of doc.todos) if (t.id === id) t.done = true;
\t\t\telse doc.todos = doc.todos.filter((t) => t.id !== id);
\t\t\twriteTodos(doc);
\t\t\treturn { kind: "json", status: 200, obj: { ok: true, todos: doc.todos } };
\t\t}
`;
edit(standalonePath, 'standalone.js: extras 路由（sfx / anim-file / notify / todo）', (src) => {
  if (src.includes('extras 路由（提示音')) return src;
  const anchor = '\t\tif (rest === "quit" || rest === "exit") {';
  if (!src.includes(anchor)) return null;
  return src.replace(anchor, ROUTES_BLOCK + anchor);
});

// ---------------------------------------------------------------- 3) main.js overlay
const MAIN_BLOCK = `
// ===== DSH-Pet extras：待办全屏提醒浮层（patch_v6 注入）=====
let todoOverlay = null;
function closeTodoOverlay() {
  if (todoOverlay && !todoOverlay.isDestroyed()) todoOverlay.close();
  todoOverlay = null;
}
function showTodoOverlay(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  closeTodoOverlay();
  const display = screen.getPrimaryDisplay();
  const b = display.bounds;
  const configUrl = process.env.DSH_PET_CONFIG_URL || '';
  // 浮层页面里用相对路径 /anim-file（同源 = 宿主服务），所以这里补上 origin 供 base href 使用
  let origin = '';
  try {
    if (configUrl) origin = new URL(configUrl).origin;
  } catch (err) {
    origin = '';
  }
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const qs = new URLSearchParams({
    id: String(data.id == null ? '' : data.id),
    title: String(data.title || '待办提醒'),
    anim: String(data.anim || '抽陀螺'),
    base: origin,
  });
  win.loadFile(path.join(__dirname, 'todo-overlay.html'), { query: Object.fromEntries(qs) });
  win.once('ready-to-show', () => {
    win.showInactive();
    win.focus();
  });
  win.on('closed', () => {
    if (todoOverlay === win) todoOverlay = null;
  });
  todoOverlay = win;
  return win;
}
ipcMain.on('pet:todo-reminder', (event, payload) => {
  try {
    showTodoOverlay(payload);
  } catch (err) {
    console.error('[dsh-pet] 待办浮层创建失败：', err);
  }
});
ipcMain.on('todo:open', (event, id) => {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.webContents.send('pet:todo-open', String(id == null ? '' : id));
  }
  closeTodoOverlay();
});
ipcMain.on('todo:close', () => closeTodoOverlay());
`;
edit(mainPath, 'main.js: 待办全屏浮层 + IPC', (src) => {
  if (src.includes('DSH-Pet extras：待办全屏提醒浮层')) return src;
  return src.replace(/\s*$/, '\n') + MAIN_BLOCK;
});

// ---------------------------------------------------------------- 4) preload
const PRELOAD_BLOCK = `  // ---- DSH-Pet extras（待办 / 报时，patch_v6）----
  todoReminder(payload) {
    ipcRenderer.send('pet:todo-reminder', payload || {});
  },
  onTodoOpen(cb) {
    ipcRenderer.on('pet:todo-open', (e, id) => cb(id));
  },
  todoOpen(id) {
    ipcRenderer.send('todo:open', id == null ? '' : String(id));
  },
  todoClose() {
    ipcRenderer.send('todo:close');
  },
`;
edit(preloadPath, 'preload.js: todoReminder / onTodoOpen / todoOpen / todoClose', (src) => {
  if (src.includes('todoReminder')) return src;
  const anchor = "  onDisplays(cb) {\n    ipcRenderer.on('pet:displays', (e, geo) => cb(geo));\n  },\n";
  if (!src.includes(anchor)) return null;
  return src.replace(anchor, anchor + PRELOAD_BLOCK);
});

// ---------------------------------------------------------------- 5) index.html
edit(indexPath, 'index.html: 加载 extras.js', (src) => {
  if (src.includes('./extras.js')) return src;
  const anchor = '<script src="./renderer.js"></script>';
  if (!src.includes(anchor)) return null;
  return src.replace(anchor, anchor + '\n<script src="./extras.js"></script>');
});

// ---------------------------------------------------------------- 7) sprite.js 菜单
const spritePath = join(helperDir, 'sprite.js');
edit(spritePath, 'sprite.js: 菜单加「待办」子菜单', (src) => {
  if (src.includes("label: '待办'")) return src;
  const anchor = "      { label: '清空对话记忆', action: 'chat-clear' },\n";
  if (!src.includes(anchor)) return null;
  const block =
    "      { label: '待办', children: [\n" +
    "        { label: '添加待办…', action: 'todo-add' },\n" +
    "        { label: '待办列表', action: 'todo-list' },\n" +
    "        { label: '清理已完成', action: 'todo-clear-done' },\n" +
    "      ] },\n";
  return src.replace(anchor, anchor + block);
});
edit(spritePath, 'sprite.js: onMenuAction 加待办分支', (src) => {
  if (src.includes("leaf.action === 'todo-add'")) return src;
  const anchor = '  onMenuAction(leaf) {\n    this.closeMenu();\n';
  if (!src.includes(anchor)) return null;
  const block =
    "    if (leaf.action === 'todo-add') {\n" +
    "      if (window.__dshPetExtras) window.__dshPetExtras.openTodoAdd();\n" +
    "      return;\n" +
    "    }\n" +
    "    if (leaf.action === 'todo-list') {\n" +
    "      if (window.__dshPetExtras) window.__dshPetExtras.openTodoList();\n" +
    "      return;\n" +
    "    }\n" +
    "    if (leaf.action === 'todo-clear-done') {\n" +
    "      if (window.__dshPetExtras) window.__dshPetExtras.clearDone();\n" +
    "      return;\n" +
    "    }\n";
  return src.replace(anchor, anchor + block);
});

// ---------------------------------------------------------------- 6) 复制新文件
for (const name of ['extras.js', 'todo-overlay.html']) {
  const from = join(here, 'ins', name);
  const to = join(helperDir, name);
  if (!existsSync(from)) {
    results.push(`[fail] 缺少源文件 ins/${name}`);
    continue;
  }
  copyFileSync(from, to);
  results.push(`[ok]   复制 ${name} → runtime/electron-helper/`);
}

for (const line of results) console.log(line);
const failed = results.filter((r) => r.startsWith('[fail]'));
if (failed.length) {
  console.error('\n有 ' + failed.length + ' 项失败');
  process.exitCode = 1;
}
