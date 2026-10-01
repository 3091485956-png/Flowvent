/* doceditor.js — 文档编辑页(独立标签页,#edit=<planId>)
   形态对齐 Ranuts Document:整篇 Word 式文档、真实编辑而非预览、本地自动保存、
   AI 融入每次交互(章节重写 / 润色 / 扩写 / 选区改写);编辑与查看分离。
   以原生 contenteditable 在零构建架构内实现;数据模型为 sections[](Markdown,经 htmlToMd 往返)。
   结构铁律:章节标题(一、二…)固定不可编辑;右键仅保留 AI 与复制类操作,不提供增删节点。 */
window.EP = window.EP || {};
EP.doceditor = (function () {
  const $ = function (id) { return document.getElementById(id); };
  const state = { plan: null, saveTimer: null, current: null, dirty: false, chat: { msgs: [], busy: false } };

  /* ───────── HTML → Markdown(EP.md 子集的逆变换) ───────── */
  function inlineMd(node) {
    let out = '';
    node.childNodes.forEach(function (n) {
      if (n.nodeType === 3) { out += n.textContent; return; }
      const tag = n.tagName;
      if (tag === 'STRONG' || tag === 'B') { out += '**' + inlineMd(n) + '**'; return; }
      if (tag === 'BR') { out += '\n'; return; }
      out += inlineMd(n);                              // span/font 等编辑残留:保留文本
    });
    return out;
  }
  function cellText(td) { return inlineMd(td).replace(/\|/g, '/').replace(/\n/g, ' ').trim(); }
  function blockMd(el) {
    const tag = el.tagName;
    if (tag === 'H4') return '#### ' + inlineMd(el).trim();
    if (tag === 'P') { const t = inlineMd(el).trim(); return t || null; }
    if (tag === 'BLOCKQUOTE') { const t = inlineMd(el).trim(); return t ? '> ' + t : null; }
    if (tag === 'UL' || tag === 'OL') {
      const items = [];
      el.querySelectorAll(':scope > li').forEach(function (li, i) {
        const t = inlineMd(li).trim();
        if (t) items.push(tag === 'OL' ? (i + 1) + '. ' + t : '- ' + t);
      });
      return items.length ? items.join('\n') : null;
    }
    if (tag === 'DIV') {                               // contenteditable 常见的裸文本包裹
      const t = inlineMd(el).trim();
      return t || null;
    }
    return null;
  }
  function tableMd(table) {
    const lines = [];
    const ths = [...table.querySelectorAll('thead th')].map(cellText);
    const cols = ths.length || 1;
    lines.push('| ' + ths.join(' | ') + ' |');
    lines.push('| ' + Array(cols).fill('---').join(' | ') + ' |');
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      const cls = tr.classList.contains('warn-row') ? '{:warn}' :
                  tr.classList.contains('sum-row') ? '{:sum}' :
                  tr.classList.contains('day-divider') ? '{:day}' : '';
      const tds = [...tr.querySelectorAll('td')].map(cellText);
      while (tds.length < cols) tds.push('');
      lines.push('| ' + tds.join(' | ') + ' |' + cls);
    });
    return lines.join('\n');
  }
  function sectionToMd(sec) {
    const out = [];
    sec.childNodes.forEach(function (n) {
      if (n.nodeType !== 1) return;
      if (n.tagName === 'TABLE') { out.push(tableMd(n)); return; }
      if (n.classList && n.classList.contains('table-wrap') && n.querySelector('table')) { out.push(tableMd(n.querySelector('table'))); return; }
      const b = blockMd(n);
      if (b) out.push(b);
    });
    return out.join('\n\n');
  }

  /* ───────── 渲染 ───────── */
  function metaLine(f) {
    return (f.date || '待定') + ' ' + (f.startTime || '') + ' · ' + (f.headcount || '待定') + ' 人 · ' +
      (f.venue || EP.struct.VENUE_LABEL[f.venueType] || '待定') + ' · ' + (EP.struct.DUR_LABEL[f.duration] || '');
  }
  function render() {
    const p = state.plan, f = p.form;
    $('edit-name').value = p.name;
    const head =
      '<div class="edoc-head"><h1 class="edoc-title">' + EP.md.esc(p.name) + '</h1>' +
      '<p class="edoc-meta">' + EP.md.esc(metaLine(f)) + (f.budgetTotal ? ' · 预算 ¥' + Number(f.budgetTotal).toLocaleString() : '') + '</p></div>';
    let html = head;
    (p.sections || []).forEach(function (s, i) {
      html += '<section class="edoc-sec" data-m="' + s.id + '" id="m-' + s.id + '">' +
        '<h2 class="edoc-sec-title" contenteditable="false">' + (EP.struct.CN[i] || i + 1) + '、' + EP.md.esc(s.title) + '</h2>' +
        '<div class="edoc-sec-body doc">' + EP.md.render(s.md) + '</div></section>';
    });
    $('edit-doc').innerHTML = html;
    renderSide();
  }
  function renderSide() {
    const p = state.plan;
    let html = '<div class="plan-meta"><span class="chip">' + EP.struct.typeIcon(p.form.type) + EP.struct.typeLabel(p.form.type) + '</span></div><nav class="module-nav">';
    (p.sections || []).forEach(function (s, i) {
      const flag = s.flags || {};
      html += '<a href="#m-' + s.id + '"><span class="cn">' + (EP.struct.CN[i] || i + 1) + '</span>' + EP.md.esc(s.title) +
        (flag.ai ? '<span class="flag ai">AI</span>' : flag.edited ? '<span class="flag edited">已编辑</span>' : '') + '</a>';
    });
    $('edit-side').innerHTML = html + '</nav>';
    $('edit-side').querySelectorAll('a').forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        const t = document.getElementById(a.getAttribute('href').slice(1));
        /* 手动计算目标在滚动容器(.edit-doc-wrap)内的位置一次到位:
           scrollIntoView 在多层内部滚动容器下的平滑滚动会被连续点击打断、且时序不可预期 */
        const wrap = document.querySelector('.edit-doc-wrap');
        if (t && wrap) {
          const wr = wrap.getBoundingClientRect(), tr = t.getBoundingClientRect();
          wrap.scrollTo({ top: wrap.scrollTop + (tr.top - wr.top) - 16, behavior: 'smooth' });
        }
      };
    });
  }
  function findSection(id) { return (state.plan.sections || []).find(function (s) { return s.id === id; }) || null; }
  function outline() { return (state.plan.sections || []).map(function (s, i) { return (EP.struct.CN[i] || i + 1) + '、' + s.title; }).join('\n'); }

  /* ───────── 保存:逐章节 html→md 写回 localStorage ───────── */
  function autosave() {
    if (!state.plan) return;
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 600);
    $('edit-save').textContent = '编辑中…';
    state.dirty = true;
  }
  function saveNow() {
    if (!state.plan) return;
    document.querySelectorAll('.edoc-sec').forEach(function (sec) {
      const secObj = findSection(sec.dataset.m);
      if (!secObj) return;
      const md = sectionToMd(sec.querySelector('.edoc-sec-body'));
      /* sectionToMd 恒返回字符串:空串 = 用户清空整节,是合法编辑结果,必须写回 */
      if (md !== null && md !== secObj.md) {
        /* 只有「AI 产出后首次人工修改」才是真样本对:flags.ai 表示内容尚为 AI 原样输出,
           写回后 flags 变为 edited,连续自我编辑不再计入(样本不退化、n 不虚高) */
        if (secObj.flags && secObj.flags.ai) {
          EP.profile.record({ t: 'section_edited', data: { title: secObj.title, prevMd: secObj.md, newMd: md } });
        }
        secObj.prev = secObj.md;
        secObj.md = md;
        secObj.flags = { edited: true };
      }
    });
    const r = EP.store.savePlan(state.plan);
    const ind = $('edit-save');
    if (r && r.saved === false) {
      ind.textContent = '⚠ 保存失败:浏览器本地存储不可用,请立即导出备份';
      ind.classList.add('save-err');
    } else {
      ind.classList.remove('save-err');
      ind.textContent = '已自动保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      renderSide();
      state.dirty = false;
    }
  }

  /* ───────── 光标跟踪:当前章节 ───────── */
  function trackCaret() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return;
    let node = sel.anchorNode;
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('edoc-sec')) {
        if (state.current !== node.dataset.m) {
          state.current = node.dataset.m;
          const s = findSection(state.current);
          $('ai-target').textContent = '当前章节:' + (s ? s.title : '—');
        }
        return;
      }
      node = node.parentNode;
    }
  }

  /* ───────── 工具栏(格式命令) ───────── */
  function runCmd(kind) {
    $('edit-doc').focus();
    if (kind === 'bold') document.execCommand('bold');
    if (kind === 'h4') document.execCommand('formatBlock', false, 'h4');
    if (kind === 'p') document.execCommand('formatBlock', false, 'p');
    if (kind === 'ul') document.execCommand('insertUnorderedList');
    if (kind === 'ol') document.execCommand('insertOrderedList');
    if (kind === 'undo') document.execCommand('undo');
    if (kind === 'redo') document.execCommand('redo');
    autosave();
  }

  /* ───────── 章节级 AI 操作(作用于当前光标章节) ───────── */
  async function runAI(op) {
    const p = state.plan;
    if (!p || !state.current) { toast('请先把光标放在要处理的章节内'); return; }
    const sec = findSection(state.current);
    if (!sec) { toast('未找到当前章节', 'err'); return; }
    if (op === 'undoai') {
      if (sec.prev === undefined) return;
      applySection(sec.id, sec.prev, {});
      delete sec.prev;
      EP.store.savePlan(p);
      EP.profile.record({ t: 'section_ai_op', data: { title: sec.title, op: 'undoai' } });   // E3:撤销 = 强负信号
      toast('已撤销上一次修改');
      return;
    }
    try {
      if (op === 'regen') {
        if (!EP.ai.ready()) { toast('重新生成需要先配置 AI 接口(主界面「设置」)', 'warn'); return; }
        toast('AI 正在重写「' + sec.title + '」…');
        const out = await EP.ai.regenSection(p.form, outline(), sec.title, sec.md);
        applySection(sec.id, out, { ai: true });
        EP.profile.record({ t: 'section_ai_op', data: { title: sec.title, op: 'regen' } });  // E3:热区信号
        toast('「' + sec.title + '」已重新生成(可点「撤销 AI」恢复)');
      } else if (op === 'simplify') {
        const r = EP.struct.simplify(sec.md);
        if (!r.removed) { toast('该章节已经很精简,无需再删'); return; }
        applySection(sec.id, r.md, { edited: true });
        toast('已本地精简:' + r.removed + ' 处');
      } else {
        if (!EP.ai.ready()) { toast('润色 / 扩写需要先配置 AI 接口(主界面「设置」)', 'warn'); return; }
        toast('AI 正在处理「' + sec.title + '」…');
        const out = op === 'polish' ? await EP.ai.polish(sec.title, sec.md) : await EP.ai.expand(sec.title, sec.md);
        applySection(sec.id, out, { ai: true });
        EP.profile.record({ t: 'section_ai_op', data: { title: sec.title, op: op } });       // E3:热区信号
        toast('「' + sec.title + '」已' + (op === 'polish' ? '润色' : '扩写') + '(可点「撤销 AI」恢复)');
      }
    } catch (e) {
      toast((e && e.message) ? e.message : '操作失败,已保留原内容', 'err');
    }
  }
  function applySection(id, md, flags) {
    const sec = findSection(id);
    if (!sec) return;
    sec.prev = sec.md;
    sec.md = md;
    sec.flags = flags || {};
    EP.store.savePlan(state.plan);
    const body = document.querySelector('.edoc-sec[data-m="' + id + '"] .edoc-sec-body');
    if (body) body.innerHTML = EP.md.render(md);
    renderSide();
    showUndoAi(id);
  }
  function showUndoAi(key) {
    if (!key) return;
    const sec = findSection(key);
    let btn = $('ai-undo-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'ai-undo-btn';
      btn.className = 'btn btn-sm btn-ghost';
      btn.dataset.ai = 'undoai';
      btn.textContent = '↩ 撤销AI';
      document.querySelector('.edit-ai').appendChild(btn);
      btn.onclick = function () { runAI('undoai'); };
    }
    btn.style.display = (sec && sec.prev !== undefined) ? '' : 'none';
  }

  /* ───────── toast(编辑页独立实例) ───────── */
  function toast(msg, type) {
    let box = document.getElementById('edit-toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'edit-toasts';
      box.className = 'toasts';
      document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3200);
  }

  /* ───────── AI 编辑对话(docs/15 F2):对话式修改,动作经 applySection 可撤销 ───────── */
  function openChat(key) {
    if (key) state.current = key;
    $('edit-chat').hidden = false;
    syncChatTarget();
    renderChat();
    $('chat-input').focus();
  }
  function closeChat() { $('edit-chat').hidden = true; }
  function syncChatTarget() {
    const s = findSection(state.current);
    $('chat-target').textContent = s ? '聚焦:' + s.title : '';
  }
  function matchSection(title) {
    const secs = state.plan.sections || [];
    let s = secs.find(function (x) { return x.title === title; });
    if (!s) s = secs.find(function (x) { return title.includes(x.title) || x.title.includes(title); });
    if (!s) {
      const m = /^([一二三四五六七八九十]+)/.exec(String(title || ''));
      if (m) { const i = EP.struct.CN.indexOf(m[1]); if (i >= 0 && i < secs.length) s = secs[i]; }
    }
    return s || null;
  }
  function renderChat() {
    const box = $('chat-msgs');
    box.innerHTML = state.chat.msgs.map(function (m, idx) {
      if (m.kind === 'user') return '<div class="msg user">' + EP.md.esc(m.text) + '</div>';
      if (m.kind === 'ai') return '<div class="msg ai">' + EP.md.esc(m.text) + '</div>';
      if (m.kind === 'err') return '<div class="msg err">' + EP.md.esc(m.text) + '</div>';
      if (m.kind === 'edit') return '<div class="msg edit-card">✎ 已重写「' + EP.md.esc(m.section) + '」<button class="btn btn-ghost btn-sm" data-undo="' + idx + '">撤销</button></div>';
      if (m.kind === 'pref') return '<div class="msg pref-card">检测到长期偏好:「' + EP.md.esc(m.text) + '」' +
        (m.done ? '<b>✓ 已设为默认</b>' : '<button class="btn btn-ghost btn-sm" data-pref="' + idx + '">设为默认</button>') + '</div>';
      return '';
    }).join('');
    box.scrollTop = box.scrollHeight;
    box.querySelectorAll('[data-undo]').forEach(function (b) {
      b.onclick = function () {
        const m = state.chat.msgs[Number(b.dataset.undo)];
        const sec = findSection(m.secId);
        if (sec && sec.prev !== undefined) {
          applySection(sec.id, sec.prev, {});
          delete sec.prev;
          EP.store.savePlan(state.plan);
          toast('已撤销该次 AI 修改');
        } else toast('没有可撤销的版本');
      };
    });
    box.querySelectorAll('[data-pref]').forEach(function (b) {
      b.onclick = function () {
        const m = state.chat.msgs[Number(b.dataset.pref)];
        EP.profile.record({ t: 'preference_confirmed', data: { value: m.text } });
        m.done = true;
        renderChat();
        toast('已设为默认偏好,之后的生成将严格遵守');
      };
    });
  }
  async function sendChat() {
    if (state.chat.busy) return;
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text) return;
    if (!EP.ai.ready()) { toast('AI 编辑需先配置 AI 接口(主界面「设置」)', 'warn'); return; }
    input.value = '';
    state.chat.msgs.push({ kind: 'user', text: text });
    state.chat.busy = true;
    renderChat();
    /* 对话指令并入偏好检测管道(docs/14 T1;强意图词由 profile 加权) */
    EP.profile.record({ t: 'chat_message', data: { text: text } });
    try {
      const target = findSection(state.current) || (state.plan.sections || [])[0];
      const history = state.chat.msgs.filter(function (m) { return m.kind === 'user' || m.kind === 'ai'; })
        .slice(-6).map(function (m) { return { role: m.kind === 'user' ? 'user' : 'assistant', content: m.text }; });
      const r = await EP.ai.chatEdit(state.plan, history, text, target ? target.title : '');
      state.chat.msgs.push({ kind: 'ai', text: r.reply || '(已完成)' });
      if (r.edit) {
        const sec = matchSection(r.edit.section);
        if (sec) {
          applySection(sec.id, r.edit.md, { ai: true });
          state.chat.msgs.push({ kind: 'edit', section: sec.title, secId: sec.id });
        } else {
          state.chat.msgs.push({ kind: 'ai', text: '(未找到章节「' + r.edit.section + '」;请在要求中引用目录里的章节标题)' });
        }
      }
      if (r.save_pref) state.chat.msgs.push({ kind: 'pref', text: r.save_pref, done: false });
    } catch (e) {
      state.chat.msgs.push({ kind: 'err', text: (e && e.message) || '操作失败,请重试' });
    }
    state.chat.busy = false;
    renderChat();
  }

  /* ───────── 右键菜单:章节标题 AI 操作 / 选区 AI(不提供增删节点) ───────── */
  function setupContextMenus() {
    const menu = document.createElement('div');
    menu.id = 'ctx-menu';
    document.body.appendChild(menu);
    let ctx = null;
    function hide() { menu.style.display = 'none'; ctx = null; }
    function show(x, y, items) {
      menu.innerHTML = '';
      items.forEach(function (it) {
        if (it === '-') {
          const s = document.createElement('div'); s.className = 'ctx-sep'; menu.appendChild(s); return;
        }
        const b = document.createElement('button');
        b.className = 'ctx-item' + (it.danger ? ' danger' : '');
        b.textContent = it.label;
        if (it.disabled) { b.disabled = true; b.title = it.title || ''; }
        else b.onclick = function (e) { e.stopPropagation(); const fn = it.fn; if (fn) fn(); hide(); };
        menu.appendChild(b);
      });
      menu.style.display = 'block';
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
      menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
    }
    ['mousedown', 'scroll', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        if (ev === 'keydown' && e.key !== 'Escape') return;
        if (ev === 'mousedown' && menu.contains(e.target)) return;
        if (menu.style.display === 'block') hide();
      }, true);
    });
    window.addEventListener('resize', hide);

    const aiReady = function () { return EP.ai.ready(); };
    const AI_HINT = '需先在主界面「设置」配置 AI 接口';

    $('edit-doc').addEventListener('contextmenu', function (e) {
      const secTitle = e.target.closest('.edoc-sec-title');
      const body = e.target.closest('.edoc-sec-body');
      const sel = window.getSelection();
      const selText = sel ? sel.toString().trim() : '';

      /* 1) 章节标题:统一入口为 AI 编辑对话(docs/15 F2;原四项操作收敛为面板内快捷指令) */
      if (secTitle) {
        e.preventDefault();
        const key = secTitle.parentElement.dataset.m;
        show(e.clientX, e.clientY, [
          { label: '✦ 在 AI 编辑中处理此章节', fn: function () { state.current = key; openChat(key); } }
        ]);
        return;
      }
      if (!body) return;
      /* 2) 文字选区:AI 专改选中文字 */
      if (selText && sel.rangeCount && body.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        e.preventDefault();
        const range = sel.getRangeAt(0).cloneRange();
        const text = selText;
        show(e.clientX, e.clientY, [
          { label: '✦ AI 润色选中文字', disabled: !aiReady(), title: AI_HINT, fn: function () { runSelOp('polish', range, text); } },
          { label: '✦ AI 扩写选中文字', disabled: !aiReady(), title: AI_HINT, fn: function () { runSelOp('expand', range, text); } },
          { label: '✦ AI 重写选中文字', disabled: !aiReady(), title: AI_HINT, fn: function () { runSelOp('rewrite', range, text); } },
          { label: '⤓ 精简选中文字', fn: function () { runSelOp('simplify', range, text); } },
          '-',
          { label: '⧉ 复制选中文字', fn: function () { try { navigator.clipboard.writeText(text); toast('已复制'); } catch (err) { toast('复制失败', 'err'); } } }
        ]);
      }
      /* 其余区域:原生菜单(浏览、拼写等) */
    });
  }
  async function runSelOp(op, range, text) {
    try {
      if (op === 'simplify') {
        if (text.length <= 40) { toast('选区已经很短,无需精简'); return; }
        const i = text.indexOf('。');
        const cut = (i > 10 ? text.slice(0, i + 1) : text.slice(0, 40)) + '……';
        replaceRange(range, cut);
        EP.profile.record({ t: 'selection_op', data: { op: 'simplify', before: text, after: cut } });   // E4:嫌长信号
        toast('已本地精简选中文字');
        return;
      }
      toast('AI 正在处理选中文字…');
      const out = await EP.ai.textOp(op, text);
      replaceRange(range, out);
      EP.profile.record({ t: 'selection_op', data: { op: op, before: text, after: out } });             // E4:选区改写样本对
      toast('已应用 AI 修改(可用工具栏 ↩ 撤销)');
    } catch (e) {
      toast((e && e.message) ? e.message : '操作失败,已保留原文', 'err');
    }
  }
  function replaceRange(range, newText) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    $('edit-doc').focus();
    document.execCommand('insertText', false, newText);   // 触发 input → 自动保存;支持浏览器撤销
    autosave();
  }

  /* ───────── 打开(由 app.js hash 路由调用) ───────── */
  function open(planId) {
    const plan = EP.store.getPlan(planId);
    if (!plan) {
      document.body.innerHTML = '<div style="padding:60px;text-align:center;font-family:sans-serif">方案不存在或已被删除。<a href="' + location.pathname + '">返回秒策</a></div>';
      return;
    }
    state.plan = plan;
    document.body.dataset.view = 'edit';
    render();
    /* 事件绑定(一次性) */
    $('edit-doc').addEventListener('input', autosave);
    $('edit-doc').addEventListener('keyup', trackCaret);
    $('edit-doc').addEventListener('mouseup', trackCaret);
    $('edit-doc').addEventListener('click', trackCaret);       /* 单击放置光标也更新当前章节(mouseup 之外互补) */
    $('edit-doc').addEventListener('focusin', trackCaret);
    $('edit-doc').addEventListener('paste', function (e) {          // 仅纯文本粘贴,防外部样式污染
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
    });
    document.querySelectorAll('.edit-tools .tool').forEach(function (b) {
      b.onclick = function () { runCmd(b.dataset.cmd); };
    });
    /* AI 编辑对话面板(docs/15 F2) */
    $('btn-ai-chat').onclick = function () { openChat(); };
    $('chat-close').onclick = closeChat;
    $('chat-send').onclick = sendChat;
    $('chat-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    document.querySelectorAll('.chat-quick button').forEach(function (b) {
      b.onclick = function () {
        const op = b.dataset.quick;
        if (!state.current) { toast('请先把光标放在要处理的章节内', 'warn'); return; }
        openChat();
        runAI(op);
        state.chat.msgs.push({ kind: 'ai', text: '已对当前章节执行「' + b.textContent + '」,结果可在文档中查看(工具区 ↩ 或对话卡可撤销)' });
        renderChat();
      };
    });
    setupContextMenus();                                // 右键菜单:章节 AI / 选区 AI
    $('btn-edit-pdf').onclick = async function () {
      saveNow();
      toast('正在生成 PDF…');
      try { await EP.pdf.export(state.plan, document.getElementById('edit-doc')); toast('PDF 已导出'); }
      catch (e) { toast('PDF 生成失败:' + (e && e.message || e), 'err'); }
    };
    $('btn-edit-word').onclick = function () {
      saveNow();
      try { EP.word.export(state.plan); toast('Word 文档(.docx)已导出'); }
      catch (e) { toast('Word 导出失败:' + ((e && e.message) || e), 'err'); }
    };
    $('edit-name').onchange = function () {
      state.plan.name = this.value.trim() || state.plan.name;
      this.value = state.plan.name;
      EP.store.savePlan(state.plan);
      document.querySelector('.edoc-title').textContent = state.plan.name;
    };
    $('edit-home').onclick = function () { location.href = location.pathname + location.search; };
    window.addEventListener('beforeunload', function () {
      if (state.dirty) { saveNow(); }
    });
  }

  return { open: open, saveNow: saveNow };
})();
