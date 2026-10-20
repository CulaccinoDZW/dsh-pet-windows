// patch_v8.mjs —— 待办重复语义重写 / 改名 / API Key（幂等）
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const appDir = process.argv[2];
if (!appDir) { console.error("usage: node patch_v8.mjs <appDir>"); process.exit(2); }
let changed = 0;
function patchFile(file, fn) {
  const p = join(appDir, file);
  let src = readFileSync(p, "utf8");
  const next = fn(src);
  if (next !== src) { writeFileSync(p, next, "utf8"); changed += 1; console.log("[ok] " + file); }
  else console.log("[skip] " + file);
}

// ---------- standalone.js ----------
patchFile("lib/standalone.js", (src) => {
  if (src.includes("todoNextDueV2")) return src; // 已打过
  // 1) 新调度算法
  const newFn = `	/** 下一次触发时间（本地时区，v2：每周多选 / 每月多选 + 缺日用当月最后一天） */
	const todoNextDue = (t, now) => {
		const hm = parseHm(t.time) || { h: 9, mi: 0 };
		const rep = String(t.repeat || "none");
		const nowMs = now.getTime();
		const hh = hm.h;
		const mm = hm.mi;
		if (rep === "none") {
			const ds = String(t.date || "").trim();
			const d = ds ? new Date(ds + "T" + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":00") : new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
			return d;
		}
		if (rep === "daily") {
			const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
			if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1);
			return d;
		}
		if (rep === "weekly") {
			const raw = Array.isArray(t.weekdays) && t.weekdays.length ? t.weekdays : [Number(t.weekday) || 0];
			const days = Array.from(new Set(raw.map((n) => {
				const v = Number(n) % 7;
				return v < 0 ? v + 7 : v;
			})));
			for (let i = 0; i < 15; i += 1) {
				const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm, 0, 0);
				if (d.getTime() > nowMs && days.includes(d.getDay())) return d;
			}
			return null;
		}
		if (rep === "monthly") {
			const raw = Array.isArray(t.monthdays) && t.monthdays.length ? t.monthdays : [Number(t.monthday) || 1];
			const want = Array.from(new Set(raw.map((n) => Math.min(Math.max(Number(n) || 1, 1), 31)))).sort((a, b) => a - b);
			for (let i = 0; i < 14; i += 1) {
				const base = new Date(now.getFullYear(), now.getMonth() + i, 1);
				const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
				for (const dd of want) {
					const real = Math.min(dd, lastDay);
					const d = new Date(base.getFullYear(), base.getMonth(), real, hh, mm, 0, 0);
					if (d.getTime() > nowMs) return d;
				}
			}
			return null;
		}
		const ds2 = String(t.date || "").trim();
		if (!ds2) return null;
		return new Date(ds2 + "T" + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":00");
	};

	/** todoNextDueV2 标记（幂等用） */
`;
  const start = src.indexOf("\t/** 下一次触发时间（本地时区） */\n\tconst todoNextDue = (t, now) => {");
  if (start < 0) { console.log("[warn] 找不到 todoNextDue"); return src; }
  const endMark = "\n\tensureSfxDirs();";
  const end = src.indexOf(endMark, start);
  if (end < 0) { console.log("[warn] 找不到 todoNextDue 结束"); return src; }
  src = src.slice(0, start) + newFn + src.slice(end + 1);

  // 2) 触发后：不重复的待办标记完成
  const fireAnchor = `				t.lastFiredKey = dueKey;
				t.lastFiredAt = now.toISOString();`;
  if (src.includes(fireAnchor)) {
    src = src.replace(fireAnchor, fireAnchor + `
				if (String(t.repeat || "none") === "none") t.done = true;`);
  }

  // 3) todo/add 支持 weekdays / monthdays
  const oldItem = `				weekday: Math.min(Math.max(Number(parsed?.weekday) || 0, 0), 6),
				monthday: Math.min(Math.max(Number(parsed?.monthday) || 1, 1), 31),`;
  if (src.includes(oldItem)) {
    src = src.replace(oldItem, `				weekday: Math.min(Math.max(Number(parsed?.weekday) || 0, 0), 6),
				monthday: Math.min(Math.max(Number(parsed?.monthday) || 1, 1), 31),
				weekdays: Array.isArray(parsed?.weekdays) ? parsed.weekdays.map((n) => Math.min(Math.max(Number(n) || 0, 0), 6)) : [],
				monthdays: Array.isArray(parsed?.monthdays) ? parsed.monthdays.map((n) => Math.min(Math.max(Number(n) || 1, 1), 31)) : [],`);
  }

  // 4) 新路由：/pet/name、/ai/key
  const routeAnchor = `		if (rest === "quit" || rest === "exit") {`;
  if (!src.includes('rest === "pet/name"') && src.includes(routeAnchor)) {
    const routes = `		if (rest === "pet/name") {
			if (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
			let pn = null;
			try { pn = JSON.parse(body || "null"); } catch (e) { pn = null; }
			const newName = String(pn?.name || "").trim().slice(0, 24);
			const petIdName = String(pn?.pet || url.searchParams.get("pet") || "main");
			if (!newName) return { kind: "json", status: 400, obj: { ok: false, message: "名字不能为空" } };
			try {
				const cfgName = readAllConfig(configPaths);
				const foundName = findPetInstance(cfgName, petIdName);
				if (!foundName) return { kind: "json", status: 404, obj: { ok: false, message: "没有这只宠物：" + petIdName } };
				const entryPets = Array.isArray(cfgName[foundName.entry]?.pets) ? cfgName[foundName.entry].pets : [];
				const nextPets = entryPets.map((p) => p && p.id === foundName.pet.id ? { ...p, name: newName } : p);
				const existingCfg = readUserConfig(configPaths);
				const savedName = saveUserConfig({ pets: nextPets }, existingCfg);
				if (!savedName) return { kind: "json", status: 500, obj: { ok: false, message: "写配置失败" } };
				writeFileSync(userConfigPath, JSON.stringify(savedName, null, 2), "utf8");
				syncDesktop();
				return { kind: "json", status: 200, obj: { ok: true, pet: petIdName, name: newName } };
			} catch (e) {
				return { kind: "json", status: 500, obj: { ok: false, message: String(e && e.message || e) } };
			}
		}
		if (rest === "ai/key") {
			const aiFile = join(dshHomeDir(), "dsh-pet-standalone", "ai-config.json");
			if (method === "GET") {
				let cur = "";
				try { cur = String(JSON.parse(readFileSync(aiFile, "utf8")).apiKey || ""); } catch (e) { cur = ""; }
				const masked = cur ? cur.slice(0, 6) + "…" + cur.slice(-4) : "";
				return { kind: "json", status: 200, obj: { ok: true, hasKey: !!cur, masked } };
			}
			if (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
			let pk = null;
			try { pk = JSON.parse(body || "null"); } catch (e) { pk = null; }
			const key = String(pk?.key ?? "").trim();
			try {
				mkdirSync(join(dshHomeDir(), "dsh-pet-standalone"), { recursive: true });
				let doc = {};
				try { doc = JSON.parse(readFileSync(aiFile, "utf8")) || {}; } catch (e) { doc = {}; }
				doc.apiKey = key;
				if (!doc.baseURL) doc.baseURL = "https://apitiantian.com/v1";
				if (!doc.model) doc.model = "deepseek-v4.1-flash";
				if (typeof doc.enabled !== "boolean") doc.enabled = true;
				writeFileSync(aiFile, JSON.stringify(doc, null, 2), "utf8");
				if (typeof reloadPetAiConfig === "function") { try { reloadPetAiConfig(); } catch (e) {} }
				return { kind: "json", status: 200, obj: { ok: true, hasKey: !!key } };
			} catch (e) {
				return { kind: "json", status: 500, obj: { ok: false, message: String(e && e.message || e) } };
			}
		}
` + routeAnchor;
    src = src.replace(routeAnchor, routes);
  }
  return src;
});

// ---------- sprite.js：菜单加 改名 / API Key ----------
patchFile("runtime/electron-helper/sprite.js", (src) => {
  if (src.includes("'rename-pet'")) return src;
  const anchor = `    tree.push({
      label: '退出',
      action: 'quit'
    });`;
  const alt = `tree.push({ label: '退出', action: 'quit' });`;
  const inject = `    tree.push({ label: '改名…', action: 'rename-pet' });
    tree.push({ label: 'API Key…', action: 'api-key' });
`;
  if (src.includes(anchor)) src = src.replace(anchor, inject + anchor);
  else if (src.includes(alt)) src = src.replace(alt, inject + alt);
  else { console.log("[warn] sprite.js 找不到退出项锚点"); return src; }

  const actAnchor = `    if (leaf.action === 'quit') {`;
  const branch = `    if (leaf.action === 'rename-pet') {
      if (window.__dshPetExtras && window.__dshPetExtras.openRename) window.__dshPetExtras.openRename();
      return;
    }
    if (leaf.action === 'api-key') {
      if (window.__dshPetExtras && window.__dshPetExtras.openApiKey) window.__dshPetExtras.openApiKey();
      return;
    }
`;
  if (src.includes(actAnchor)) src = src.replace(actAnchor, branch + actAnchor);
  return src;
});

console.log("[done] changed=" + changed);
