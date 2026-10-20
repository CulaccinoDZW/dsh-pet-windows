/**
 * extras.js —— DSH 桌宠「报时 / 待办 / 提示音 · 通知播报」扩展（patch_v6 注入，独立文件）。
 *
 * 设计原则：不改原有宠物行为，只在旁边加功能：
 *   - 每 30 分钟整点报时：播 sounds/chime 里的提示音 + 弹出鲸鱼娘风格时钟（60 秒，pointer-events:none，不挡右键菜单）。
 *   - 待办：右键菜单「待办」→ 添加 / 列表 / 清空已完成；到点由一个全屏透明浮层把宠物放大到满屏居中播放「抽陀螺」，
 *     并显示待办标题 +「点击查看详情」。
 *   - 系统通知播报：宿主收到 /notify（来自 MSIX 通知监听器）或 /broadcast 时播 sounds/notify 提示音并让桌宠说话。
 */
'use strict';
(function () {
  const E = (window.__dshPetExtras = window.__dshPetExtras || {});
  const S0 = { sprite: null, armed: false, started: false, counters: Object.create(null), idx: Object.create(null), lastPoll: 0 };
  let clockTimer = 0;
  let clockEl = null;
  let modalEl = null;

  function petId() {
    return S0.sprite && S0.sprite.pet ? S0.sprite.pet.id : 'main';
  }
  function base() {
    return typeof BASE === 'string' ? BASE : '/dsh-pet-7340';
  }
  function jget(path) {
    return fetch(base() + path, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  function jpost(path, body) {
    return fetch(base() + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then((r) => r.json()).catch(() => null);
  }

  // ---------- 提示音 ----------
  function playSfx(kind) {
    jget('/sfx?kind=' + encodeURIComponent(kind)).then((res) => {
      const files = res && Array.isArray(res.files) ? res.files : [];
      if (!files.length) {
        console.warn('[dsh-pet] sounds/' + kind + ' 目录里没有可播放的音频文件');
        return;
      }
      const i = (S0.idx[kind] || 0) % files.length;
      S0.idx[kind] = i + 1;
      try {
        const audio = new Audio(base() + '/sfx/file?kind=' + encodeURIComponent(kind) + '&name=' + encodeURIComponent(files[i]));
        audio.volume = 0.95;
        const p = audio.play();
        if (p && p.catch) p.catch((e) => console.warn('[dsh-pet] 播放提示音失败:', e && e.message));
      } catch (e) {
        console.warn('[dsh-pet] 播放提示音异常:', e);
      }
    });
  }

  // ---------- 整点报时时钟 ----------
  function ensureOverlayRoot() {
    let root = document.getElementById('dsh-pet-extras-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'dsh-pet-extras-root';
      root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;overflow:visible';
      document.body.appendChild(root);
    }
    return root;
  }

  function clockMarkup(now, face) {
    const F = Math.max(200, Math.round(face || 216));
    const scale = F / 216;
    const h = now.getHours();
    const m = now.getMinutes();
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const hourDeg = ((h % 12) + m / 60) * 30;
    const minDeg = m * 6;
    return (
      '<div style="position:relative;width:' + Math.round(300 * scale) + 'px;height:' + Math.round(340 * scale) + 'px;margin:0 auto;' +
      'background:linear-gradient(165deg,rgba(226,242,255,.97),rgba(166,208,247,.97) 55%,rgba(120,173,232,.97));' +
      'border-radius:32px;border:2px solid rgba(255,255,255,.9);box-shadow:0 18px 48px rgba(24,60,110,.35),inset 0 1px 0 rgba(255,255,255,.9);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding-top:22px;font-family:"Microsoft YaHei UI",sans-serif">' +
      '<div style="font-size:15px;letter-spacing:3px;color:#2f5f96;font-weight:700">鲸 鱼 娘 报 时</div>' +
      '<div style="position:relative;margin-top:' + Math.round(12 * scale) + 'px;width:' + F + 'px;height:' + F + 'px;border-radius:50%;' +
      'background:radial-gradient(circle at 50% 38%,#2f5f96 0%,#1d3f6b 62%,#142d4f 100%);' +
      'box-shadow:0 8px 22px rgba(10,32,64,.45),inset 0 0 0 6px rgba(180,215,250,.55)">' +
      '<div style="position:absolute;inset:16px;border-radius:50%;border:1px dashed rgba(180,215,250,.45)"></div>' +
      '<div style="position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:#bfe1ff;box-shadow:0 0 10px #9ed0ff"></div>' +
      '<div style="position:absolute;left:50%;top:50%;width:6px;height:64px;margin-left:-3px;margin-top:-64px;transform-origin:50% 100%;transform:rotate(' +
      hourDeg + 'deg);border-radius:6px;background:linear-gradient(180deg,#eaf6ff,#a9d3ff)"></div>' +
      '<div style="position:absolute;left:50%;top:50%;width:4px;height:88px;margin-left:-2px;margin-top:-88px;transform-origin:50% 100%;transform:rotate(' +
      minDeg + 'deg);border-radius:4px;background:linear-gradient(180deg,#ffffff,#7fbdf5)"></div>' +
      '<div style="position:absolute;left:50%;bottom:6px;transform:translateX(-50%);font-size:26px">🐳</div>' +
      '</div>' +
      '<div id="dsh-pet-clock-digits" style="margin-top:' + Math.round(14 * scale) + 'px;font-size:' + Math.round(44 * scale) + 'px;font-weight:800;color:#16375e;letter-spacing:2px;font-variant-numeric:tabular-nums">' +
      hh + ':' + mm + '</div>' +
      '<div style="margin-top:2px;font-size:13px;color:#3d6b9c;letter-spacing:1px">整点报时 · 鲸鱼娘陪你</div>' +
      '</div>'
    );
  }

  function showClock() {
    const root = ensureOverlayRoot();
    if (clockEl) clockEl.remove();
    const vb = visibleBox();
    // 报时面板尺寸与“设定的桌宠大小”一致
    let petSize = 462;
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--pet-size');
      const n = parseFloat(raw);
      if (isFinite(n) && n > 120) petSize = n;
    } catch (e) {}
    // 和桌宠本体差不多大：按 petSize 等比缩到本体尺寸的 ~0.58
    const cardW = Math.max(180, Math.min(Math.round(petSize * 0.62), vb.width - 8));
    const cardH = Math.max(200, Math.min(Math.round(petSize * 0.74), vb.height - 8));
    const scale = Math.max(0.3, Math.min(cardW / 300, cardH / 340));
    const face = Math.round(216 * scale);
    clockEl = document.createElement('div');
    clockEl.setAttribute('data-dsh-pet-clock-full', '1');
    clockEl.style.cssText = 'position:absolute;left:' + Math.round(vb.left + (vb.width - cardW) / 2) + 'px;top:' + Math.round(vb.top + (vb.height - cardH) / 2) + 'px;' +
      'width:' + Math.round(cardW) + 'px;height:' + Math.round(cardH) + 'px;border-radius:24px;overflow:hidden;' +
      'z-index:2147483600;display:flex;align-items:center;justify-content:center;' +
      'background:radial-gradient(circle at 50% 42%,rgba(196,226,255,.96),rgba(120,173,232,.94) 60%,rgba(38,78,132,.94));' +
      'backdrop-filter:blur(6px);animation:dshpet-clock-in .3s ease-out;font-family:"Microsoft YaHei UI",sans-serif';
    clockEl.innerHTML = clockMarkup(new Date(), face) +
      '<button id="dsh-pet-clock-x" title="关闭" style="position:absolute;right:' + Math.round(8 * scale) + 'px;top:' + Math.round(8 * scale) + 'px;' +
      'width:' + Math.round(26 * scale) + 'px;height:' + Math.round(26 * scale) + 'px;border:0;border-radius:50%;cursor:pointer;' +
      'background:rgba(255,255,255,.82);color:#1b4a7d;font-size:' + Math.round(15 * scale) + 'px;line-height:1;pointer-events:auto">×</button>';
    root.appendChild(clockEl);
    // clock-interactive-v13：报时面板也要能点（否则整个窗口是穿透的，× 点不到）
    try {
      if (window.petBridge && typeof window.petBridge.modalOpen === 'function') window.petBridge.modalOpen(true);
      if (window.petBridge && typeof window.petBridge.setInputRegions === 'function') window.petBridge.setInputRegions({ dragging: false, rects: [{ x: 0, y: 0, width: W, height: H }] });
      if (window.petBridge && typeof window.petBridge.setInputBusy === 'function') window.petBridge.setInputBusy(true);
    } catch (e) {}
    const clockX = clockEl.querySelector('#dsh-pet-clock-x');
    if (clockX) clockX.onclick = (e) => { e.stopPropagation(); hideClock(); };
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

  function hideClock() {
    if (clockTimer) {
      clearTimeout(clockTimer);
      clockTimer = 0;
    }
    if (clockEl) {
      clockEl.remove();
      clockEl = null;
    }
    // clock-interactive-off-v13：恢复穿透
    try {
      if (window.petBridge && typeof window.petBridge.setInputBusy === 'function') window.petBridge.setInputBusy(false);
      if (window.petBridge && typeof window.petBridge.modalOpen === 'function') window.petBridge.modalOpen(false);
    } catch (e) {}
  }

  // ---------- 通用弹窗 ----------
  function setInteractive(on) {
    try {
      if (window.petBridge) {
        if (typeof window.petBridge.setInputBusy === 'function') window.petBridge.setInputBusy(!!on);
        if (!on && typeof window.petBridge.setInputRegions === 'function') {
          window.petBridge.setInputRegions({ dragging: false, rects: [] });
        }
      }
    } catch (e) {}
  }

  function publishModalRegions(card) {
    try {
      if (!card || !window.petBridge || typeof window.petBridge.setInputRegions !== 'function') return;
      const r = card.getBoundingClientRect();
      window.petBridge.setInputRegions({ dragging: false, rects: [{ x: r.left, y: r.top, width: r.width, height: r.height }] });
      if (typeof window.petBridge.setInputBusy === 'function') window.petBridge.setInputBusy(true);
    } catch (e) {}
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
      setInteractive(false);
    }
    try { if (window.petBridge && typeof window.petBridge.modalFocus === 'function') window.petBridge.modalFocus(false); } catch (e) {}
    try { if (window.petBridge && typeof window.petBridge.modalOpen === 'function') window.petBridge.modalOpen(false); } catch (e) {}
  }

  /** 窗口在屏幕上的可见区（窗口坐标）；桌宠窗口允许超出屏幕，弹窗/时钟都要挤进可见区 */
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

  // 输入框必须可选中/可编辑（整窗 user-select:none 会连带影响）
  if (!document.getElementById('dsh-pet-input-style')) {
    const st = document.createElement('style');
    st.id = 'dsh-pet-input-style';
    st.textContent = '[data-dsh-pet-modal] input,[data-dsh-pet-modal] textarea,[data-dsh-pet-modal] select{-webkit-user-select:text!important;user-select:text!important;pointer-events:auto!important;}' +
      '[data-dsh-pet-modal] *{-webkit-app-region:no-drag!important;}';
    (document.head || document.documentElement).appendChild(st);
  }
  function openModal(title, bodyHtml, onMount) {
    closeModal();
    const root = ensureOverlayRoot();
    modalEl = document.createElement('div');
    modalEl.style.cssText = 'position:absolute;inset:0;pointer-events:auto;background:transparent';
    const vb = visibleBox();
    const cardW = Math.max(200, Math.min(520, vb.width));
    const cardH = Math.max(160, Math.min(600, vb.height));
    const left = Math.round(vb.left + Math.max(0, (vb.width - cardW) / 2));
    const top = Math.round(vb.top + Math.max(0, (vb.height - cardH) / 2));
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
    try { if (window.petBridge && typeof window.petBridge.modalFocus === 'function') window.petBridge.modalFocus(true); } catch (e) {}
    try { if (window.petBridge && typeof window.petBridge.modalOpen === 'function') window.petBridge.modalOpen(true); } catch (e) {}
    try { if (window.petBridge && typeof window.petBridge.setInteractive === 'function') window.petBridge.setInteractive(true); } catch (e) {}
    const bodyEl = modalEl.querySelector('#dsh-pet-modal-body');
    // auto-focus-v9：打开就能直接打字
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
        const nx = Math.min(Math.max(vb.left, ox + e2.clientX - sx), Math.max(vb.left, vb.right - card.offsetWidth));
        const ny = Math.min(Math.max(vb.top, oy + e2.clientY - sy), Math.max(vb.top, vb.bottom - card.offsetHeight));
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
    setTimeout(() => { try { const f = bodyEl.querySelector('input,textarea,select'); if (f) f.focus(); } catch (e) {} }, 60); // auto-focus-focus
    return bodyEl;
  }

  const inputStyle = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #b8d4f0;border-radius:10px;background:#fff;' +
    'font-family:inherit;font-size:14px;color:#16375e;outline:none';
  const btnStyle = 'border:0;border-radius:10px;padding:9px 18px;font-size:14px;font-weight:700;cursor:pointer;' +
    'background:linear-gradient(180deg,#5fa7ea,#3b7fc4);color:#fff;box-shadow:0 6px 14px rgba(40,100,170,.35)';
  const btnGhost = 'border:1px solid #b8d4f0;border-radius:10px;padding:9px 16px;font-size:14px;cursor:pointer;background:#fff;color:#2b5b8f';

  function field(label, inner) {
    return '<div style="margin-bottom:10px"><div style="font-size:13px;color:#3d6b9c;margin-bottom:4px">' + label + '</div>' + inner + '</div>';
  }

  function openTodoAdd() {
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
          field('每月几号（点日历多选）',
            '<div id="td-md-cal" style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px"></div>' +
            '<div id="td-mds" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>' +
            '<div style="font-size:12px;color:#6b8fb3;margin-top:6px">点数字即可选中/取消，可多选；当月没有该日（如 2 月 30 号）自动用当月最后一天。</div>') +
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
      renderMds();
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

  function repeatText(t) {
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

  function openTodoList() {
    jget('/todo').then((res) => {
      const todos = (res && Array.isArray(res.todos) ? res.todos : []).filter((t) => !t.done);
      const rows = todos.length
        ? todos.map((t) => '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px dashed #cfe1f3">' +
            '<div style="flex:1"><div style="font-size:14px;font-weight:700">' + escapeHtml(t.title) + '</div>' +
            '<div style="font-size:12px;color:#5b82ab;margin-top:2px">' + escapeHtml(repeatText(t)) + '</div></div>' +
            '<button data-done="' + escapeAttr(t.id) + '" style="' + btnGhost + ';padding:5px 10px;font-size:12px">完成</button>' +
            '<button data-del="' + escapeAttr(t.id) + '" style="' + btnGhost + ';padding:5px 10px;font-size:12px;color:#b03a2e">删除</button></div>').join('')
        : '<div style="color:#6b8fb3;font-size:14px;padding:14px 0">还没有待办，右键菜单 → 待办 → 添加待办。</div>';
      const body = openModal('待办列表', rows);
      body.querySelectorAll('[data-done]').forEach((b) => {
        b.onclick = () => jpost('/todo/done', { id: b.getAttribute('data-done') }).then(() => { closeModal(); openTodoList(); });
      });
      body.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = () => jpost('/todo/delete', { id: b.getAttribute('data-del') }).then(() => { closeModal(); openTodoList(); });
      });
    });
  }

  function openTodoDetail(id) {
    jget('/todo').then((res) => {
      const todo = (res && Array.isArray(res.todos) ? res.todos : []).find((t) => String(t.id) === String(id));
      if (!todo) {
        openTodoList();
        return;
      }
      const body = openModal('待办详情',
        '<div style="font-size:20px;font-weight:800;margin-bottom:8px">' + escapeHtml(todo.title) + '</div>' +
        '<div style="font-size:13px;color:#3d6b9c;margin-bottom:12px">提醒时间：' + escapeHtml(repeatText(todo)) + '</div>' +
        '<div style="font-size:14px;line-height:1.7;white-space:pre-wrap;background:#fff;border-radius:12px;padding:12px;border:1px solid #cfe1f3">' +
        (todo.detail ? escapeHtml(todo.detail) : '（没有填写详情）') + '</div>',
        (bodyEl) => {
          const bar = document.createElement('div');
          bar.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:14px';
          bar.innerHTML = '<button id="td-done" style="' + btnStyle + '">完成</button><button id="td-close" style="' + btnGhost + '">关闭</button>';
          bodyEl.appendChild(bar);
          bar.querySelector('#td-done').onclick = () => jpost('/todo/done', { id: todo.id }).then(() => closeModal());
          bar.querySelector('#td-close').onclick = closeModal;
        });
      return body;
    });
  }

  function clearDone() {
    jget('/todo').then((res) => {
      const done = (res && Array.isArray(res.todos) ? res.todos : []).filter((t) => t.done);
      if (!done.length) {
        if (S0.sprite && S0.sprite.say) S0.sprite.say('没有已完成的待办要清理呀');
        return;
      }
      Promise.all(done.map((t) => jpost('/todo/delete', { id: t.id }))).then(() => {
        if (S0.sprite && S0.sprite.say) S0.sprite.say('清理了 ' + done.length + ' 条已完成的待办');
      });
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }  // ---------- 改名 / API Key ----------
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

  // ---------- 外部事件（轮询 /state 的扩展 section） ----------
  function handleSections(state) {
    const secs = (state && state.sections) || {};
    ['chime', 'extNotify', 'todoReminder'].forEach((name) => {
      const leaf = secs[name];
      if (!leaf || typeof leaf !== 'object') return;
      const counter = Number(leaf.counter) || 0;
      if (!counter) return;
      if (S0.counters[name] === counter) return;
      const first = !S0.armed;
      S0.counters[name] = counter;
      console.log('[dsh-pet] extras section ' + name + ' counter=' + counter + (first ? ' (first, 跳过)' : ''));
      if (first) return; // 启动时只对齐计数，不补播历史
      const data = leaf.data || {};
      if (name === 'chime') {
        playSfx('chime');
        showClock();
      } else if (name === 'extNotify') {
        playSfx('notify');
        if (S0.sprite && S0.sprite.say && data.text) S0.sprite.say(data.text);
      } else if (name === 'todoReminder') {
        console.log('[dsh-pet] extras todoReminder 分支，petBridge=' + (typeof window.petBridge) + ' fn=' + (window.petBridge && typeof window.petBridge.todoReminder));
        if (S0.sprite && S0.sprite.playOnce) {
          try {
            S0.sprite.playOnce(data.anim || '抽陀螺');
          } catch (e) {}
        }
        if (window.petBridge && typeof window.petBridge.todoReminder === 'function') {
          window.petBridge.todoReminder({ id: data.id, title: data.title, detail: data.detail || '' });
        }
      }
    });
    // 浏览器气泡（bridge 通知）沿用原逻辑；这里不动

    // ---------- DSH 接入 / 断开时随机跳一支舞 ----------
    try {
      const b = secs.bridge;
      if (b && typeof b === 'object' && b.data && typeof b.data === 'object') {
        const online = b.data.online === true;
        const counter = Number(b.counter) || 0;
        if (S0.bridgeCounter !== counter) {
          const first = S0.bridgeCounter === void 0;
          S0.bridgeCounter = counter;
          const changed = !first && S0.bridgeOnline !== online;
          S0.bridgeOnline = online;
          if (changed) playDance();
        } else if (S0.bridgeOnline === void 0) {
          S0.bridgeOnline = online;
        }
      }
    } catch (e) {}
  }

  const DANCES = ['可爱宅舞', '轻快摇摆舞', '优雅女仆舞'];
  let lastDance = -1;
  function playDance() {
    if (!S0.sprite || typeof S0.sprite.playOnce !== 'function') return;
    let i = Math.floor(Math.random() * DANCES.length);
    if (i === lastDance) i = (i + 1) % DANCES.length;
    lastDance = i;
    try {
      S0.sprite.playOnce(DANCES[i]);
      console.log('[dsh-pet] DSH 连接状态变化，跳舞：' + DANCES[i]);
    } catch (e) {}
  }

  function poll() {
    jget('/state')
      .then((st) => {
        if (!st) {
          console.warn('[dsh-pet] extras poll 拿不到 /state（' + base() + '/state）');
          return;
        }
        handleSections(st);
        if (!S0.armed) { S0.armed = true; console.log('[dsh-pet] extras armed'); }
      })
      .catch((e) => console.warn('[dsh-pet] extras poll 异常：' + (e && e.message)));
  }

  function ensureStarted() {
    if (S0.started) return;
    S0.started = true;
    poll();
    setInterval(poll, 2000);
    if (window.petBridge && typeof window.petBridge.onTodoOpen === 'function') {
      try { window.petBridge.onTodoOpen((id) => openTodoDetail(id)); } catch (e) {}
    }
    console.log('[dsh-pet] extras 轮询已启动');
  }

  // ---------- 初始化 ----------
  function attach(spriteInstance) {
    S0.sprite = spriteInstance;
    S0.counters = Object.create(null);
    ensureStarted();
    try { console.log('[dsh-pet] extras bridge keys: ' + Object.keys(window.petBridge || {}).join(',')); } catch (e) { console.log('[dsh-pet] extras bridge 读取失败'); }
    console.log('[dsh-pet] extras ready（报时 / 待办 / 提示音）');
  }

  E.attach = attach;
  E.openTodoAdd = openTodoAdd;
  E.openTodoList = openTodoList;
  E.clearDone = clearDone;
  E.openTodoDetail = openTodoDetail;
  E.openRename = openRename;
  E.openApiKey = openApiKey;
  E.playSfx = playSfx;
  E.showClock = showClock;
  E.hideClock = hideClock;

  // PetSprite 构造完成后自动挂载（renderer.js 里 new PetSprite → 这里包一层）
  function boot() {
    if (typeof PetSprite !== 'function') return;
    const origin = PetSprite;
    const Wrapped = function (pet) {
      const inst = new origin(pet);
      try {
        attach(inst);
      } catch (e) {
        console.warn('[dsh-pet] extras attach 失败:', e);
      }
      return inst;
    };
    Wrapped.prototype = origin.prototype;
    Object.setPrototypeOf(Wrapped, origin);
    PetSprite = Wrapped;
  } 
  ensureStarted();
  boot();
})();
