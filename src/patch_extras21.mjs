// patch_extras21.mjs —— 弹窗尺寸/整窗时钟/月度日历多选（幂等）
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node patch_extras21.mjs <extras.js>"); process.exit(2); }
let src = readFileSync(file, "utf8");
let changed = 0;
function rep(from, to, label) {
  if (!src.includes(from)) { console.log("[skip] " + label); return; }
  src = src.split(from).join(to);
  changed += 1;
  console.log("[ok] " + label);
}

// ---------- 1) 填满整窗的报时时钟（把桌宠本体变成时钟） ----------
const oldShow = src.slice(src.indexOf("  function showClock() {"), src.indexOf("  function hideClock() {"));
if (oldShow && !oldShow.includes("dsh-pet-clock-full")) {
  const newShow = `  function showClock() {
    const root = ensureOverlayRoot();
    if (clockEl) clockEl.remove();
    const W = Math.max(320, document.documentElement.clientWidth || window.innerWidth || 924);
    const H = Math.max(280, document.documentElement.clientHeight || window.innerHeight || 744);
    const face = Math.max(220, Math.min(W, H) - 120);
    clockEl = document.createElement('div');
    clockEl.setAttribute('data-dsh-pet-clock-full', '1');
    clockEl.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;' +
      'background:radial-gradient(circle at 50% 42%,rgba(196,226,255,.96),rgba(120,173,232,.94) 60%,rgba(38,78,132,.94));' +
      'backdrop-filter:blur(6px);animation:dshpet-clock-in .3s ease-out;font-family:"Microsoft YaHei UI",sans-serif';
    clockEl.innerHTML = clockMarkup(new Date(), face);
    root.appendChild(clockEl);
    if (!document.getElementById('dsh-pet-clock-style')) {
      const st = document.createElement('style');
      st.id = 'dsh-pet-clock-style';
      st.textContent = '@keyframes dshpet-clock-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}' +
        '@keyframes dshpet-clock-tick{0%{opacity:.4}100%{opacity:1}}';
      document.head.appendChild(st);
    }
    if (clockTimer) clearTimeout(clockTimer);
    clockTimer = setTimeout(hideClock, 60000);
  }

`;
  src = src.replace(oldShow, newShow);
  changed += 1;
  console.log("[ok] 整窗报时钟");
}

// ---------- 2) clockMarkup 支持 size ----------
rep("  function clockMarkup(now) {", "  function clockMarkup(now, face) {\n    const F = Math.max(200, Math.round(face || 216));\n    const scale = F / 216;", "clockMarkup 参数");
rep(
  "'<div style=\"position:relative;width:300px;height:340px;margin:0 auto;' +",
  "'<div style=\"position:relative;width:' + Math.round(300 * scale) + 'px;height:' + Math.round(340 * scale) + 'px;margin:0 auto;' +",
  "clockMarkup 外框尺寸",
);
rep(
  "'<div style=\"position:relative;margin-top:12px;width:216px;height:216px;border-radius:50%;' +",
  "'<div style=\"position:relative;margin-top:' + Math.round(12 * scale) + 'px;width:' + F + 'px;height:' + F + 'px;border-radius:50%;' +",
  "clockMarkup 表盘尺寸",
);
rep(
  "'<div id=\"dsh-pet-clock-digits\" style=\"margin-top:14px;font-size:44px;",
  "'<div id=\"dsh-pet-clock-digits\" style=\"margin-top:' + Math.round(14 * scale) + 'px;font-size:' + Math.round(44 * scale) + 'px;",
  "clockMarkup 数字尺寸",
);

// ---------- 3) 弹窗尺寸：按 CSS 视口算，保证完整可见 ----------
rep(
  `    const W = window.innerWidth || 924;
    const H = window.innerHeight || 744;
    const cardW = Math.max(280, Math.min(520, W - 40));
    const cardH = Math.max(200, Math.min(600, H - 40));
    const left = Math.round(Math.max(12, (W - cardW) / 2));
    const top = Math.round(Math.max(12, Math.min((H - cardH) / 2, H - cardH - 12)));`,
  `    const W = Math.max(200, document.documentElement.clientWidth || window.innerWidth || 462);
    const H = Math.max(200, document.documentElement.clientHeight || window.innerHeight || 372);
    const cardW = Math.max(220, Math.min(520, W - 20));
    const cardH = Math.max(180, Math.min(600, H - 20));
    const left = Math.round(Math.max(10, Math.min((W - cardW) / 2, W - cardW - 10)));
    const top = Math.round(Math.max(10, Math.min((H - cardH) / 2, H - cardH - 10)));`,
  "弹窗尺寸按视口",
);

// ---------- 4) 月度：换成页内日历网格多选（不再用原生日期弹窗） ----------
rep(
  `          field('每月几号（用日历选，可多选）',
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<input id="td-md-date" type="date" value="' + ymd + '" style="' + inputStyle + ';flex:1 1 150px;min-width:140px">' +
            '<button type="button" id="td-md-add" style="' + btnGhost + '">添加这一天</button></div>' +
            '<div id="td-mds" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>' +
            '<div style="font-size:12px;color:#6b8fb3;margin-top:6px">当月没有该日（例如 2 月 30 号）时，自动用当月最后一天。</div>') +`,
  `          field('每月几号（点日历多选）',
            '<div id="td-md-cal" style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px"></div>' +
            '<div id="td-mds" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>' +
            '<div style="font-size:12px;color:#6b8fb3;margin-top:6px">点数字即可选中/取消，可多选；当月没有该日（如 2 月 30 号）自动用当月最后一天。</div>') +`,
  "月度日历网格",
);

rep(
  `      const renderMds = () => {
        const box = body.querySelector('#td-mds');
        box.innerHTML = monthdays.map((d) => '<span style="background:#e2effc;border-radius:10px;padding:3px 8px;font-size:13px">' + d + ' 号</span>').join('');
      };
      body.querySelector('#td-md-add').onclick = () => {
        const v = body.querySelector('#td-md-date').value;
        if (!v) return;
        const d = Number(v.slice(8, 10));
        if (d >= 1 && d <= 31 && monthdays.indexOf(d) < 0) monthdays.push(d);
        monthdays.sort((a, b) => a - b);
        renderMds();
      };`,
  `      const renderMds = () => {
        const box = body.querySelector('#td-mds');
        box.innerHTML = monthdays.map((d) => '<span style="background:#e2effc;border-radius:10px;padding:3px 8px;font-size:13px">' + d + ' 号</span>').join('') ||
          '<span style="color:#8aa8c4;font-size:12px">还没选</span>';
        body.querySelectorAll('[data-md]').forEach((b) => {
          const d = Number(b.getAttribute('data-md'));
          const on = monthdays.indexOf(d) >= 0;
          b.style.background = on ? 'linear-gradient(180deg,#5fa7ea,#3b7fc4)' : '#fff';
          b.style.color = on ? '#fff' : '#2b5b8f';
        });
      };
      const cal = body.querySelector('#td-md-cal');
      cal.innerHTML = Array.from({ length: 31 }, (_, i) => i + 1)
        .map((d) => '<button type="button" data-md="' + d + '" style="' + btnGhost + ';padding:6px 0;font-size:13px">' + d + '</button>')
        .join('');
      cal.querySelectorAll('[data-md]').forEach((b) => {
        b.onclick = () => {
          const d = Number(b.getAttribute('data-md'));
          const at = monthdays.indexOf(d);
          if (at >= 0) monthdays.splice(at, 1); else monthdays.push(d);
          monthdays.sort((a, b2) => a - b2);
          renderMds();
        };
      });
      renderMds();`,
  "月度日历交互",
);

writeFileSync(file, src, "utf8");
console.log("[done] changed=" + changed);
