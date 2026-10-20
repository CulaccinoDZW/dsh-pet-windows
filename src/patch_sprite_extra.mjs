// 给 sprite.js 追加：速聊（快捷对话）+ 随机动作（幂等）
// 用法: node patch_sprite_extra.mjs <app 目录>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const appDir = process.argv[2];
if (!appDir) {
  console.error("用法: node patch_sprite_extra.mjs <app 目录>");
  process.exit(2);
}
const spritePath = join(appDir, "runtime", "electron-helper", "sprite.js");
let sp = readFileSync(spritePath, "utf8");

if (sp.includes("'chat-quick'")) {
  console.log("[skip] sprite.js 已有速聊/随机动作");
  process.exit(0);
}

const oldTools = [
  "    tools.push(",
  "      { label: '碎碎念', action: 'whisper' },",
  "      { label: '对话', action: 'chat' },",
  "      { label: '清空对话记忆', action: 'chat-clear' },",
  "      { label: '重载配置', action: 'reload' },",
  "      { label: '退出', action: 'quit' },",
  "    );",
].join("\n");
if (!sp.includes(oldTools)) {
  console.error("[fail] 找不到 tools.push 工具项列表");
  process.exit(1);
}
const newTools = [
  "    tools.push(",
  "      { label: '碎碎念', action: 'whisper' },",
  "      { label: '对话', action: 'chat' },",
  "      { label: '速聊', children: [",
  "        { label: '夸夸我', action: 'chat-quick', prompt: '夸夸我吧，一句话就好' },",
  "        { label: '讲个笑话', action: 'chat-quick', prompt: '讲个冷笑话给我听' },",
  "        { label: '你在干嘛', action: 'chat-quick', prompt: '你现在在干什么呀' },",
  "        { label: '安慰我', action: 'chat-quick', prompt: '我今天有点累，安慰我一下' },",
  "      ] },",
  "      { label: '随机动作', action: 'random-anim' },",
  "      { label: '清空对话记忆', action: 'chat-clear' },",
  "      { label: '重载配置', action: 'reload' },",
  "      { label: '退出', action: 'quit' },",
  "    );",
].join("\n");
sp = sp.replace(oldTools, newTools);

const oldBranch = [
  "    if (leaf.action === 'chat-clear') {",
  "      fetch(BASE + '/chat/clear?pet=' + encodeURIComponent(this.pet.id), { method: 'POST' }).catch(() => {});",
  "      return;",
  "    }",
].join("\n");
if (!sp.includes(oldBranch)) {
  console.error("[fail] 找不到 chat-clear 分支");
  process.exit(1);
}
const newBranch = [
  "    if (leaf.action === 'chat-quick') {",
  "      const quickText = String(leaf.prompt || '').trim();",
  "      if (!quickText) return;",
  "      fetch(BASE + '/chat?pet=' + encodeURIComponent(this.pet.id), {",
  "        method: 'POST',",
  "        headers: { 'content-type': 'application/json' },",
  "        body: JSON.stringify({ text: quickText }),",
  "      }).catch(() => {});",
  "      return;",
  "    }",
  "    if (leaf.action === 'random-anim') {",
  "      const pool = [];",
  "      for (const key of Object.keys(this.animations)) {",
  "        const group = this.animations[key];",
  "        if (!Array.isArray(group)) continue;",
  "        for (const name of group) if (typeof name === 'string' && name) pool.push(name);",
  "      }",
  "      const picked = pool.length ? S.pick(pool) : '';",
  "      if (picked) {",
  "        if (this.animations.moves.actions.some((a) => a.name === picked)) {",
  "          if (this.tryMove(picked) === false) this.playOnce(picked);",
  "        } else this.playOnce(picked);",
  "      }",
  "      return;",
  "    }",
  oldBranch,
].join("\n");
sp = sp.replace(oldBranch, newBranch);

writeFileSync(spritePath, sp, "utf8");
console.log("[ok] sprite.js 已追加速聊 / 随机动作");
