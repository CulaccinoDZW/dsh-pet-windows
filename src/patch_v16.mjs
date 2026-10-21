// patch_v16.mjs —— 断开 DSH 后：隐藏「查看余额」并彻底不再弹「服务商不支持余额查询」
// 用「定位 + 切片」的方式改，避免中文/缩进锚点失配。
// 用法：node patch_v16.mjs <appDir>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const appDir = process.argv[2];
if (!appDir) {
  console.error("用法: node patch_v16.mjs <appDir>");
  process.exit(1);
}

function read(rel) {
  const p = join(appDir, rel);
  if (!existsSync(p)) {
    console.error("!! 找不到 " + p);
    process.exit(1);
  }
  return { p, s: readFileSync(p, "utf8") };
}

/* ---------------- 1) standalone.js ---------------- */
{
  const { p, s } = read(join("lib", "standalone.js"));
  if (s.includes("bridge-offline-v16")) {
    console.log("[skip] lib/standalone.js");
  } else {
    let out = s;

    // 1.1 失败分支：在原有 balance 写入前补一个 bridge offline，并给 balance 加 silent
    const FALLBACK_MARK = 'reason: "unsupported"';
    const catchIdx = out.indexOf("bridge.port = 0;");
    if (catchIdx < 0) {
      console.error("!! standalone.js 找不到 bridge.port = 0;");
      process.exit(1);
    }
    const balIdx = out.indexOf(FALLBACK_MARK, catchIdx);
    const writeSectionIdx = out.lastIndexOf("state.writeSection(\"balance\"", balIdx);
    if (balIdx < 0 || writeSectionIdx < 0) {
      console.error("!! standalone.js 找不到失败分支里的 balance 写入");
      process.exit(1);
    }
    // 在 state.writeSection("balance" 之前插 bridge offline
    const bridgeWrite = `state.writeSection("bridge", {
						online: false,
						port: 0,
						notifyTakeover: readNotifyTakeoverFlag()
					});
					// bridge-offline-v16：必须写 online:false，否则「查看余额」会留在右键菜单里
					`;
    out = out.slice(0, writeSectionIdx) + bridgeWrite + out.slice(writeSectionIdx);
    // 给这条 balance 加 silent: true（重新定位，因为上面插了内容）
    const balIdx2 = out.indexOf(FALLBACK_MARK, catchIdx);
    out = out.slice(0, balIdx2) + 'reason: "unsupported",\n\t\t\t\t\t\tsilent: true' + out.slice(balIdx2 + FALLBACK_MARK.length);

    // 1.2 端口消失（DSH 整个退出）分支：原来什么都不写 → 补一段 else if
    const tickIdx = out.indexOf("async tick() {");
    if (tickIdx < 0) {
      console.error("!! standalone.js 找不到 tick()");
      process.exit(1);
    }
    const nextBlock = out.indexOf("if (!bridge.stopped) {", tickIdx);
    if (nextBlock < 0) {
      console.error("!! standalone.js 找不到 tick 里的收尾块");
      process.exit(1);
    }
    const elseIf = `} else if (bridge.online) {
				// bridge-offline-v16：DSH 进程整个退出、netstat 找不到端口时，原来什么都不写，
				// 于是 bridge.online 永远为 true，「查看余额」就一直挂在菜单上
				logger?.info?.("[dsh-pet] 本地 DSH 已退出（端口消失），独立版切回直连 API");
				bridge.online = false;
				bridge.port = 0;
				state.writeSection("bridge", {
					online: false,
					port: 0,
					notifyTakeover: readNotifyTakeoverFlag()
				});
				state.writeSection("balance", {
					ok: false,
					provider: "standalone",
					reason: "unsupported",
					silent: true
				});
			}
			`;
    // 找到 if (port !== 0) { ... } 的收尾右括号，把它换成 "} else if (...) { ... }"
    let insertAt = nextBlock;
    while (insertAt > 0 && /[ \t\r\n]/.test(out[insertAt - 1])) insertAt--;
    const closeIdx = insertAt - 1;
    if (out[closeIdx] !== "}") {
      console.error("!! standalone.js 找不到 if (port !== 0) 的收尾括号");
      process.exit(1);
    }
    const elseIfBody = " else if (bridge.online) {" + elseIf.slice("} else if (bridge.online) {".length);
    out = out.slice(0, closeIdx + 1) + elseIfBody + out.slice(closeIdx + 1);

    writeFileSync(p, out, "utf8");
    console.log("[ok] lib/standalone.js");
  }
}

/* ---------------- 2) shared-core.js ---------------- */
{
  const { p, s } = read(join("runtime", "electron-helper", "shared-core.js"));
  if (s.includes("balance-silent-v16")) {
    console.log("[skip] runtime/electron-helper/shared-core.js");
  } else {
    const fnIdx = s.indexOf("function decideBalanceNotice(state, lastKey, explicit) {");
    if (fnIdx < 0) {
      console.error("!! shared-core.js 找不到 decideBalanceNotice");
      process.exit(1);
    }
    let depth = 0;
    let endIdx = -1;
    for (let i = fnIdx; i < s.length; i++) {
      const ch = s[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          endIdx = i + 1;
          break;
        }
      }
    }
    if (endIdx < 0) {
      console.error("!! shared-core.js 找不到 decideBalanceNotice 结尾");
      process.exit(1);
    }
    const newFn = `function decideBalanceNotice(state, lastKey, explicit) {
	const key = state.reason + ":" + state.provider;
	// balance-silent-v16：独立版（没接 DSH）本来就查不了余额，别弹「服务商不支持余额查询」
	if (state.silent === true || state.reason === "unsupported") return {
		show: false,
		key
	};
	if (state.ok) return {
		show: false,
		key: null
	};
	return {
		show: explicit || key !== lastKey,
		key
	};
}`;
    const out = s.slice(0, fnIdx) + newFn + s.slice(endIdx);
    writeFileSync(p, out, "utf8");
    console.log("[ok] runtime/electron-helper/shared-core.js");
  }
}

console.log("[done] patch_v16");
