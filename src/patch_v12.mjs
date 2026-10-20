// patch_v12：移除「系统通知接管」菜单项与处理分支（只保留 DSH 自身通知）
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const app = process.argv[2];
if (!app) { console.error("用法: node patch_v12.mjs <appDir>"); process.exit(1); }
const sp = join(app, "runtime", "electron-helper", "sprite.js");
let s = readFileSync(sp, "utf8");
const menu = "      { label: '系统通知接管' + (notifyOn ? '（已开）' : '（已关）'), children: [\n        { label: '开启接管', action: 'notify-on' },\n        { label: '关闭接管', action: 'notify-off' },\n      ] },\n";
const handler = "    if (leaf.action === 'notify-on' || leaf.action === 'notify-off') {\n      const on = leaf.action === 'notify-on' ? '1' : '0';\n      fetch(BASE + '/notify/takeover?pet=' + encodeURIComponent(this.pet.id) + '&takeover=' + on, {\n        method: 'POST',\n      }).catch(() => {});\n      return;\n    }\n";
let n = 0;
if (s.includes(menu)) { s = s.replace(menu, ""); n++; console.log("[ok] 移除通知接管菜单"); }
else console.log("[skip] 通知接管菜单（已移除）");
if (s.includes(handler)) { s = s.replace(handler, ""); n++; console.log("[ok] 移除通知接管分支"); }
else console.log("[skip] 通知接管分支（已移除）");
writeFileSync(sp, s, "utf8");