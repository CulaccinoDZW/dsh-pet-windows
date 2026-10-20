// 给独立版打补丁：AI 直连 + DSH 桥接 + 右键菜单改造（幂等：已打过则跳过）
// 用法: node patch_v3.mjs <app 目录>   例: node patch_v3.mjs "D:\DeepSeek\DSH-pet\app"
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = process.argv[2];
if (!appDir) {
  console.error("用法: node patch_v3.mjs <app 目录>");
  process.exit(2);
}
const standalonePath = join(appDir, "lib", "standalone.js");
const spritePath = join(appDir, "runtime", "electron-helper", "sprite.js");
const MARK = "src/standalone/pet-ai.ts（DSH-Pet-Windows 追加";

function readText(p) {
  return readFileSync(p, "utf8");
}
function applyRule(src, label, regex, replacement, file) {
  const hits = src.match(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g"));
  const count = hits ? hits.length : 0;
  if (count !== 1) {
    throw new Error(`[${file}] 规则「${label}」命中 ${count} 次（应为 1 次）——补丁可能已打或源码版本不符`);
  }
  return src.replace(regex, () => replacement);
}

// ---------- standalone.js ----------
let s = readText(standalonePath);
if (s.includes(MARK)) {
  console.log("[skip] standalone.js 已打过 AI/桥接补丁");
} else {
  const petAi = readText(join(here, "ins", "pet-ai.js"));
  const importAnchor = /import \{ createServer \} from "node:http";\n/;
  s = applyRule(s, "import 之后插入 pet-ai 模块", importAnchor, `import { createServer } from "node:http";\n\n${petAi}`, "standalone.js");

  s = applyRule(
    s,
    "ctx 默认模型",
    /agentDefaultModel: \{ currentSelection: \(\) => \(\{\n\t\t\tprovider: STANDALONE_PROVIDER,\n\t\t\tmodel: ""\n\t\t\}\) \},/,
    `agentDefaultModel: { currentSelection: () => ({\n\t\t\tprovider: STANDALONE_PROVIDER,\n\t\t\tmodel: ai.model\n\t\t}) },`,
    "standalone.js"
  );
  // 凭证保持原样（独立模式不需要；避免余额刷新去打 api.deepseek.com）
  s = applyRule(
    s,
    "ctx llm",
    /llm: \{\n\t\t\tlistProviders: \(\) => \[\],\n\t\t\tlistModels: async \(\) => \[\],\n\t\t\tresolveModelInfo: async \(\) => void 0,\n\t\t\tstream: \(\) => \(\{ \[Symbol\.asyncIterator\]\(\) \{\n\t\t\t\treturn \{ next: async \(\) => \{\n\t\t\t\t\tthrow new Error\("dsh-pet standalone: 独立模式未接入模型（碎碎念\/对话不可用）"\);\n\t\t\t\t\} \};\n\t\t\t\} \}\)\n\t\t\}/,
    `llm: {\n\t\t\tlistProviders: () => [],\n\t\t\tlistModels: async () => PET_AI_MODEL_IDS.slice(),\n\t\t\tresolveModelInfo: async () => void 0,\n\t\t\tstream: (streamOptions) => streamPetAiChat(ai, streamOptions)\n\t\t}`,
    "standalone.js"
  );
  s = applyRule(
    s,
    "createStandaloneContext 注入 ai",
    /function createStandaloneContext\(options\) \{\n\tconst \{ logger \} = options;/,
    `function createStandaloneContext(options) {\n\tconst { logger } = options;\n\tconst ai = options.ai ?? {\n\t\tbaseURL: PET_AI_DEFAULT_BASE_URL,\n\t\tmodel: PET_AI_DEFAULT_MODEL,\n\t\tapiKey: ""\n\t};`,
    "standalone.js"
  );
  s = applyRule(
    s,
    "run() 读 ai 配置",
    /\tconst context = createStandaloneContext\(\{\n\t\tport: \(\) => portRef\.value,\n\t\tlogger,\n\t\troutes\n\t\}\);/,
    `\tconst ai = loadPetAiConfig(logger);\n\tconst context = createStandaloneContext({\n\t\tport: () => portRef.value,\n\t\tlogger,\n\t\troutes,\n\t\tai\n\t});`,
    "standalone.js"
  );
  s = applyRule(
    s,
    "run() 暴露 requestShutdown",
    /\tforwardShutdown = \(\) => requestShutdown\("POST \/shutdown"\);/,
    `\tforwardShutdown = () => requestShutdown("POST /shutdown");\n\tcontext.ctx.__pet = {\n\t\trequestShutdown,\n\t\tai\n\t};`,
    "standalone.js"
  );
  s = applyRule(
    s,
    "路由：/quit",
    /\t\tconst rest = decodeURIComponent\(url\.pathname\.slice\(ROUTE_PREFIX\.length \+ 1\)\);/,
    `\t\tconst rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));\n\t\tif (rest === "quit" || rest === "exit") {\n\t\t\tif (method !== "POST") return {\n\t\t\t\tkind: "json",\n\t\t\t\tstatus: 405,\n\t\t\t\tobj: { error: "method not allowed" }\n\t\t\t};\n\t\t\tconst shutdown = ctx.__pet && typeof ctx.__pet.requestShutdown === "function" ? ctx.__pet.requestShutdown : void 0;\n\t\t\tif (typeof shutdown === "function") setTimeout(() => shutdown("POST /quit"), 150);\n\t\t\treturn {\n\t\t\t\tkind: "json",\n\t\t\t\tstatus: 200,\n\t\t\t\tobj: { ok: true, quitting: true }\n\t\t\t};\n\t\t}`,
    "standalone.js"
  );
  s = applyRule(
    s,
    "路由：/chat 转发 DSH",
    /\t\t\t\t\tconst parsed = JSON\.parse\(body \?\? "null"\) \?\? \{\};/,
    `\t\t\t\t\tif (dshBridge.online) {\n\t\t\t\t\t\tconst forwarded = await dshBridge.forwardJson("/chat" + url.search, {\n\t\t\t\t\t\t\tmethod: "POST",\n\t\t\t\t\t\t\tbody\n\t\t\t\t\t\t});\n\t\t\t\t\t\tif (forwarded !== void 0) return {\n\t\t\t\t\t\t\tkind: "json",\n\t\t\t\t\t\t\tstatus: 200,\n\t\t\t\t\t\t\tobj: forwarded\n\t\t\t\t\t\t};\n\t\t\t\t\t}\n\t\t\t\t\tconst parsed = JSON.parse(body ?? "null") ?? {};`,
    "standalone.js"
  );
  s = applyRule(
    s,
    "路由：/whisper 转发 DSH",
    /\t\t\tconst petId\$1 = String\(url\.searchParams\.get\("pet"\) \?\? ""\);\n\t\t\ttry \{\n\t\t\t\tconst ok = await publishWhisper\(petId\$1\);/,
    `\t\t\tconst petId$1 = String(url.searchParams.get("pet") ?? "");\n\t\t\tif (dshBridge.online) {\n\t\t\t\tconst forwarded = await dshBridge.forwardJson("/whisper" + url.search, {\n\t\t\t\t\tmethod: "POST",\n\t\t\t\t\tbody\n\t\t\t\t});\n\t\t\t\tif (forwarded !== void 0) return {\n\t\t\t\t\tkind: "json",\n\t\t\t\t\tstatus: 200,\n\t\t\t\t\tobj: forwarded\n\t\t\t\t};\n\t\t\t}\n\t\t\ttry {\n\t\t\t\tconst ok = await publishWhisper(petId$1);`,
    "standalone.js"
  );
  s = applyRule(
    s,
    "路由：/balance 转发 DSH",
    /\t\t\tawait refreshBalance\(true\);/,
    `\t\t\tif (dshBridge.online) {\n\t\t\t\tawait dshBridge.forwardJson("/balance" + url.search, {\n\t\t\t\t\tmethod: "POST",\n\t\t\t\t\tbody\n\t\t\t\t});\n\t\t\t\treturn {\n\t\t\t\t\tkind: "json",\n\t\t\t\t\tstatus: 200,\n\t\t\t\t\tobj: { ok: true }\n\t\t\t\t};\n\t\t\t}\n\t\t\tawait refreshBalance(true);`,
    "standalone.js"
  );
  s = applyRule(
    s,
    "路由：/chat/clear",
    /\t\tconst \[scope, \.\.\.restParts\] = rest\.split\("\/"\);/,
    `\t\tif (rest === "chat/clear") {\n\t\t\tif (method !== "POST") return {\n\t\t\t\tkind: "json",\n\t\t\t\tstatus: 405,\n\t\t\t\tobj: { error: "method not allowed" }\n\t\t\t};\n\t\t\tconst petId$clear = String(url.searchParams.get("pet") ?? "");\n\t\t\tconst cfgClear = readAllConfig(configPaths);\n\t\t\tconst foundClear = findPetInstance(cfgClear, petId$clear);\n\t\t\tconst bucketKeyClear = foundClear?.entry ?? petId$clear;\n\t\t\ttry {\n\t\t\t\tawait withMemoryLock(async () => {\n\t\t\t\t\tconst current = await readMemory();\n\t\t\t\t\tconst bucket = current[bucketKeyClear];\n\t\t\t\t\tif (bucket && bucket[petId$clear]) bucket[petId$clear].messages = [];\n\t\t\t\t\tawait writeMemory(current);\n\t\t\t\t});\n\t\t\t\tstate.writePet(petId$clear, "say", { text: "对话记忆已经清空啦～" });\n\t\t\t\treturn {\n\t\t\t\t\tkind: "json",\n\t\t\t\t\tstatus: 200,\n\t\t\t\t\tobj: { ok: true, cleared: true, pet: petId$clear }\n\t\t\t\t};\n\t\t\t} catch (e) {\n\t\t\t\treturn {\n\t\t\t\t\tkind: "json",\n\t\t\t\t\tstatus: 200,\n\t\t\t\t\tobj: { ok: false, message: e instanceof Error ? e.message : String(e) }\n\t\t\t\t};\n\t\t\t}\n\t\t}\n\t\tconst [scope, ...restParts] = rest.split("/");`,
    "standalone.js"
  );
  s = applyRule(
    s,
    "启动 DSH 桥接",
    /\tconst state = new PollStateStore\(\);/,
    `\tconst state = new PollStateStore();\n\tconst dshBridge = createDshBridge({\n\t\tlogger: ctx.logger,\n\t\tstate,\n\t\tintervalMs: 2500\n\t});\n\ttry {\n\t\tdshBridge.start();\n\t} catch (e) {\n\t\tctx.logger?.warn?.(\`[dsh-pet] DSH 桥接启动失败：\${e instanceof Error ? e.message : String(e)}\`);\n\t}\n\tctx.effect(() => () => dshBridge.stop());`,
    "standalone.js"
  );
  writeFileSync(standalonePath, s, "utf8");
  console.log("[ok] standalone.js 已打补丁");
}

// ---------- standalone.js：display=none 时仍显示桌面小窗 ----------
// 背景：DSH 与独立版共用 main-config.jsonc，DSH 侧切换会把 display 写成 none，
// 导致独立版双击后“没有宠物”。独立版场景下把 none 视为 desktop。
{
  let s2 = readText(standalonePath);
  const anchor = 'const isDesktopVisible$1 = (display) => display === "desktop" || display === "both";';
  const anchor2 = 'return display === "desktop" || display === "both";';
  if (s2.includes('display === "none"')) {
    console.log("[skip] display=none 兜底已存在");
  } else {
    if (!s2.includes(anchor)) throw new Error("[standalone.js] 找不到 isDesktopVisible$1 锚点");
    s2 = s2.replace(anchor, 'const isDesktopVisible$1 = (display) => display === "desktop" || display === "both" || display === "none";');
    if (s2.includes(anchor2)) {
      s2 = s2.replace(anchor2, 'return display === "desktop" || display === "both" || display === "none";');
    }
    writeFileSync(standalonePath, s2, "utf8");
    console.log("[ok] standalone.js 已加 display=none 兜底");
  }
}

// ---------- sprite.js ----------
let sp = readText(spritePath);
if (sp.includes("action: 'quit'")) {
  console.log("[skip] sprite.js 已改过右键菜单");
} else {
  sp = applyRule(
    sp,
    "sprite: 工具项数组初始化",
    /    const tools = \[\{ label: OPEN_TARGET === 'desktop' \? '打开 DeepSeek Harness' : '打开网站', action: 'open-site' \}\];/,
    `    const tools = [];`,
    "sprite.js"
  );
  sp = applyRule(
    sp,
    "sprite: 删查看余额",
    /\n    if \(this\.pet\.balanceEnabled\) tools\.push\(\{ label: '查看余额', action: 'show-balance' \}\);/,
    "",
    "sprite.js"
  );
  sp = applyRule(
    sp,
    "sprite: 工具项列表",
    /    tools\.push\(\n      \{ label: '碎碎念', action: 'whisper' \},\n      \{ label: '对话', action: 'chat' \},\n      \{ label: '回到初始位置', action: 'home' \},[\s\S]*?      \{ label: '重载配置', action: 'reload' \},\n    \);/,
    `    tools.push(
      { label: '碎碎念', action: 'whisper' },
      { label: '对话', action: 'chat' },
      { label: '清空对话记忆', action: 'chat-clear' },
      { label: '重载配置', action: 'reload' },
      { label: '退出', action: 'quit' },
    );`,
    "sprite.js"
  );
  sp = applyRule(
    sp,
    "sprite: 删打开网站分支",
    /    if \(leaf\.action === 'open-site'\) \{[\s\S]*?\n    \}\n/,
    "",
    "sprite.js"
  );
  sp = applyRule(
    sp,
    "sprite: 删查看余额分支",
    /    if \(leaf\.action === 'show-balance'\) \{[\s\S]*?\n    \}\n/,
    "",
    "sprite.js"
  );
  sp = applyRule(
    sp,
    "sprite: 回到初始位置 → 退出/清空记忆",
    /    if \(leaf\.action === 'home'\) \{[\s\S]*?\n    \}\n/,
    `    if (leaf.action === 'chat-clear') {
      fetch(BASE + '/chat/clear?pet=' + encodeURIComponent(this.pet.id), { method: 'POST' }).catch(() => {});
      return;
    }
    if (leaf.action === 'quit') {
      fetch(BASE + '/quit', { method: 'POST' }).catch(() => {});
      return;
    }
`,
    "sprite.js"
  );
  writeFileSync(spritePath, sp, "utf8");
  console.log("[ok] sprite.js 已改右键菜单");
}
// ---------- 渲染端 shared-core.js：display=none 时仍按桌面可见处理 ----------
{
  const corePath = join(appDir, "runtime", "electron-helper", "shared-core.js");
  let core = readText(corePath);
  const coreAnchor = 'const isDesktopVisible = (display) => display === "desktop" || display === "both";';
  if (core.includes('const isDesktopVisible = (display) => display === "desktop" || display === "both" || display === "none";')) {
    console.log("[skip] shared-core.js display=none 兜底已存在");
  } else {
    if (!core.includes(coreAnchor)) throw new Error("[shared-core.js] 找不到 isDesktopVisible 锚点");
    core = core.replace(coreAnchor, 'const isDesktopVisible = (display) => display === "desktop" || display === "both" || display === "none";');
    writeFileSync(corePath, core, "utf8");
    console.log("[ok] shared-core.js 已加 display=none 兜底");
  }
}

console.log("done");
