// patch_v9.mjs —— 弹窗可输入（窗口聚焦）/ 气泡文字不再溢出（幂等）
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const appDir = process.argv[2];
if (!appDir) { console.error("usage: node patch_v9.mjs <appDir>"); process.exit(2); }
const helper = join(appDir, "runtime", "electron-helper");
let changed = 0;
function edit(file, fn) {
  const p = join(helper, file);
  if (!existsSync(p)) { console.log("[skip missing] " + file); return; }
  const src = readFileSync(p, "utf8");
  const next = fn(src);
  if (next === src) { console.log("[skip] " + file); return; }
  writeFileSync(p, next, "utf8");
  changed += 1;
  console.log("[ok] " + file);
}

// 1) 气泡：换行兜底，只有“档位/金额”保持不换行；宽度上限放宽到 0.92
edit("index.html", (src) => {
  if (src.includes("dsh-bubble-fix-v9")) return src;
  const anchor = `      .pet-bubble:not(.is-whisper) {
        max-width: calc(var(--pet-size, 462px) * 0.8);
      }
      .pet-bubble:not(.is-whisper) .pet-bub-row {
        display: block;
        white-space: nowrap;
      }`;
  if (!src.includes(anchor)) { console.log("[warn] 气泡 CSS 锚点未命中"); return src; }
  return src.replace(anchor, `      /* dsh-bubble-fix-v9：整行可换行，只有档位/金额不拆 */
      .pet-bubble:not(.is-whisper) {
        max-width: calc(var(--pet-size, 462px) * 0.92);
      }
      .pet-bubble:not(.is-whisper) .pet-bub-row {
        display: block;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .pet-bub-tier,
      .pet-bub-amount,
      .pet-bub-err {
        white-space: nowrap;
      }`);
});

// 2) preload：暴露 modalFocus
edit("preload.js", (src) => {
  if (src.includes("modalFocus")) return src;
  const anchor = "  minimizeToTray";
  if (!src.includes(anchor)) { console.log("[warn] preload 锚点未命中"); return src; }
  return src.replace(anchor, `  modalFocus: (on) => ipcRenderer.send('pet:modal-focus', !!on),\n` + anchor);
});

// 3) main.js：弹窗打开时给窗口焦点，关闭时收回
edit("main.js", (src) => {
  if (src.includes("pet:modal-focus")) return src;
  const anchor = "ipcMain.on('pet:set-interactive'";
  if (!src.includes(anchor)) { console.log("[warn] main 锚点未命中"); return src; }
  return src.replace(anchor, `ipcMain.on('pet:modal-focus', (event, on) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  try {
    win.setFocusable(true);
    if (on) {
      win.show();
      win.setAlwaysOnTop(true, 'screen-saver');
      win.focus();
      win.webContents.focus();
    } else {
      win.blur();
    }
  } catch (e) {}
});

` + anchor);
});

// 4) extras.js：弹窗开关时调用 modalFocus
edit("extras.js", (src) => {
  let out = src;
  if (!out.includes("modalFocus(true)")) {
    const anchor = "    const bodyEl = modalEl.querySelector('#dsh-pet-modal-body');";
    if (out.includes(anchor)) {
      out = out.replace(anchor, `    try { if (window.petBridge && typeof window.petBridge.modalFocus === 'function') window.petBridge.modalFocus(true); } catch (e) {}\n` + anchor);
    } else console.log("[warn] extras openModal 锚点未命中");
  }
  return out;
});
edit("extras.js", (src) => {
  if (src.includes("modalFocus(false)")) return src;
  const anchor = "  function closeModal() {";
  const i = src.indexOf(anchor);
  if (i < 0) { console.log("[warn] closeModal 锚点未命中"); return src; }
  const braceEnd = src.indexOf("\n  }", i);
  if (braceEnd < 0) return src;
  return src.slice(0, braceEnd) + "\n    try { if (window.petBridge && typeof window.petBridge.modalFocus === 'function') window.petBridge.modalFocus(false); } catch (e) {}" + src.slice(braceEnd);
});

console.log("[done] changed=" + changed);
