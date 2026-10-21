// patch_v17.mjs —— 双保险：余额不可用（unsupported/silent）时右键菜单也不显示「查看余额」
// 用法：node patch_v17.mjs <appDir>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const appDir = process.argv[2];
if (!appDir) {
  console.error("用法: node patch_v17.mjs <appDir>");
  process.exit(1);
}

function edit(rel, fn) {
  const p = join(appDir, rel);
  if (!existsSync(p)) {
    console.error("!! 找不到 " + p);
    process.exit(1);
  }
  const src = readFileSync(p, "utf8");
  const out = fn(src);
  if (out === src) {
    console.log("[skip] " + rel);
    return;
  }
  writeFileSync(p, out, "utf8");
  console.log("[ok] " + rel);
}

// events.js：把「余额叶子不可用」记到 debug 上，供菜单判断
edit(join("runtime", "electron-helper", "events.js"), (s) => {
  if (s.includes("balance-belt-v17")) return s;
  const anchor = "  window.__dshPetDebug.lastBalanceOk = hit.state && hit.state.ok === true;";
  if (!s.includes(anchor)) {
    console.error("!! events.js 锚点未命中");
    process.exit(1);
  }
  return s.replace(
    anchor,
    anchor +
      "\n  // balance-belt-v17：余额不可用（服务商不支持 / 静默）时，菜单里也不显示「查看余额」" +
      "\n  window.__dshPetDebug.balanceUnsupported = !!(hit.state && (hit.state.silent === true || hit.state.reason === \"unsupported\"));"
  );
});

// sprite.js：菜单条件加第二道判断
edit(join("runtime", "electron-helper", "sprite.js"), (s) => {
  if (s.includes("balance-belt-v17")) return s;
  const anchor =
    "    if (bridgeOnline && this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });";
  if (!s.includes(anchor)) {
    console.error("!! sprite.js 锚点未命中");
    process.exit(1);
  }
  const repl =
    "    // balance-belt-v17：除了「桥接在线」，还要余额叶子本身可用（避免 DSH 刚退出时菜单残留）" +
    "\n    const balanceUnsupported = !!(window.__dshPetDebug && window.__dshPetDebug.balanceUnsupported);" +
    "\n    if (bridgeOnline && !balanceUnsupported && this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });";
  return s.replace(anchor, repl);
});

console.log("[done] patch_v17");
