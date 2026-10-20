// patch_extras22.mjs —— 弹窗/时钟都按“窗口在屏幕上的可见区”布局（幂等）
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node patch_extras22.mjs <extras.js>"); process.exit(2); }
let src = readFileSync(file, "utf8");
let changed = 0;
function rep(from, to, label) {
  if (!src.includes(from)) { console.log("[skip] " + label); return; }
  src = src.split(from).join(to);
  changed += 1;
  console.log("[ok] " + label);
}

// 可见矩形计算（窗口可能有一部分在屏幕外）
const helper = `  /** 窗口在屏幕上的可见区（窗口坐标）；桌宠窗口允许超出屏幕，弹窗/时钟都要挤进可见区 */
  function visibleBox() {
    const W = Math.max(200, document.documentElement.clientWidth || window.innerWidth || 462);
    const H = Math.max(200, document.documentElement.clientHeight || window.innerHeight || 372);
    let sx = 0;
    let sy = 0;
    try { sx = Number(window.screenX) || 0; sy = Number(window.screenY) || 0; } catch (e) {}
    let sw = 0;
    let sh = 0;
    try { sw = Number(window.screen.availWidth) || 0; sh = Number(window.screen.availHeight) || 0; } catch (e) {}
    if (!(sw > 100)) sw = W + Math.max(0, sx);
    if (!(sh > 100)) sh = H + Math.max(0, sy);
    const left = Math.max(6, Math.min(W - 6, -sx + 6));
    const top = Math.max(6, Math.min(H - 6, -sy + 6));
    const right = Math.max(left + 80, Math.min(W - 6, sw - sx - 6));
    const bottom = Math.max(top + 60, Math.min(H - 6, sh - sy - 6));
    return { left, top, right, bottom, width: right - left, height: bottom - top, W, H };
  }

`;
if (!src.includes("function visibleBox()")) {
  const anchor = "  function openModal(";
  src = src.replace(anchor, helper + anchor);
  changed += 1;
  console.log("[ok] visibleBox");
}

rep(
  `    const W = Math.max(200, document.documentElement.clientWidth || window.innerWidth || 462);
    const H = Math.max(200, document.documentElement.clientHeight || window.innerHeight || 372);
    const cardW = Math.max(220, Math.min(520, W - 20));
    const cardH = Math.max(180, Math.min(600, H - 20));
    const left = Math.round(Math.max(10, Math.min((W - cardW) / 2, W - cardW - 10)));
    const top = Math.round(Math.max(10, Math.min((H - cardH) / 2, H - cardH - 10)));`,
  `    const vb = visibleBox();
    const cardW = Math.max(200, Math.min(520, vb.width));
    const cardH = Math.max(160, Math.min(600, vb.height));
    const left = Math.round(vb.left + Math.max(0, (vb.width - cardW) / 2));
    const top = Math.round(vb.top + Math.max(0, (vb.height - cardH) / 2));`,
  "弹窗按可见区居中",
);

// 整窗时钟：改成只覆盖可见区
rep(
  `    const W = Math.max(320, document.documentElement.clientWidth || window.innerWidth || 924);
    const H = Math.max(280, document.documentElement.clientHeight || window.innerHeight || 744);
    const face = Math.max(220, Math.min(W, H) - 120);`,
  `    const vb = visibleBox();
    const W = Math.max(160, vb.width);
    const H = Math.max(160, vb.height);
    const face = Math.max(160, Math.min(W, H) - 70);`,
  "时钟按可见区",
);
rep(
  `    clockEl.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;' +`,
  `    clockEl.style.cssText = 'position:absolute;left:' + Math.round(vb.left) + 'px;top:' + Math.round(vb.top) + 'px;' +
      'width:' + Math.round(vb.width) + 'px;height:' + Math.round(vb.height) + 'px;border-radius:24px;overflow:hidden;' +
      'z-index:2147483600;display:flex;align-items:center;justify-content:center;' +`,
  "时钟定位到可见区",
);

// 拖动边界也用可见区
rep(
  `        const nx = Math.min(Math.max(0, ox + e2.clientX - sx), Math.max(0, W - card.offsetWidth));
        const ny = Math.min(Math.max(0, oy + e2.clientY - sy), Math.max(0, H - card.offsetHeight));`,
  `        const nx = Math.min(Math.max(vb.left, ox + e2.clientX - sx), Math.max(vb.left, vb.right - card.offsetWidth));
        const ny = Math.min(Math.max(vb.top, oy + e2.clientY - sy), Math.max(vb.top, vb.bottom - card.offsetHeight));`,
  "拖动限制在可见区",
);

writeFileSync(file, src, "utf8");
console.log("[done] changed=" + changed);
