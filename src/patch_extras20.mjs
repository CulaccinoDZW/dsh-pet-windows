// patch_extras20.mjs —— 待办弹窗交互/多选重复/改名/API Key（幂等）
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
if (!target) { console.error("usage: node patch_extras20.mjs <path to extras.js>"); process.exit(2); }
let src = readFileSync(target, "utf8");
let changed = 0;

function rep(startMarker, endMarker, next, label) {
  const i = src.indexOf(startMarker);
  if (i < 0) { console.log("[skip] 找不到锚点: " + label); return; }
  const j = src.indexOf(endMarker, i);
  if (j < 0) { console.log("[skip] 找不到结束锚点: " + label); return; }
  src = src.slice(0, i) + next + src.slice(j);
  changed += 1;
  console.log("[ok] " + label);
}

// ---------- 1) 弹窗：整窗可交互 + 视口夹取 + 可拖动 ----------
rep(
  "  function openModal(title, bodyHtml, onMount) {",
  "  const inputStyle =",
  `  function openModal(title, bodyHtml, onMount) {
    closeModal();
    const root = ensureOverlayRoot();
    modalEl = document.createElement('div');
    modalEl.style.cssText = 'position:absolute;inset:0;pointer-events:auto;background:transparent';
    const W = window.innerWidth || 924;
    const H = window.innerHeight || 744;
    const cardW = Math.max(280, Math.min(520, W - 40));
    const cardH = Math.max(200, Math.min(600, H - 40));
    const left = Math.round(Math.max(12, (W - cardW) / 2));
    const top = Math.round(Math.max(12, Math.min((H - cardH) / 2, H - cardH - 12)));
    modalEl.innerHTML =
      '<div id="dsh-pet-modal-card" style="position:absolute;left:' + left + 'px;top:' + top + 'px;width:' + cardW + 'px;max-height:' + cardH + 'px;' +
      'display:flex;flex-direction:column;box-sizing:border-box;background:linear-gradient(170deg,#f7fbff,#e4f0fd);' +
      'border:2px solid rgba(255,255,255,.95);border-radius:20px;box-shadow:0 18px 44px rgba(12,34,64,.35);' +
      'font-family:"Microsoft YaHei UI",sans-serif;color:#16375e;padding:14px 16px 12px">' +
      '<div id="dsh-pet-modal-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;cursor:move;user-select:none">' +
      '<div style="font-size:17px;font-weight:800;letter-spacing:.5px;white-space:normal;word-break:break-all;line-height:1.3">' + title + '</div>' +
      '<button id="dsh-pet-modal-x" style="flex:0 0 auto;border:0;background:#cfe4fb;color:#1b4a7d;width:26px;height:26px;border-radius:13px;font-size:15px;cursor:pointer">×</button>' +
      '</div><div id="dsh-pet-modal-body" style="overflow:auto;flex:1 1 auto"></div></div>';
    root.appendChild(modalEl);
    setInteractive(true);
    try {
      if (window.petBridge && typeof window.petBridge.setInputRegions === 'function') {
        window.petBridge.setInputRegions({ dragging: false, rects: [{ x: 0, y: 0, width: W, height: H }] });
        if (typeof window.petBridge.setInputBusy === 'function') window.petBridge.setInputBusy(true);
      }
    } catch (e) {}
    const bodyEl = modalEl.querySelector('#dsh-pet-modal-body');
    bodyEl.innerHTML = bodyHtml;
    modalEl.querySelector('#dsh-pet-modal-x').onclick = closeModal;
    // 拖动标题栏移动卡片
    const card = modalEl.querySelector('#dsh-pet-modal-card');
    const head = modalEl.querySelector('#dsh-pet-modal-head');
    head.addEventListener('mousedown', (ev) => {
      if (ev.target && ev.target.id === 'dsh-pet-modal-x') return;
      const sx = ev.clientX;
      const sy = ev.clientY;
      const ox = parseInt(card.style.left, 10) || 0;
      const oy = parseInt(card.style.top, 10) || 0;
      const move = (e2) => {
        const nx = Math.min(Math.max(0, ox + e2.clientX - sx), Math.max(0, W - card.offsetWidth));
        const ny = Math.min(Math.max(0, oy + e2.clientY - sy), Math.max(0, H - card.offsetHeight));
        card.style.left = nx + 'px';
        card.style.top = ny + 'px';
      };
      const up = () => {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    });
    if (typeof onMount === 'function') onMount(bodyEl);
    return bodyEl;
  }

`,
  "弹窗交互/夹取/拖动",
);

// ---------- 2) 添加待办：重复规则多选 ----------
rep(
  "  function openTodoAdd() {",
  "  function repeatText(",
  `  function openTodoAdd() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const hhmm = pad(now.getHours()) + ':' + pad(now.getMinutes());
    const ymd = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    openModal('添加待办', '', (body) => {
      const wdBtn = (i, name) =>
        '<button type="button" data-wd="' + i + '" style="' + btnGhost + ';padding:4px 10px;font-size:13px">周' + name + '</button>';
      body.innerHTML =
        field('标题', '<input id="td-title" style="' + inputStyle + '" placeholder="例如：给客户回电话">') +
        field('详情（可选）', '<textarea id="td-detail" rows="2" style="' + inputStyle + ';resize:vertical" placeholder="到点点击可以看到的内容"></textarea>') +
        '<div id="td-once-wrap">' + field('日期（仅“不重复”时生效）', '<input id="td-date" type="date" value="' + ymd + '" style="' + inputStyle + '">') + '</div>' +
        field('时间', '<input id="td-time" type="time" value="' + hhmm + '" style="' + inputStyle + '">') +
        field('重复', '<select id="td-repeat" style="' + inputStyle + '">' +
          '<option value="none">不重复（只提醒一次）</option>' +
          '<option value="daily">每天</option>' +
          '<option value="weekly">每周（可多选星期几）</option>' +
          '<option value="monthly">每月（日历里选多天）</option></select>') +
        '<div id="td-weekly-wrap" style="display:none">' +
          field('每周几（可多选）', '<div id="td-weekdays" style="display:flex;flex-wrap:wrap;gap:6px">' +
            wdBtn(1, '一') + wdBtn(2, '二') + wdBtn(3, '三') + wdBtn(4, '四') + wdBtn(5, '五') + wdBtn(6, '六') + wdBtn(0, '日') +
            '</div>') + '</div>' +
        '<div id="td-monthly-wrap" style="display:none">' +
          field('每月几号（用日历选，可多选）',
            '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
            '<input id="td-md-date" type="date" value="' + ymd + '" style="' + inputStyle + ';flex:1 1 150px;min-width:140px">' +
            '<button type="button" id="td-md-add" style="' + btnGhost + '">添加这一天</button></div>' +
            '<div id="td-mds" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>' +
            '<div style="font-size:12px;color:#6b8fb3;margin-top:6px">当月没有该日（例如 2 月 30 号）时，自动用当月最后一天。</div>') +
        '</div>' +
        '<div id="td-err" style="color:#c0392b;font-size:13px;min-height:18px;margin:4px 0 8px"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:10px">' +
        '<button type="button" id="td-cancel" style="' + btnGhost + '">取消</button>' +
        '<button type="button" id="td-save" style="' + btnStyle + '">保存</button></div>';

      const weekdays = [];
      const monthdays = [];
      const rep = body.querySelector('#td-repeat');
      const syncRep = () => {
        const v = rep.value;
        body.querySelector('#td-once-wrap').style.display = v === 'none' ? '' : 'none';
        body.querySelector('#td-weekly-wrap').style.display = v === 'weekly' ? '' : 'none';
        body.querySelector('#td-monthly-wrap').style.display = v === 'monthly' ? '' : 'none';
      };
      rep.onchange = syncRep;
      syncRep();
      body.querySelectorAll('[data-wd]').forEach((b) => {
        b.onclick = () => {
          const i = Number(b.getAttribute('data-wd'));
          const at = weekdays.indexOf(i);
          if (at >= 0) weekdays.splice(at, 1); else weekdays.push(i);
          b.style.background = at >= 0 ? '#fff' : 'linear-gradient(180deg,#5fa7ea,#3b7fc4)';
          b.style.color = at >= 0 ? '#2b5b8f' : '#fff';
        };
      });
      const renderMds = () => {
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
      };
      body.querySelector('#td-cancel').onclick = closeModal;
      body.querySelector('#td-save').onclick = () => {
        const title = (body.querySelector('#td-title').value || '').trim();
        const err = body.querySelector('#td-err');
        if (!title) { err.textContent = '请填写标题'; return; }
        const rv = rep.value;
        if (rv === 'weekly' && !weekdays.length) { err.textContent = '请至少选择一天（周几）'; return; }
        if (rv === 'monthly' && !monthdays.length) { err.textContent = '请至少用日历添加一天'; return; }
        const payload = {
          title,
          detail: (body.querySelector('#td-detail').value || '').trim(),
          date: body.querySelector('#td-date').value,
          time: body.querySelector('#td-time').value || '09:00',
          repeat: rv,
          weekdays: rv === 'weekly' ? weekdays.slice() : [],
          monthdays: rv === 'monthly' ? monthdays.slice() : [],
        };
        jpost('/todo/add', payload).then((res) => {
          if (!res || res.ok !== true) { err.textContent = (res && res.message) || '保存失败'; return; }
          closeModal();
          if (S0.sprite && S0.sprite.say) S0.sprite.say('待办已记下：' + title);
        });
      };
    });
  }

`,
  "添加待办（多选重复）",
);

// ---------- 3) repeatText 支持多选 ----------
rep(
  "  function repeatText(t) {",
  "  function openTodoList(",
  `  function repeatText(t) {
    const rep = t.repeat || 'none';
    const wdName = ['日', '一', '二', '三', '四', '五', '六'];
    const fmt = (arr, unit) => arr.slice().sort((a, b) => a - b).map((n) => n + unit).join('、');
    if (rep === 'daily') return '每天 ' + t.time;
    if (rep === 'weekly') {
      const arr = Array.isArray(t.weekdays) && t.weekdays.length ? t.weekdays : [Number(t.weekday) || 0];
      return '每周' + arr.slice().sort().map((n) => wdName[Number(n) % 7]).join('、') + ' ' + t.time;
    }
    if (rep === 'monthly') {
      const arr = Array.isArray(t.monthdays) && t.monthdays.length ? t.monthdays : [Number(t.monthday) || 1];
      return '每月 ' + fmt(arr, ' 号') + ' ' + t.time;
    }
    return (t.date || '') + ' ' + t.time;
  }

`,
  "repeatText 多选",
);

// ---------- 4) 改名 / API Key 弹窗 ----------
if (!src.includes("function openRename")) {
  const marker = "  // ---------- 外部事件（轮询 /state 的扩展 section） ----------";
  const add = `  // ---------- 改名 / API Key ----------
  function openRename() {
    const cur = (S0.sprite && S0.sprite.pet && S0.sprite.pet.name) || '';
    openModal('给桌宠改个名字', '', (body) => {
      body.innerHTML =
        field('新名字（所有自称都会用它）', '<input id="pn-name" style="' + inputStyle + '" maxlength="24" value="' + escapeAttr(cur) + '">') +
        '<div id="pn-err" style="color:#c0392b;font-size:13px;min-height:18px;margin:4px 0 8px"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:10px">' +
        '<button type="button" id="pn-cancel" style="' + btnGhost + '">取消</button>' +
        '<button type="button" id="pn-save" style="' + btnStyle + '">保存</button></div>';
      body.querySelector('#pn-cancel').onclick = closeModal;
      body.querySelector('#pn-save').onclick = () => {
        const name = (body.querySelector('#pn-name').value || '').trim();
        const err = body.querySelector('#pn-err');
        if (!name) { err.textContent = '名字不能为空'; return; }
        jpost('/pet/name', { name }).then((res) => {
          if (!res || res.ok !== true) { err.textContent = (res && res.message) || '保存失败'; return; }
          closeModal();
          if (S0.sprite && S0.sprite.say) S0.sprite.say('好呀，以后叫我' + name + '～');
        });
      };
    });
  }

  function openApiKey() {
    openModal('填写 DeepSeek API Key', '', (body) => {
      body.innerHTML =
        field('API Key（只写在本机 ai-config.json，DSH 未运行时会用它直连）',
          '<input id="ak-val" style="' + inputStyle + '" placeholder="sk-..." autocomplete="off">') +
        '<div id="ak-tip" style="font-size:12px;color:#5b82ab;margin:2px 0 8px">DSH 在跑时优先走 DSH；DSH 不在时用这个 key 直连。</div>' +
        '<div id="ak-err" style="color:#c0392b;font-size:13px;min-height:18px;margin:4px 0 8px"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:10px">' +
        '<button type="button" id="ak-cancel" style="' + btnGhost + '">取消</button>' +
        '<button type="button" id="ak-save" style="' + btnStyle + '">保存</button></div>';
      jget('/ai/key').then((res) => {
        if (res && res.ok && res.masked) body.querySelector('#ak-tip').textContent = '当前已保存：' + res.masked + '（留空保存表示清除）';
      });
      body.querySelector('#ak-cancel').onclick = closeModal;
      body.querySelector('#ak-save').onclick = () => {
        const key = (body.querySelector('#ak-val').value || '').trim();
        const err = body.querySelector('#ak-err');
        jpost('/ai/key', { key }).then((res) => {
          if (!res || res.ok !== true) { err.textContent = (res && res.message) || '保存失败'; return; }
          closeModal();
          if (S0.sprite && S0.sprite.say) S0.sprite.say(key ? 'API Key 已经记下了，随时可以直连聊天～' : '已清除 API Key。');
        });
      };
    });
  }

`;
  src = src.replace(marker, add + marker);
  changed += 1;
  console.log("[ok] 改名 / API Key 弹窗");
}

// ---------- 5) 导出 ----------
if (!src.includes("E.openRename = openRename;")) {
  src = src.replace("  E.openTodoDetail = openTodoDetail;", "  E.openTodoDetail = openTodoDetail;\n  E.openRename = openRename;\n  E.openApiKey = openApiKey;");
  changed += 1;
  console.log("[ok] 导出 openRename / openApiKey");
}

writeFileSync(target, src, "utf8");
console.log("[done] changed=" + changed);
