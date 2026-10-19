/* app.js — 总装配:视图路由 / 首页 / 创建(AI 整案生成)/ 编辑器 / 弹窗与 toast */
window.EP = window.EP || {};
EP.app = (function () {
  const $ = function (id) { return document.getElementById(id); };
  const state = { view: 'home', panel: '', plan: null };

  /* ───────── 通用 ───────── */
  /* V1.2 F5:抽屉「记忆库」小红点(矛盾数优先,其次积压事件);打开记忆面板即清除 */
  function refreshMemBadge() {
    const b = $('mem-badge');
    if (!b || !EP.wiki || !EP.wiki.badgeCount) return;
    const c = EP.wiki.badgeCount();
    if (c) { b.textContent = c.kind === 'review' ? c.n : '+' + c.n; b.hidden = false; }
    else b.hidden = true;
  }
  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 3200);
  }
  function setView(name) {
    state.view = name;
    document.body.dataset.view = name;
    window.scrollTo(0, 0);
  }
  /* ── 应用主框架:左抽屉面板切换 ── */
  function openPanel(key) {
    state.panel = key;
    document.querySelectorAll('.drawer-nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.panel === key); });
    document.querySelectorAll('.app-main .panel').forEach(function (p) { p.classList.toggle('on', p.id === 'panel-' + key); });
    if (key === 'activities') renderActivities();
    if (key === 'settings') loadSettingsForm();
    if (key === 'memory') EP.memoryview.init();   // 记忆库面板(docs/13/15)
  }
  function enterApp(panel) { setView('app'); openPanel(panel); scrollAppTop(); }
  function scrollAppTop() { const m = document.querySelector('.app-main'); if (m) m.scrollTop = 0; }
  function enterCreate(preType) { setView('app'); openPanel('create'); prepareCreate(preType); showCreateGen(false); }
  function enterSettings() { setView('app'); openPanel('settings'); scrollAppTop(); }
  function showCreateGen(show) { $('create-form').hidden = show; $('create-gen').hidden = !show; }
  function autosave() {
    if (!state.plan) return;
    /* 同步立即保存:触发源均为低频用户动作,无需去抖;后台节流标签页下 setTimeout 会延迟写入 */
    const r = EP.store.savePlan(state.plan);
    const ind = $('save-indicator');
    if (r && r.saved === false) {                 // 持久化失败:绝不谎报"已保存"
      ind.textContent = '⚠ 保存失败:浏览器本地存储不可用,内容仍在当前页面,请立即导出 Markdown 备份';
      ind.classList.add('save-err');
      toast('自动保存失败(本地存储不可用或已满)。请点击「导出 Markdown」备份数据', 'err');
    } else {
      ind.classList.remove('save-err');
      ind.textContent = '已自动保存 · ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
  }

  /* ───────── 我的活动:分类 chips(按库中实际存在的类型)+ 按类型分组列表 ───────── */
  let actFilter = '';
  function renderActivities() {
    const r = EP.store.listPlans($('history-search').value, actFilter);
    const chips = $('history-chips');
    chips.innerHTML = '';
    const mkChip = function (label, key, icon) {
      const b = document.createElement('button');
      b.className = 'cat-chip' + (actFilter === key ? ' on' : '');
      b.innerHTML = (icon || '') + label;
      b.onclick = function () { actFilter = key; renderActivities(); };
      chips.appendChild(b);
    };
    mkChip('全部', '');
    const present = {};
    r.active.concat(r.archived).forEach(function (p) { if (p.type) present[p.type] = 1; });
    Object.keys(present).forEach(function (tk) { mkChip(EP.struct.typeLabel(tk), tk, EP.struct.typeIcon(tk)); });

    $('act-count').textContent = r.active.length ? '(' + r.active.length + ')' : '';
    $('archived-count').textContent = r.archived.length;
    $('archived-box').style.display = r.archived.length ? '' : 'none';
    $('archived-box').open = false;

    const box = $('history-list');
    box.innerHTML = '';
    if (!r.active.length) {
      const filtering = $('history-search').value || actFilter;
      box.innerHTML = filtering
        ? '<div class="empty-state"><b>没有匹配的方案</b>换个关键词,或切回「全部」</div>'
        : '<div class="empty-state"><b>还没有活动方案</b>回到首页,点「新建活动策划」开始第一份</div>';
      return;
    }
    /* 按活动类型分组 */
    const groups = {};
    r.active.forEach(function (p) { (groups[p.type] = groups[p.type] || []).push(p); });
    Object.keys(groups).forEach(function (tk) {
      const g = document.createElement('div');
      g.className = 'act-group';
      g.innerHTML = '<span class="chip">' + EP.struct.typeIcon(tk) + EP.struct.typeLabel(tk) + '</span>' +
        '<span class="act-group-count">' + groups[tk].length + ' 个方案</span>';
      box.appendChild(g);
      const list = document.createElement('div');
      list.className = 'history-list';
      groups[tk].forEach(function (p) { list.appendChild(planRow(p, false)); });
      box.appendChild(list);
    });

    const ab = $('archived-list');
    ab.innerHTML = '';
    r.archived.forEach(function (p) { ab.appendChild(planRow(p, true)); });
  }
  function planRow(p, archived) {
    const row = document.createElement('div');
    row.className = 'plan-row';
    const date = new Date(p.updatedAt || p.createdAt);
    const when = (date.getMonth() + 1) + '月' + date.getDate() + '日 ' +
      String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    row.innerHTML =
      '<div class="plan-row-main"><div class="plan-row-name">' + EP.md.esc(p.name) + '</div>' +
      '<div class="plan-row-meta"><span class="chip">' + EP.struct.typeIcon(p.type) + EP.struct.typeLabel(p.type) + '</span> ' +
      (p.form.date ? EP.icon('calendar') + p.form.date : '') + ' · ' + (p.form.headcount ? p.form.headcount + ' 人' : '') + ' · 更新于 ' + when + '</div></div>' +
      '<div class="plan-row-actions"></div>';
    const ops = row.querySelector('.plan-row-actions');
    const btn = function (txt, cls, fn, icon) {
      const b = document.createElement('button');
      b.className = 'btn btn-sm ' + (cls || 'btn-ghost');
      b.innerHTML = (icon ? EP.icon(icon) : '') + txt; b.onclick = fn; return b;
    };
    if (archived) {
      ops.appendChild(btn('恢复', 'btn-ghost', function () { EP.store.archivePlan(p.id, false); renderActivities(); toast('已恢复到历史方案'); }, 'archive-restore'));
      ops.appendChild(btn('删除', 'btn-danger-ghost', function () {
        confirmModal('删除方案「' + p.name + '」?', '删除后无法恢复,请确认。', function () { EP.store.deletePlan(p.id); renderActivities(); toast('方案已删除'); });
      }, 'trash-2'));
    } else {
      row.querySelector('.plan-row-main').onclick = function () { openEditor(p.id); };
      ops.appendChild(btn('打开', 'btn-primary', function () { openEditor(p.id); }, 'folder-open'));
      ops.appendChild(btn('复制副本', 'btn-ghost', function () { const c = EP.store.copyPlan(p.id); renderActivities(); toast('已创建副本:「' + c.name + '」'); }, 'copy'));
      ops.appendChild(btn('重命名', 'btn-ghost', function () {
        promptModal('重命名方案', p.name, function (v) { EP.store.renamePlan(p.id, v); renderActivities(); });
      }, 'pencil'));
      ops.appendChild(btn('归档', 'btn-ghost', function () { EP.store.archivePlan(p.id, true); renderActivities(); toast('已归档,可在「已归档方案」中恢复'); }, 'archive'));
    }
    return row;
  }

  /* ───────── 创建表单 ───────── */
  function fillTypeSelect(sel, withEmpty) {
    sel.innerHTML = (withEmpty ? '<option value="">请选择活动类型</option>' : '') +
      EP.struct.TYPES.map(function (t) { return '<option value="' + t.key + '">' + t.name + '</option>'; }).join('');
  }
  function prepareCreate(preType) {
    const err = $('gen-error'); if (err) err.hidden = true;   // 新会话清失败提示
    const draft = EP.store.loadDraft();
    ['f-company', 'f-name', 'f-purpose', 'f-date', 'f-headcount', 'f-venue', 'f-budget', 'f-notes', 'f-product'].forEach(function (id) { $(id).value = ''; });
    $('f-start').value = '09:00';
    $('f-festival').value = '';   // 条件字段一并重置:节日不设默认值(静默注入「端午」曾污染方案),由必填校验兜底
    $('f-duration').value = 'day'; $('f-venueType').value = 'office'; $('f-audience').value = 'staff';
    $('f-nomemory').checked = false;   // V1.2 F4:重置后再按草稿恢复
    if (draft) {
      $('f-company').value = draft.company || ''; $('f-name').value = draft.name || '';
      $('f-purpose').value = draft.purpose || ''; $('f-date').value = draft.date || '';
      $('f-start').value = draft.startTime || '09:00'; $('f-duration').value = draft.duration || 'day';
      $('f-headcount').value = draft.headcount || ''; $('f-venueType').value = draft.venueType || 'office';
      $('f-venue').value = draft.venue || ''; $('f-budget').value = draft.budgetTotal || '';
      $('f-audience').value = draft.audience || 'staff'; $('f-notes').value = draft.notes || '';
      $('f-type').value = preType || draft.type || '';
      $('f-festival').value = draft.festival || ''; $('f-product').value = draft.product || '';
      $('f-nomemory').checked = !!draft.nomemory;   // V1.2 F4
    } else {
      $('f-type').value = preType || '';
    }
    updateCondFields();
    saveDraftDebounced();
  }
  function updateCondFields() {
    const t = $('f-type').value;
    document.querySelectorAll('[data-cond]').forEach(function (el) {
      el.hidden = (t !== el.dataset.cond);
      el.classList.remove('has-err');
    });
  }
  let draftTimer = null;
  function saveDraftDebounced() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      const f = collectForm(false);
      if (f) {
        EP.store.saveDraft(f);
        EP.profile.record({ t: 'form_defaults', data: { form: f } });   // E5:表单默认值分布(档案侧同签名去重)
      }
    }, 400);
  }
  function collectForm(strict) {
    const type = $('f-type').value;
    const num = function (id) { const v = $(id).value; return v === '' ? '' : Number(v); };
    return {
      company: $('f-company').value.trim(), name: $('f-name').value.trim(), type: type,
      purpose: $('f-purpose').value.trim(), date: $('f-date').value, startTime: $('f-start').value,
      duration: $('f-duration').value, headcount: num('f-headcount'),
      venueType: $('f-venueType').value, venue: $('f-venue').value.trim(),
      budgetTotal: num('f-budget'), audience: $('f-audience').value, notes: $('f-notes').value.trim(),
      festival: type === 'festival' ? ($('f-festival').value || '') : '',
      product: type === 'product_launch' ? ($('f-product') ? $('f-product').value.trim() : '') : '',
      nomemory: $('f-nomemory') ? $('f-nomemory').checked : false   // V1.2 F4:随草稿持久化,不进 prompt 上下文
    };
  }
  function validate() {
    const f = collectForm(true);
    const errs = [];
    const mark = function (id, msg) {
      const input = $(id); if (!input) return;
      const field = input.closest('.field');
      field.classList.add('has-err');
      let e = field.querySelector('.field-err');
      if (!e) { e = document.createElement('span'); e.className = 'field-err'; field.appendChild(e); }
      e.textContent = msg;
      errs.push(id);
    };
    document.querySelectorAll('.field').forEach(function (fl) { fl.classList.remove('has-err'); });
    if (!f.company) mark('f-company', '请填写组织 / 公司名称(文案与主持词需要)');
    if (!f.name) mark('f-name', '请填写活动名称');
    if (!f.type) mark('f-type', '请选择活动类型');
    if (!f.date) mark('f-date', '请选择活动日期');
    if (!f.startTime) mark('f-start', '请选择开始时间');
    if (!f.headcount || f.headcount < 1) mark('f-headcount', '请填写有效人数(≥1)');
    if (f.type === 'product_launch' && !f.product) mark('f-product', '请填写产品名称');
    if (f.type === 'festival' && !f.festival) mark('f-festival', '请选择具体节日');
    return errs.length ? null : f;
  }

  /* ───────── AI 整案生成 ───────── */
  let generating = false;                 // 并发闸门:请求 pending 期间经抽屉重入不得再次触发
  async function startGenerate() {
    if (generating) return;
    const f = collectForm(true);
    if (!EP.ai.ready()) {
      toast('生成方案需要先配置 AI 接口,已为你打开「设置」', 'err');
      enterSettings();
      return;
    }
    generating = true;
    showCreateGen(true);
    $('gen-title').textContent = 'AI 正在撰写完整方案…';
    $('gen-sub').textContent = '根据活动信息一次性生成整份策划案,通常需要几十秒';
    const steps = ['理解活动需求', '规划章节结构', '撰写完整方案', '整理排版输出'];
    const list = $('gen-list'); list.innerHTML = '';
    steps.forEach(function (s) {
      const li = document.createElement('li');
      li.className = 'gen-item';
      li.innerHTML = '<span class="dot"></span>' + s;
      list.appendChild(li);
    });
    const items = list.children;
    items[0].classList.add('doing');
    /* 深度思考流(docs/15 F1):阶段由真实 token 事件驱动(假动画定时器已删除);
       秒表只汇报真实耗时与已写字数,不伪造进度 */
    const think = $('gen-think'), thinkBody = $('gen-think-body');
    think.hidden = true; thinkBody.textContent = '';
    $('gen-progress').textContent = '';
    let stage = 0, thinkLen = 0, fullLen = 0;
    const startedAt = Date.now();
    const advance = function (n) {
      while (stage < n) {
        items[stage].classList.remove('doing'); items[stage].classList.add('done');
        items[stage].querySelector('.dot').innerHTML = EP.icon('check');
        stage++;
        if (stage < items.length) items[stage].classList.add('doing');
      }
    };
    const timer = setInterval(function () {
      const sec = Math.round((Date.now() - startedAt) / 1000);
      $('gen-progress').textContent = '已等待 ' + sec + ' 秒' + (fullLen ? ' · 已撰写 ' + fullLen + ' 字' : '');
    }, 1000);
    try {
      const raw = await EP.ai.generatePlanStream(f, {
        effort: $('f-effort') ? $('f-effort').value : 'high',
        noMemory: !!f.nomemory,   // V1.2 F4:勾选后本次生成不带任何记忆注入
        onThinking: function (t) {
          if (think.hidden) { think.hidden = false; advance(1); }
          thinkLen += t.length;
          thinkBody.textContent += t;
          if (thinkBody.textContent.length > 6000) thinkBody.textContent = '…' + thinkBody.textContent.slice(-6000);
          thinkBody.scrollTop = thinkBody.scrollHeight;
        },
        onDelta: function (full) { fullLen = full.length; advance(2); }
      });
      const parsed = EP.struct.parseDoc(raw);
      if (!parsed.ok) throw new Error(parsed.error);
      advance(3);
      clearInterval(timer);
      $('gen-progress').textContent = (thinkLen ? '深度思考 ' + thinkLen + ' 字 · ' : '') + '成文 ' + fullLen + ' 字 · 用时 ' + Math.round((Date.now() - startedAt) / 1000) + ' 秒';
      finishGen({
        id: EP.store.newId(), name: f.name, type: f.type,
        createdAt: Date.now(), updatedAt: Date.now(), status: 'active',
        form: f, sections: parsed.sections
      });
    } catch (e) {
      clearInterval(timer);
      generating = false;
      /* 失败不丢用户输入:表单内容写回草稿并恢复显示 */
      EP.store.saveDraft(f);
      showCreateGen(false);
      prepareCreate(f.type);
      /* 常驻错误条 + 一键重试:3.2 秒 toast 不够用户在长等待后看清失败原因 */
      const err = $('gen-error');
      if (err) {
        err.hidden = false;
        err.innerHTML = '<b>生成失败</b>' + EP.md.esc(((e && e.message) || String(e))) +
          '<span>表单内容已完整保留,可直接重试。</span><button class="btn btn-primary btn-sm" id="gen-retry">重试生成</button>';
        $('gen-retry').onclick = function () { err.hidden = true; startGenerate(); };
      }
      toast('生成失败:' + ((e && e.message) || e) + '。表单内容已保留,可直接重试', 'err');
    }
  }
  function finishGen(plan) {
    const list = $('gen-list');
    for (let k = 0; k < list.children.length; k++) {
      list.children[k].classList.remove('doing');
      list.children[k].classList.add('done');
      list.children[k].querySelector('.dot').innerHTML = EP.icon('check');
    }
    $('gen-title').textContent = '方案生成完成!';
    $('gen-sub').textContent = '共 ' + plan.sections.length + ' 个章节,正在打开文档…';
    EP.profile.record({ t: 'plan_generated', data: { form: plan.form } });   // E1:公司事实/预算档位/人群
    if (EP.wiki) plan.memUsed = { keys: EP.wiki.consumedKeys(), at: Date.now() };   /* V1.2 F6:生成时注入了哪些页面,导出时回流认可 */
    /* V1.1(docs/16):事件已入 rawLog,后台增量编译记忆库(静默助理:成功不打扰,
       失败自动回落本地编译,记忆面板可手动编译与查看编译日志) */
    if (EP.wiki) EP.wiki.compile().then(refreshMemBadge).catch(function () { });
    const saved = EP.store.savePlan(plan);
    if (!saved || saved.saved !== false) EP.store.clearDraft();   /* M7:存储写失败时保留草稿,方案仅存内存,用户误关页不至两头皆空 */
    setTimeout(function () {
      generating = false;
      if (saved && saved.saved === false) {
        /* 存储写失败:方案只存在于内存,不能走 openEditor 的存储重读(会得到 null),
           内存态直达编辑器,后续 autosave 会持续重试写盘 */
        openEditorPlan(plan);
        autosave();                       // 如实显示保存失败状态,不谎报"已自动保存"
        toast('已生成但保存失败:本地存储不可用或已满,请立即用「导出 Word / Markdown」备份', 'err');
        return;
      }
      if (state.view === 'app' && state.panel === 'create') { openEditor(plan.id); toast('方案已生成并自动保存'); }
      else { toast('方案已生成,可在「我的活动」中打开'); }
      /* B1 偏好确认闭环(docs/14):同一特殊需求重复 ≥3 次 → 询问是否设为默认;拒绝则冷却 */
      const sug = EP.profile.pendingSuggestions()[0];
      if (sug) {
        const d = document.createElement('div');
        d.style.cssText = 'color:var(--ink-2);font-size:14px;line-height:1.7';
        d.innerHTML = '<p style="margin:0 0 10px">检测到你在 ' + sug.count + ' 次生成中都要求「' + EP.md.esc(sug.value) + '」。设为默认偏好后,之后的生成将严格遵守这一要求;可随时在「记忆库」中删除。</p>' +
          '<textarea id="sug-why" class="sel-input" rows="2" placeholder="为什么?(可选,帮助 AI 拿捏分寸,如:上次被老板吐槽超时)"></textarea>';
        modal('设为默认偏好?', d, [
          { txt: '不用了', fn: function () { EP.profile.record({ t: 'preference_rejected', data: { value: sug.value } }); } },
          { txt: '设为默认', cls: 'btn-primary', fn: function () {
            const why = $('sug-why') ? $('sug-why').value.trim() : '';
            EP.profile.record({ t: 'preference_confirmed', data: { value: sug.value, why: why } });
            toast('已设为默认偏好,之后的生成将严格遵守');
          } }
        ], { sticky: true });   /* 6.2:确认类弹窗不因遮罩/ESC 消失,必须明确选择 */
      }
    }, 650);
  }

  /* ───────── 编辑器 ───────── */
  /* 内存态打开编辑器:供 openEditor 与「生成成功但存储写失败」的 H2 路径共用 */
  function openEditorPlan(plan) {
    state.plan = plan;
    setView('app');
    openPanel('editor');
    scrollAppTop();
    /* 编辑器属于「我的活动」上下文:抽屉中点亮该项 */
    document.querySelectorAll('.drawer-nav button').forEach(function (b) { if (b.dataset.panel === 'activities') b.classList.add('on'); });
    renderEditor();
  }
  function openEditor(id) {
    const plan = EP.store.getPlan(id);
    if (!plan) { toast('方案不存在或已被删除', 'err'); return; }
    openEditorPlan(plan);
  }
  function renderEditor() {
    const p = state.plan, f = p.form;
    $('editor-name').value = p.name;
    $('save-indicator').textContent = '已自动保存';
    $('save-indicator').classList.remove('save-err');
    $('plan-meta').innerHTML =
      '<span class="chip">' + EP.struct.typeIcon(f.type) + EP.struct.typeLabel(f.type) + '</span>' +
      '<div class="meta-lines">' +
      '<b>' + EP.md.esc(p.name) + '</b><br>' +
      EP.icon('calendar') + (f.date || '待定') + ' ' + (f.startTime || '') + '<br>' +
      EP.icon('users') + (f.headcount || '待定') + ' 人 · ' + (EP.struct.AUD_LABEL[f.audience] || '') + '<br>' +
      EP.icon("map-pin") + EP.md.esc(f.venue || EP.struct.VENUE_LABEL[f.venueType] || "待定") + '<br>' +
      (f.budgetTotal ? EP.icon('wallet') + '预算 ¥' + Number(f.budgetTotal).toLocaleString() : EP.icon('wallet') + '预算未设定') +
      '</div>';
    renderNav(); renderDocView();
    $('save-indicator').textContent = '已自动保存';
  }
  function renderNav() {
    const nav = $('module-nav'); nav.innerHTML = '';
    (state.plan.sections || []).forEach(function (s, i) {
      const flag = s.flags || {};
      const a = document.createElement('a');
      a.href = '#m-' + s.id;
      a.innerHTML = '<span class="cn">' + (EP.struct.CN[i] || i + 1) + '</span>' + EP.md.esc(s.title) +
        (flag.ai ? '<span class="flag ai">AI</span>' : flag.edited ? '<span class="flag edited">已编辑</span>' : '');
      /* 页面级滚动已锁定,锚点改为内容区内平滑滚动 */
      a.onclick = function (e) {
        e.preventDefault();
        const target = document.getElementById('m-' + s.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      nav.appendChild(a);
    });
  }
  /* ───────── 查看态:完整连续文档(编辑在新标签页 doceditor) ───────── */
  function renderDocView() {
    const p = state.plan;
    let html = '<article class="paper doc">';
    (p.sections || []).forEach(function (s, i) {
      html += '<section class="doc-sec" id="m-' + s.id + '">' +
        '<h2 class="doc-sec-title">' + (EP.struct.CN[i] || i + 1) + '、' + EP.md.esc(s.title) + '</h2>' +
        EP.md.render(s.md) + '</section>';
    });
    html += '</article>';
    const box = document.getElementById('doc-view');
    box.innerHTML = '<div class="paper-head"><h1>' + EP.md.esc(p.name) + '</h1></div>' + html;
  }


  /* ───────── 弹窗 ───────── */
  function modal(title, bodyEl, buttons, opts) {
    $('modal-title').textContent = title;
    const body = $('modal-body'); body.innerHTML = ''; body.appendChild(bodyEl);
    const foot = $('modal-foot'); foot.innerHTML = '';
    buttons.forEach(function (b) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || 'btn-ghost');
      btn.textContent = b.txt;
      btn.onclick = function () { if (b.fn) b.fn(); if (!b.keep) closeModal(); };
      foot.appendChild(btn);
    });
    $('modal').hidden = false;
    $('modal').dataset.sticky = opts && opts.sticky ? '1' : '';   /* sticky:遮罩/ESC 不关,防确认类弹窗被误触消失 */
  }
  function closeModal() { $('modal').hidden = true; }
  function confirmModal(title, msg, onOk) {
    const d = document.createElement('p');
    d.style.cssText = 'color:var(--ink-2);font-size:14px';
    d.textContent = msg;
    modal(title, d, [{ txt: '取消' }, { txt: '确认', cls: 'btn-primary', fn: onOk }]);
  }
  function promptModal(title, value, onOk) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<input class="input" value="' + EP.md.esc(value) + '">';
    const input = wrap.querySelector('input');
    modal(title, wrap, [
      { txt: '取消' },
      { txt: '保存', cls: 'btn-primary', fn: function () { onOk(input.value); } }
    ]);
    setTimeout(function () { input.focus(); input.select(); }, 50);
  }
  /* ───────── 设置面板 ───────── */
  function loadSettingsForm() {
    const c = EP.store.getAI();
    $('ai-url').value = c.baseURL || '';
    $('ai-key').value = c.apiKey || '';
    $('ai-model').value = c.model || '';
    const st = $('ai-status');
    st.textContent = ''; st.className = 'ai-status';
  }
  function saveSettings(silent) {
    EP.store.setAI({
      baseURL: $('ai-url').value.trim(),
      apiKey: $('ai-key').value.trim(),
      model: $('ai-model').value.trim()
    });
    if (!silent) {
      toast('AI 配置已保存到本机');
    }
  }

  /* ───────── 初始化 ───────── */
  function init() {
    /* 文档编辑标签页路由:#edit=<planId> → 独立编辑视图,跳过主界面初始化 */
    const editMatch = location.hash.match(/^#edit=([\w-]+)/);
    if (editMatch) { EP.doceditor.open(editMatch[1]); return; }
    fillTypeSelect($('f-type'), true);
    EP.mountIcons();           // 渲染 index.html 中的静态 <i data-icon>
    EP.wiki.init();            // V1.1:记忆库 Wiki 化迁移(幂等:无 ep_wiki 且档案非空时播种种子页面)
    refreshMemBadge();         // V1.2 F5
    $('brand-home').onclick = function () { setView('home'); };
    var bgEl = document.getElementById('aurora-bg');     // Aurora 动态背景(ReactBits 组件,内嵌)
    if (bgEl && EP.aurora) {
      EP.aurora.mount(bgEl, { colorStops: ['#B8CCF5', '#2E5BE0', '#0B2B66'], lightMode: true, amplitude: 1.15, blend: 0.4, speed: 0.5 });
    }
    $('btn-new-plan').onclick = function () { enterCreate(''); };
    $('f-type').onchange = function () { updateCondFields(); saveDraftDebounced(); };
    ['f-company', 'f-name', 'f-purpose', 'f-venue', 'f-notes', 'f-product'].forEach(function (id) {
      const el = $(id); if (el) el.oninput = saveDraftDebounced;
    });
    ['f-date', 'f-start', 'f-duration', 'f-headcount', 'f-venueType', 'f-audience', 'f-budget', 'f-festival', 'f-nomemory'].forEach(function (id) {
      const el = $(id); if (el) el.onchange = saveDraftDebounced;
    });
    $('btn-w-next').onclick = async function () {
      const f = validate();
      if (!f) { toast('还有必填项未完成,请按红字提示补齐', 'warn'); return; }
      startGenerate();                                  // 草稿在生成成功后才清除,失败可重试
    };
    /* 左抽屉导航 */
    document.querySelectorAll('.drawer-nav button').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.panel === 'create') enterCreate('');     // 切回创建面板时按草稿恢复
        else enterApp(b.dataset.panel);
      };
    });
    /* 编辑器工具条(查看态) */
    $('editor-name').onchange = function () {
      if (!state.plan) return;
      state.plan.name = this.value.trim() || state.plan.name;
      this.value = state.plan.name; autosave();
    };
    $('btn-edit-doc').onclick = function () {
      if (state.plan) window.open(location.href.split('#')[0] + '#edit=' + state.plan.id, '_blank');
    };
    /* 活动基本信息编辑(6.6):创建后仍可改日期/地点/人数等,导出文档同步 */
    $('btn-edit-meta').onclick = function () {
      if (!state.plan) return;
      const f = state.plan.form;
      const wrap = document.createElement('div');
      wrap.className = 'meta-form';
      wrap.innerHTML =
        '<label class="field"><span class="field-label">活动日期</span><input type="date" class="input" id="mf-date" value="' + (f.date || '') + '"></label>' +
        '<label class="field"><span class="field-label">开始时间</span><input type="time" class="input" id="mf-start" value="' + (f.startTime || '09:00') + '"></label>' +
        '<label class="field"><span class="field-label">地点类型</span><select class="input select" id="mf-venueType">' +
          ['office|公司内', 'indoor|室内场地(外部)', 'outdoor|户外', 'online|线上线下结合'].map(o => {
            const kv = o.split('|'); return '<option value="' + kv[0] + '"' + (f.venueType === kv[0] ? ' selected' : '') + '>' + kv[1] + '</option>';
          }).join('') + '</select></label>' +
        '<label class="field"><span class="field-label">具体地点</span><input class="input" id="mf-venue" value="' + EP.md.esc(f.venue || '') + '" placeholder="如:高新区体育馆(室内)"></label>' +
        '<label class="field"><span class="field-label">参与人数</span><input type="number" min="1" class="input" id="mf-headcount" value="' + (f.headcount || '') + '"></label>' +
        '<label class="field"><span class="field-label">预算总额(元)</span><input type="number" min="0" class="input" id="mf-budget" value="' + (f.budgetTotal || '') + '"></label>';
      modal('活动基本信息', wrap, [
        { txt: '取消' },
        { txt: '保存', cls: 'btn-primary', fn: function () {
          f.date = $('mf-date').value || f.date;
          f.startTime = $('mf-start').value || f.startTime;
          f.venueType = $('mf-venueType').value;
          f.venue = $('mf-venue').value.trim();
          f.headcount = Number($('mf-headcount').value) || f.headcount;
          f.budgetTotal = $('mf-budget').value === '' ? '' : Number($('mf-budget').value);
          autosave();
          renderEditor();
          toast('基本信息表已更新并同步到导出;正文中 AI 写的日期/地点如需更新,请用 AI 编辑');
        } }
      ]);
    };
    /* V1.2 F6:导出 = 认可。kept = AI 写完后从未被人工改动的章节数;注入过的确认页 verified+1 */
    const noteExport = function () {
      const p = state.plan;
      if (!p) return;
      const secs = p.sections || [];
      EP.profile.record({ t: 'plan_exported', data: {
        planId: p.id, total: secs.length,
        kept: secs.filter(function (x) { return x.flags && x.flags.ai; }).length,
        edited: secs.filter(function (x) { return !x.flags || !x.flags.ai; }).length
      } });
      if (EP.wiki && p.memUsed && p.memUsed.keys) EP.wiki.verifyExport(p.memUsed.keys);
    };
    $('btn-word').onclick = function () {
      if (!state.plan) return;
      noteExport();
      try { EP.word.export(state.plan); toast('Word 文档(.docx)已导出'); }
      catch (e) { toast('Word 导出失败:' + ((e && e.message) || e), 'err'); }
    };
    $('btn-export').onclick = function () { if (state.plan) { noteExport(); EP.exporter.download(state.plan); toast('已导出 Markdown 文件'); } };
    $('btn-pdf').onclick = async function () {
      if (!state.plan) return;
      toast('正在生成 PDF…');
      try { await EP.pdf.export(state.plan, document.querySelector('#doc-view .paper')); toast('PDF 已导出'); }
      catch (e) { toast('PDF 生成失败:' + (e && e.message || e), 'err'); }
    };
    /* 编辑标签页保存后回到本页时,自动同步最新内容 */
    window.addEventListener('focus', function () {
      if (state.view === 'app' && state.panel === 'editor' && state.plan) {
        const fresh = EP.store.getPlan(state.plan.id);
        if (fresh && fresh.updatedAt !== state.plan.updatedAt) {
          state.plan = fresh;
          renderEditor();
        }
      }
    });
    /* 设置面板 */
    $('ai-save').onclick = function () { saveSettings(false); };
    $('ai-clear').onclick = function () { EP.store.setAI({ baseURL: '', apiKey: '', model: '' }); loadSettingsForm(); toast('已清除本地 AI 配置'); };
    $('ai-test').onclick = async function () {
      saveSettings(true);
      const st = $('ai-status');
      st.textContent = '正在测试连接…'; st.className = 'ai-status';
      const r = await EP.ai.test();
      st.textContent = r.msg; st.className = 'ai-status ' + (r.ok ? 'ok' : 'fail');
    };
    $('history-search').oninput = renderActivities;
    /* 刷新/关页前同步落草稿:消灭 400ms 去抖的丢失窗口(最后输入后立即刷新曾导致回显旧草稿) */
    window.addEventListener('beforeunload', function () {
      if (state.view !== 'app' || state.panel !== 'create' || $('create-form').hidden) return;
      const f = collectForm(false);
      if (f && (f.company || f.name || f.type)) EP.store.saveDraft(f);
    });
    $('modal').addEventListener('click', function (e) { if (e.target === this && this.dataset.sticky !== '1') closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('modal').dataset.sticky !== '1') closeModal(); });
  }
  return { init: init, toast: toast, modal: modal, confirmModal: confirmModal, promptModal: promptModal, refreshMemBadge: refreshMemBadge };
})();
document.addEventListener('DOMContentLoaded', EP.app.init);
