// patch_v15.mjs —— 填了 Key 自动识别「中转站 / DeepSeek 官方」端点，并记住结果
// 用法：node patch_v15.mjs <appDir>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const appDir = process.argv[2];
if (!appDir) {
  console.error("用法: node patch_v15.mjs <appDir>");
  process.exit(1);
}
const file = join(appDir, "lib", "standalone.js");
if (!existsSync(file)) {
  console.error("找不到 " + file);
  process.exit(1);
}
let s = readFileSync(file, "utf8");

const MARK = "PET_AI_ALT_ENDPOINTS";
if (s.includes(MARK)) {
  console.log("[skip] patch_v15 已应用过");
  process.exit(0);
}

const START = "async function* streamPetAiChat(ai, options) {";
const END_MARK = "/** 跑一条命令并收 stdout";
const i = s.indexOf(START);
const j = s.indexOf(END_MARK);
if (i < 0 || j < 0 || j < i) {
  console.error("!! patch_v15 找不到 streamPetAiChat 起止标记");
  process.exit(1);
}

const NEW = `// 已知的兼容端点（OpenAI 协议）。填的 Key 属于哪个，就自动切到哪个。
const PET_AI_ALT_ENDPOINTS = [
	{
		baseURL: "https://api.deepseek.com/v1",
		models: ["deepseek-chat", "deepseek-flash", "deepseek-v4-pro", "deepseek-reasoner"]
	},
	{
		baseURL: "https://apitiantian.com/v1",
		models: ["deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek-v4-pro"]
	}
];
/** 记住这次认出来的端点，下次直接用它 */
function persistPetAiBase(baseURL, model) {
	try {
		const p = petAiConfigPath();
		let doc = {};
		try {
			doc = JSON.parse(readFileSync(p, "utf8"));
		} catch {}
		if (!doc || typeof doc !== "object") doc = {};
		if (doc.baseURL === baseURL && doc.model === model) return;
		doc.baseURL = baseURL;
		doc.model = model;
		doc.chatModel = model;
		doc.whisperModel = model;
		writeFileSync(p, JSON.stringify(doc, null, 2), "utf8");
	} catch {}
}
async function* streamPetAiChat(ai, options) {
	const apiKey = String(ai?.apiKey ?? "").trim();
	if (apiKey === "") throw new Error("缺少 DeepSeek API Key：请在右键菜单「API Key…」里填写（保存后立即生效），或编辑 " + petAiConfigPath() + " 后重试");
	const messages = petOpenAiMessages(options);
	if (messages.length === 0) throw new Error("没有可发送的消息");
	const wanted = typeof options?.model === "string" ? options.model.trim() : "";
	const configuredBase = String(ai?.baseURL || PET_AI_DEFAULT_BASE_URL).replace(/\\/+$/, "");
	const configuredModel = String(ai?.model || PET_AI_DEFAULT_MODEL);
	const plan = [];
	const pushPlan = (baseURL, models) => {
		for (const m of models) plan.push({
			baseURL,
			model: m
		});
	};
	const wantedList = wanted !== "" ? [wanted] : [];
	const configuredList = [configuredModel];
	pushPlan(configuredBase, [...new Set([...wantedList, ...configuredList])]);
	for (const ep of PET_AI_ALT_ENDPOINTS) {
		if (configuredBase.startsWith(ep.baseURL)) continue;
		pushPlan(ep.baseURL, ep.models);
	}
	let res = null;
	let used = null;
	const failures = [];
	for (const item of plan) {
		let r;
		try {
			r = await fetch(item.baseURL + "/chat/completions", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"authorization": "Bearer " + apiKey
				},
				body: JSON.stringify({
					model: item.model,
					messages,
					stream: true,
					temperature: 1
				}),
				signal: options?.signal
			});
		} catch (e) {
			failures.push(item.baseURL + " → " + String(e?.message ?? e));
			continue;
		}
		if (r.ok) {
			res = r;
			used = item;
			break;
		}
		let detail = "";
		try {
			detail = (await r.text()).slice(0, 200);
		} catch {}
		failures.push(item.baseURL + " → HTTP " + r.status + (detail === "" ? "" : "：" + detail));
		// 只有「Key 不对 / 模型不对」才换端点重试，别把网络错误也当配置错
		if (r.status !== 400 && r.status !== 401 && r.status !== 403 && r.status !== 404) break;
	}
	if (!res) throw new Error("DeepSeek API 失败：" + failures.join("；"));
	if (used.baseURL !== configuredBase) persistPetAiBase(used.baseURL, used.model);
	if (!res.body) throw new Error("DeepSeek API 没有返回响应体");
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of res.body) {
		buffer += decoder.decode(chunk, {
			stream: true
		});
		for (;;) {
			const nl = buffer.indexOf("\\n");
			if (nl < 0) break;
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (line === "" || line.startsWith(":")) continue;
			if (!line.startsWith("data:")) continue;
			const payload = line.slice(5).trim();
			if (payload === "[DONE]") return;
			let obj;
			try {
				obj = JSON.parse(payload);
			} catch {
				continue;
			}
			const delta = obj?.choices?.[0]?.delta?.content;
			if (typeof delta === "string" && delta !== "") yield {
				type: "text",
				text: delta
			};
		}
	}
}
`;

s = s.slice(0, i) + NEW + s.slice(j);
writeFileSync(file, s, "utf8");
console.log("[ok] patch_v15：Key 自动识别中转站/官方端点，成功后会记住");
