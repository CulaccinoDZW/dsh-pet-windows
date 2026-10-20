#!/usr/bin/env node
// 第 5 轮补丁（幂等）：DSH 桥接在线状态 / 余额菜单条件显示 / 系统通知接管开关
// 用法：node patch_v5.mjs <app 目录>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const app = process.argv[2];
if (!app) {
	console.error("用法: node patch_v5.mjs <app 目录>");
	process.exit(1);
}

const ok = (msg) => console.log("[ok] " + msg);
const skip = (msg) => console.log("[skip] " + msg);
const fail = (msg) => {
	console.error("[fail] " + msg);
	process.exitCode = 1;
};

function edit(file, marker, transform, label) {
	if (!existsSync(file)) return fail(label + "：文件不存在 " + file);
	const src = readFileSync(file, "utf8");
	if (src.includes(marker)) return skip(label + "（已打过补丁）");
	const out = transform(src);
	if (out === src) return fail(label + "：锚点未命中");
	writeFileSync(file, out, "utf8");
	ok(label);
}

/* ------------------- 1. standalone.js：桥接状态 + 通知接管路由（tab 缩进） ------------------- */
const standalone = join(app, "lib", "standalone.js");

edit(standalone, "readNotifyTakeoverFlag", (src) => {
	src = src.replace(
		"function createDshBridge({",
		[
			"/** 独立版：从安装目录 guard.ini 读「接管系统通知」开关（供右键菜单显示当前状态） */",
			"function readNotifyTakeoverFlag() {",
			"\ttry {",
			'\t\tconst root = resolve(dirname(dirname(dirname(process.execPath || ""))));',
			'\t\tconst iniPath = join(root, "guard.ini");',
			"\t\tif (!existsSync(iniPath)) return false;",
			'\t\treturn /^\\s*takeover_notifications\\s*=\\s*1\\s*$/m.test(readFileSync(iniPath, "utf8"));',
			"\t} catch {",
			"\t\treturn false;",
			"\t}",
			"}",
			"",
			"function createDshBridge({",
		].join("\n"),
	);
	return src;
}, "standalone.js 增加 readNotifyTakeoverFlag");

edit(standalone, 'state.writeSection("bridge"', (src) => {
	src = src.replace(
		"\t\t\t\t\tbridge.mirror(snapshot);",
		'\t\t\t\t\tbridge.mirror(snapshot);\n\t\t\t\t\tstate.writeSection("bridge", {\n\t\t\t\t\t\tonline: true,\n\t\t\t\t\t\tport: bridge.port,\n\t\t\t\t\t\tnotifyTakeover: readNotifyTakeoverFlag()\n\t\t\t\t\t});',
	);
	src = src.replace(
		'\t\t\t\t\tstate.writeSection("balance", {\n\t\t\t\t\t\tok: false,\n\t\t\t\t\t\treason: "dsh-offline",\n\t\t\t\t\t\tmessage: "DSH 未运行，余额暂不可用"\n\t\t\t\t\t});',
		'\t\t\t\t\tstate.writeSection("balance", {\n\t\t\t\t\t\tok: false,\n\t\t\t\t\t\treason: "dsh-offline",\n\t\t\t\t\t\tmessage: "DSH 未运行，余额暂不可用"\n\t\t\t\t\t});\n\t\t\t\t\tstate.writeSection("bridge", {\n\t\t\t\t\t\tonline: false,\n\t\t\t\t\t\tport: 0,\n\t\t\t\t\t\tnotifyTakeover: readNotifyTakeoverFlag()\n\t\t\t\t\t});',
	);
	return src;
}, "standalone.js 桥接状态写入 sections.bridge");

edit(standalone, 'rest === "notify/takeover"', (src) => {
	const block = [
		'\t\tif (rest === "notify/takeover") {',
		'\t\t\tconst takeover = String(url.searchParams.get("takeover") ?? "") === "1";',
		'\t\t\tconst petIdNotify = String(url.searchParams.get("pet") ?? "");',
		"\t\t\tlet saved = false;",
		'\t\t\tlet reason = "";',
		"\t\t\ttry {",
		'\t\t\t\tconst root = resolve(dirname(dirname(dirname(process.execPath || ""))));',
		'\t\t\t\tconst iniPath = join(root, "guard.ini");',
		"\t\t\t\tif (existsSync(iniPath)) {",
		'\t\t\t\t\tlet ini = readFileSync(iniPath, "utf8");',
		'\t\t\t\t\tconst line = "takeover_notifications=" + (takeover ? "1" : "0");',
		"\t\t\t\t\tif (/^\\s*takeover_notifications\\s*=.*$/m.test(ini)) ini = ini.replace(/^\\s*takeover_notifications\\s*=.*$/m, line);",
		'\t\t\t\t\telse ini = ini.replace(/\\s*$/, "\\n") + line + "\\n";',
		'\t\t\t\t\twriteFileSync(iniPath, ini, "utf8");',
		"\t\t\t\t\tsaved = true;",
		'\t\t\t\t} else reason = "guard.ini-missing";',
		"\t\t\t} catch (e) {",
		"\t\t\t\treason = e instanceof Error ? e.message : String(e);",
		"\t\t\t}",
		"\t\t\tif (petIdNotify) {",
		'\t\t\t\tstate.writePet(petIdNotify, "say", {',
		'\t\t\t\t\ttext: takeover ? "已接管系统通知，弹窗改从桌宠出现啦" : "已恢复 Windows 原生通知"',
		"\t\t\t\t});",
		"\t\t\t}",
		'\t\t\treturn { kind: "json", status: 200, obj: { ok: saved, takeover, reason } };',
		"\t\t}",
		"",
		'\t\tif (rest === "chat/clear") {',
	].join("\n");
	src = src.replace('\t\tif (rest === "chat/clear") {', block);
	return src;
}, "standalone.js 新增 /notify/takeover 路由");

/* ------------------- 2. events.js：把 sections.bridge 交给渲染端（2 空格缩进） ------------------- */
const events = join(app, "runtime", "electron-helper", "events.js");

edit(events, "__dshPetDebug.bridge", (src) => {
	src = src.replace(
		"      if (change.path === 'sections.balance') applyBalanceLeaf(change.leaf);",
		[
			"      if (change.path === 'sections.balance') applyBalanceLeaf(change.leaf);",
			"      else if (change.path === 'sections.bridge') {",
			"        // 桥接状态（DSH 是否在线 / 通知接管开关）只给右键菜单用，不做展示",
			"        window.__dshPetDebug.bridge = change.leaf.data;",
			"      }",
		].join("\n"),
	);
	return src;
}, "events.js 记录 sections.bridge");

/* ------------------- 3. sprite.js：余额菜单 + 通知接管开关（2 空格缩进） ------------------- */
const sprite = join(app, "runtime", "electron-helper", "sprite.js");

edit(sprite, "action: 'show-balance'", (src) => {
	src = src.replace(
		"    const tools = [];\n    tools.push(",
		[
			"    const tools = [];",
			"    const bridgeInfo = (window.__dshPetDebug && window.__dshPetDebug.bridge) || null;",
			"    const bridgeOnline = !!(bridgeInfo && bridgeInfo.online);",
			"    const notifyOn = !!(bridgeInfo && bridgeInfo.notifyTakeover);",
			"    // 余额只在接入 DSH 时才有数据源（DSH 未运行/未安装时整项隐藏）",
			"    if (bridgeOnline && this.pet.balanceEnabled) tools.push({ label: '查看余额', action: 'show-balance' });",
			"    tools.push(",
		].join("\n"),
	);
	src = src.replace(
		"      { label: '重载配置', action: 'reload' },\n    );",
		[
			"      { label: '重载配置', action: 'reload' },",
			"      { label: '系统通知接管' + (notifyOn ? '（已开）' : '（已关）'), children: [",
			"        { label: '开启接管', action: 'notify-on' },",
			"        { label: '关闭接管', action: 'notify-off' },",
			"      ] },",
			"    );",
		].join("\n"),
	);
	return src;
}, "sprite.js 菜单：查看余额（条件）+ 系统通知接管");

edit(sprite, "action === 'notify-on'", (src) => {
	src = src.replace(
		"    if (leaf.action === 'chat-clear') {",
		[
			"    if (leaf.action === 'show-balance') {",
			"      this.showBalanceFromMenu();",
			"      return;",
			"    }",
			"    if (leaf.action === 'notify-on' || leaf.action === 'notify-off') {",
			"      const on = leaf.action === 'notify-on' ? '1' : '0';",
			"      fetch(BASE + '/notify/takeover?pet=' + encodeURIComponent(this.pet.id) + '&takeover=' + on, {",
			"        method: 'POST',",
			"      }).catch(() => {});",
			"      return;",
			"    }",
			"    if (leaf.action === 'chat-clear') {",
		].join("\n"),
	);
	return src;
}, "sprite.js 菜单动作：show-balance / notify-on / notify-off");

/* ------------------- 4. 余额档位文案：峰 → 梁文峰，谷 → 梁文谷 ------------------- */
for (const rel of [
	["runtime", "electron-helper", "shared-core.js"],
	["lib", "client.js"],
]) {
	edit(
		join(app, ...rel),
		"梁文峰",
		(src) => src.replace('text: state.tier === "peak" ? "峰" : "谷"', 'text: state.tier === "peak" ? "梁文峰" : "梁文谷"'),
		rel.join("/") + " 余额档位文案",
	);
}

/* ------------------- 5. 余额气泡放不下长文案（梁文峰/梁文谷）：余额单行不换行 ------------------- */
edit(
	join(app, "runtime", "electron-helper", "index.html"),
	".pet-bubble:not(.is-whisper)",
	(src) => {
		src = src.replace(
			"      .pet-bub-row {",
			[
				"      /* 余额单行：不用 flex 均分（会把“梁文峰”拆行），整体不换行、宽度随内容 */",
				"      .pet-bubble:not(.is-whisper) {",
				"        max-width: none;",
				"      }",
				"      .pet-bubble:not(.is-whisper) .pet-bub-row {",
				"        display: block;",
				"        white-space: nowrap;",
				"      }",
				"      .pet-bub-row {",
			].join("\n"),
		);
		return src;
	},
	"index.html 余额单行不换行",
);

// 上一条把宽度放开到 none 有被窗口裁掉的风险，收紧到 0.8 倍宠物宽（足够放下“余额（梁文峰）¥999.99”）
edit(
	join(app, "runtime", "electron-helper", "index.html"),
	"max-width: calc(var(--pet-size, 462px) * 0.8);\n      }\n      .pet-bubble:not(.is-whisper) .pet-bub-row",
	(src) =>
		src.replace(
			"      .pet-bubble:not(.is-whisper) {\n        max-width: none;\n      }",
			"      .pet-bubble:not(.is-whisper) {\n        max-width: calc(var(--pet-size, 462px) * 0.8);\n      }",
		),
	"index.html 余额气泡宽度上限 0.8",
);

console.log("[done] patch_v5 应用完成");
