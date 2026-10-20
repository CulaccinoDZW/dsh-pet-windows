// patch_v13：①对话/碎碎念经 DSH 转发失败时回落到本地 API ②返回里标注走的是哪条路（via）
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const appDir = process.argv[2];
if (!appDir) { console.error("用法: node patch_v13.mjs <appDir>"); process.exit(1); }
const file = join(appDir, "lib", "standalone.js");
if (!existsSync(file)) { console.error("找不到 " + file); process.exit(1); }

let s = readFileSync(file, "utf8");
const before = s;

// ① 转发失败（ok:false）不再直接返回，而是continue走到本地 API
s = s.split("forwarded !== void 0) return").join("forwarded !== void 0 && forwarded.ok !== false) return");

// ② 标注来源
s = s.split('obj: forwarded').join('obj: { ...forwarded, via: "dsh" }');
s = s.replace(
  /(const result = await chatWithPet\(petId\$1, text\);\s*\n\s*return \{\s*\n\s*kind: "json",\s*\n\s*status: 200,\s*\n\s*)obj: result/,
  '$1obj: { ...result, via: "local" }'
);
if (!/via: "dsh"/.test(s) || !/via: "local"/.test(s)) {
  console.error("!! patch_v13 关键替换没生效（via 标记缺失）");
  process.exit(2);
}
if (s === before) {
  console.log("[skip] patch_v13 已应用过");
} else {
  writeFileSync(file, s, "utf8");
  console.log("[ok] patch_v13：DSH 转发失败回落本地 API + via 标记");
}