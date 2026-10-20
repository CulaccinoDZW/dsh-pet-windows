//#region src/standalone/pet-ai.ts（DSH-Pet-Windows 追加：直连 DeepSeek API + DSH 本地桥接）
const PET_AI_DEFAULT_BASE_URL = "https://apitiantian.com/v1";
const PET_AI_DEFAULT_MODEL = "deepseek-v4.1-flash";
const PET_AI_MODEL_IDS = ["deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek-v4-pro"];
/** DSH 主目录（与宿主同口径：$DSH_HOME 优先，否则 ~/.dsh） */
function petDshHome() {
	const env = String(process.env.DSH_HOME ?? "").trim();
	return env !== "" ? env : join(homedir(), ".dsh");
}
/** 独立版 AI 配置文件：<DSH_HOME>/dsh-pet-standalone/ai-config.json（首次启动自动生成，与 DSH 完全分开） */
function petAiConfigPath() {
	return join(petDshHome(), "dsh-pet-standalone", "ai-config.json");
}
/** 【安全】独立版不读取本机任何全局凭据（.credentials.yaml / 环境变量都不读），只认自己的 ai-config.json */
function petCredentialsKey() { return ""; }  // 安全：不读取本机任何全局凭据
/** 读/建 AI 配置（首次运行自动写盘；没有 key 也不阻断启动，只告警） */
function loadPetAiConfig(logger) {
	const file = petAiConfigPath();
	const cfg = {
		baseURL: PET_AI_DEFAULT_BASE_URL,
		model: PET_AI_DEFAULT_MODEL,
		chatModel: "",
		whisperModel: "",
		apiKey: ""
	};
	const existing = existsSync(file);
	if (existing) {
		try {
			const raw = JSON.parse(readFileSync(file, "utf8"));
			if (raw && typeof raw === "object") for (const key of Object.keys(cfg)) {
				const v = raw[key];
				if (typeof v === "string" && v.trim() !== "") cfg[key] = v.trim();
			}
		} catch (e) {
			logger?.warn?.(`[dsh-pet] ai-config.json 解析失败，改用默认值：${e instanceof Error ? e.message : String(e)}`);
		}
	}
	if (cfg.apiKey === "") cfg.apiKey = petCredentialsKey();
	if (cfg.chatModel === "") cfg.chatModel = cfg.model;
	if (cfg.whisperModel === "") cfg.whisperModel = cfg.model;
	try {
		mkdirSync(dirname(file), { recursive: true });
		if (!existing) {
			writeFileSync(file, JSON.stringify({
				baseURL: cfg.baseURL,
				model: cfg.model,
				chatModel: cfg.chatModel,
				whisperModel: cfg.whisperModel,
				apiKey: cfg.apiKey
			}, null, 2) + "\n", "utf8");
			logger?.info?.(`[dsh-pet] 首次运行：已自动生成 AI 配置 ${file}`);
		}
	} catch (e) {
		logger?.warn?.(`[dsh-pet] 写 ai-config.json 失败：${e instanceof Error ? e.message : String(e)}`);
	}
	if (cfg.apiKey === "") logger?.warn?.("[dsh-pet] 未配置 DeepSeek API Key（只认它自己的 ai-config.json，不读取本机其它凭据），碎碎念与对话会报错");
	return cfg;
}
/** 把宿主侧 message 结构压成 OpenAI messages */
function petOpenAiMessages(options) {
	const out = [];
	const system = typeof options?.system === "string" ? options.system.trim() : "";
	if (system !== "") out.push({
		role: "system",
		content: system
	});
	for (const msg of Array.isArray(options?.messages) ? options.messages : []) {
		const role = msg?.role === "assistant" ? "assistant" : "user";
		const parts = Array.isArray(msg?.content) ? msg.content : [];
		const text = parts.filter((p) => p !== null && typeof p === "object" && p.type === "text" && typeof p.text === "string").map((p) => p.text).join("");
		if (text.trim() === "") continue;
		out.push({
			role,
			content: text
		});
	}
	return out;
}
/** 直连 DeepSeek（OpenAI 兼容）流式补全；按 BlockAssembler 认得的 {type:"text",text} 吐块 */
async function* streamPetAiChat(ai, options) {
	const apiKey = String(ai?.apiKey ?? "").trim();
	if (apiKey === "") throw new Error("缺少 DeepSeek API Key：请在 " + petAiConfigPath() + " 里填 apiKey，或设置环境变量 DEEPSEEK_API_KEY");
	const messages = petOpenAiMessages(options);
	if (messages.length === 0) throw new Error("没有可发送的消息");
	const wanted = typeof options?.model === "string" ? options.model.trim() : "";
	const model = wanted !== "" && !PET_AI_MODEL_IDS.includes(wanted) ? wanted : String(ai?.model || PET_AI_DEFAULT_MODEL);
	const url = String(ai?.baseURL || PET_AI_DEFAULT_BASE_URL).replace(/\/+$/, "") + "/chat/completions";
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"authorization": "Bearer " + apiKey
		},
		body: JSON.stringify({
			model,
			messages,
			stream: true,
			temperature: 1
		}),
		signal: options?.signal
	});
	if (!res.ok) {
		let detail = "";
		try {
			detail = (await res.text()).slice(0, 300);
		} catch {}
		throw new Error(`DeepSeek API 失败（HTTP ${res.status}）${detail === "" ? "" : "：" + detail}`);
	}
	if (!res.body) throw new Error("DeepSeek API 没有返回响应体");
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of res.body) {
		buffer += decoder.decode(chunk, { stream: true });
		for (;;) {
			const nl = buffer.indexOf("\n");
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
/** 跑一条命令并收 stdout（找不到命令/超时都返回已收内容，不抛） */
function petRunCommand(command, args, timeoutMs = 4000) {
	return new Promise((resolvePromise) => {
		let out = "";
		let child;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			resolvePromise(out);
		};
		try {
			child = spawn(command, args, { windowsHide: true });
		} catch {
			finish();
			return;
		}
		child.stdout?.on("data", (c) => {
			out += String(c);
		});
		child.on("error", finish);
		child.on("close", finish);
		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {}
			finish();
		}, timeoutMs);
		timer.unref?.();
	});
}
/** 发现本地 DSH 的 Web 端口：netstat 找 127.0.0.1 监听且属主是 DeepSeek Harness 的端口，再用 dsh-pet 状态端点确认 */
async function discoverDshPetPort(logger) {
	const listing = await petRunCommand("netstat", ["-ano"]);
	if (listing === "") return 0;
	const pids = new Set();
	const taskOut = await petRunCommand("tasklist", ["/FI", "IMAGENAME eq DeepSeek Harness.exe", "/FO", "CSV", "/NH"]);
	for (const line of taskOut.split(/\r?\n/)) {
		const m = /^"[^"]*","(\d+)"/.exec(line.trim());
		if (m) pids.add(m[1]);
	}
	if (pids.size === 0) return 0;
	const candidates = [];
	for (const line of listing.split(/\r?\n/)) {
		const cols = line.trim().split(/\s+/);
		if (cols.length < 5 || cols[3] !== "LISTENING") continue;
		if (!cols[1].startsWith("127.0.0.1:")) continue;
		if (!pids.has(cols[4])) continue;
		const port = Number(cols[1].slice(cols[1].lastIndexOf(":") + 1));
		if (Number.isInteger(port) && port > 0 && port < 65536) candidates.push(port);
	}
	for (const port of candidates) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/dsh-pet-7340/state`, { signal: AbortSignal.timeout(1200) });
			if (!res.ok) continue;
			const obj = await res.json();
			if (obj && typeof obj === "object" && obj.sections && typeof obj.sections === "object") return port;
		} catch {}
	}
	if (candidates.length > 0) logger?.info?.(`[dsh-pet] 发现 DSH 监听端口 ${candidates.join(",")}，但 dsh-pet 路由不可用`);
	return 0;
}
/**
 * DSH 本地桥接：DSH 在跑时把它的 state（余额/工作状态/通知/宠物气泡）镜像进本进程，
 * 对话与碎碎念转发给 DSH（用 DSH 的模型与会话记忆）；DSH 退出后自动切回直连 API。
 */
function createDshBridge({ logger, state, intervalMs = 2500 }) {
	const bridge = {
		online: false,
		port: 0,
		timer: void 0,
		stopped: false,
		lastSections: {
			balance: -1,
			workStatus: -1,
			notify: -1
		},
		lastPets: new Map(),
		mirror(snapshot) {
			for (const name of ["balance", "workStatus", "notify"]) {
				const leaf = snapshot?.sections?.[name];
				if (!leaf || typeof leaf !== "object") continue;
				const counter = Number(leaf.counter ?? 0);
				if (!Number.isFinite(counter) || counter === bridge.lastSections[name]) continue;
				bridge.lastSections[name] = counter;
				state.writeSection(name, leaf.data ?? null);
			}
			const pets = snapshot?.pets;
			if (!pets || typeof pets !== "object") return;
			for (const [petId, entry] of Object.entries(pets)) {
				if (!entry || typeof entry !== "object") continue;
				let seen = bridge.lastPets.get(petId);
				if (seen === void 0) {
					seen = {
						say: -1,
						anim: -1
					};
					bridge.lastPets.set(petId, seen);
				}
				for (const leafName of ["say", "anim"]) {
					const leaf = entry[leafName];
					if (!leaf || typeof leaf !== "object") continue;
					const counter = Number(leaf.counter ?? 0);
					if (!Number.isFinite(counter) || counter === seen[leafName]) continue;
					seen[leafName] = counter;
					state.writePet(petId, leafName, leaf.data ?? null);
				}
			}
		},
		async forwardJson(pathAndQuery, init) {
			if (!bridge.online || bridge.port === 0) return void 0;
			try {
				const res = await fetch(`http://127.0.0.1:${bridge.port}/dsh-pet-7340${pathAndQuery}`, {
					method: init?.method ?? "POST",
					headers: { "content-type": "application/json" },
					body: init?.body,
					signal: AbortSignal.timeout(90000)
				});
				if (!res.ok) return void 0;
				return await res.json();
			} catch (e) {
				logger?.warn?.(`[dsh-pet] 转发 DSH 请求失败（${pathAndQuery}）：${e instanceof Error ? e.message : String(e)}`);
				bridge.online = false;
				return void 0;
			}
		},
		async tick() {
			if (bridge.stopped) return;
			let port = bridge.port;
			if (port === 0) port = await discoverDshPetPort(logger);
			if (port !== 0) {
				try {
					const res = await fetch(`http://127.0.0.1:${port}/dsh-pet-7340/state`, { signal: AbortSignal.timeout(2000) });
					if (!res.ok) throw new Error("HTTP " + res.status);
					const snapshot = await res.json();
					bridge.port = port;
					if (!bridge.online) {
						bridge.online = true;
						logger?.info?.(`[dsh-pet] 已接入本地 DSH（127.0.0.1:${port}）：任务提示 / 余额 / 对话 / 碎碎念 走 DSH`);
					}
					bridge.mirror(snapshot);
				} catch (e) {
					if (bridge.online) logger?.info?.(`[dsh-pet] 本地 DSH 已断开（${e instanceof Error ? e.message : String(e)}），独立版切回直连 API`);
					bridge.online = false;
					bridge.port = 0;
					// 不再往 balance 写任何带 message 的失败叶子：那会在桌宠上弹一条"余额暂不可用"的提示
					state.writeSection("balance", {
						ok: false,
						provider: "standalone",
						reason: "unsupported"
					});
				}
			}
			if (!bridge.stopped) {
				bridge.timer = setTimeout(() => {
					void bridge.tick();
				}, intervalMs);
				bridge.timer.unref?.();
			}
		},
		start() {
			if (bridge.stopped || bridge.timer !== void 0) return;
			if (String(process.env.DSH_PET_NO_BRIDGE ?? "") === "1") {
				logger?.info?.("[dsh-pet] 已按 DSH_PET_NO_BRIDGE=1 禁用 DSH 桥接（直连 API 模式）");
				return;
			}
			void bridge.tick();
		},
		stop() {
			bridge.stopped = true;
			bridge.online = false;
			if (bridge.timer !== void 0) clearTimeout(bridge.timer);
			bridge.timer = void 0;
		}
	};
	return bridge;
}
//#endregion