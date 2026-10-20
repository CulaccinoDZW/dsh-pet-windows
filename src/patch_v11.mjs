// patch_v11：修复 API Key 路由（读取 apiKey/key、留空不清空）、报时音回退、报时面板尺寸、弹窗关闭按钮
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const app = process.argv[2];
if (!app) { console.error("用法: node patch_v11.mjs <appDir>"); process.exit(1); }
const helper = join(app, "runtime", "electron-helper");
const sp = join(app, "lib", "standalone.js");
const ex = join(helper, "extras.js");

function patch(file, rules) {
  let s = readFileSync(file, "utf8");
  let n = 0;
  for (const [name, from, to] of rules) {
    if (!s.includes(from)) {
      if (s.includes(to)) { console.log(`[skip] ${name}（已应用）`); continue; }
      console.log(`[miss] ${name}`); continue;
    }
    s = s.split(from).join(to);
    n++; console.log(`[ok] ${name}`);
  }
  writeFileSync(file, s, "utf8");
  return n;
}

patch(sp, [
  ["apiKey 兼容",
   `const key = String(pk?.key ?? "").trim();`,
   `const key = String(pk?.apiKey ?? pk?.key ?? "").trim(); const wantClear = pk?.clear === true;`],
  ["留空不清空",
   `doc.apiKey = key;`,
   `if (key || wantClear) doc.apiKey = key;`],
  ["model 可改",
   `if (!doc.model) doc.model = "deepseek-v4.1-flash";`,
   `if (!doc.model) doc.model = "deepseek-v4.1-flash";
				if (pk?.model) { doc.model = String(pk.model).trim() || doc.model; doc.chatModel = doc.model; doc.whisperModel = doc.model; }`],
  ["sfx 回退报时音",
   `const files = listSfxFiles(kind);`,
   `let files = listSfxFiles(kind);
				if (!files.length && kind === "chime") files = listSfxFiles("notify");`],
]);

patch(ex, [
  ["报时尺寸=本体比例",
   `const scale = Math.max(0.45, Math.min(1, Math.min((vb.width - 24) / 300, (vb.height - 24) / 340)));`,
   `const petSize = Number(getComputedStyle(document.documentElement).getPropertyValue("--pet-size").replace("px", "").trim()) || 462;
    const scale = Math.max(0.42, Math.min(0.78, (petSize / 462) * 0.58));`],
]);