// patch_v14：API Key 保存后立即生效（每次请求前重读 ai-config.json）+ 更准确的报错文案
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const appDir = process.argv[2];
if (!appDir) { console.error("用法: node patch_v14.mjs <appDir>"); process.exit(1); }
const file = join(appDir, "lib", "standalone.js");
if (!existsSync(file)) { console.error("找不到 " + file); process.exit(1); }

let s = readFileSync(file, "utf8");
const before = s;

// 1) 每次 llm.stream 都直读配置文件（填完 Key 立刻能用，无需重启）
s = s.replace(
  "\t\t\tstream: (streamOptions) => streamPetAiChat(ai, streamOptions)",
  "\t\t\tstream: (streamOptions) => streamPetAiChat(loadPetAiConfig(logger), streamOptions)"
);

// 3) 报错文案：指向右键菜单（不再提环境变量）
s = s.replace(
  '"缺少 DeepSeek API Key：请在 " + petAiConfigPath() + " 里填 apiKey，或设置环境变量 DEEPSEEK_API_KEY"',
  '"缺少 DeepSeek API Key：请在右键菜单「API Key…」里填写（保存后立即生效），或编辑 " + petAiConfigPath() + " 后重试"'
);

if (!s.includes("streamPetAiChat(loadPetAiConfig(logger)")) {
  console.error("!! patch_v14 关键替换未生效（stream 未改为直读）");
  process.exit(2);
}
if (s === before) {
  console.log("[skip] patch_v14 已应用过");
} else {
  writeFileSync(file, s, "utf8");
  console.log("[ok] patch_v14：API Key 保存后立即生效（每次请求重读 ai-config.json）");
}
