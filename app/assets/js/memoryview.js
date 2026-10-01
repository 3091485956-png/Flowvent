/* memoryview.js — 记忆库面板(抽屉入口,docs/13/15)
   Cytoscape 按需从 CDN 加载(unpkg→jsdelivr),双源失败降级为列表视图,数据管理不阻塞;
   偏好子图(Preference 节点)即 EP.profile 的活视图,删除经 EP.profile.remove 回写。 */
window.EP = window.EP || {};
EP.memoryview = (function () {
  const $ = function (id) { return document.getElementById(id); };
  const CY_SOURCES = [          /* SRI 固定完整性校验:防 CDN 投毒/中间人篡改(两源同包字节一致) */
    { url: 'https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js',
      integrity: 'sha384-IWROdLKRsN1UuJywMlWl7/blXQ8GEooN2n7dzTxfEPd7ybYIKCUJ2Ol/1Gpf3YV4' },
    { url: 'https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/dist/cytoscape.min.js',
      integrity: 'sha384-IWROdLKRsN1UuJywMlWl7/blXQ8GEooN2n7dzTxfEPd7ybYIKCUJ2Ol/1Gpf3YV4' }
  ];
  const LAYOUTS = [
    { key: 'cose', name: '力导向' },
    { key: 'breadthfirst', name: '层次' },
    { key: 'circle', name: '圆形' }
  ];
  const TYPE_LABEL = { File: '文件', Folder: '文件夹', Note: '笔记', Tag: '标签', Entity: '实体', Preference: '偏好记忆', Concept: '概念', Profile: '记忆库' };
  const state = { inited: false, cy: null, layout: 'cose', store: null, lastGraph: null, cyLoading: false, cat: '' };
  /* 记忆库四大模块(docs/15 F3):AI 储存时自动分类,tab 按模块过滤记忆节点 */
  const CAT_TABS = [
    { key: '', label: '全部' },
    { key: 'company', label: '公司' },
    { key: 'department', label: '各部门' },
    { key: 'style', label: '策划案风格' },
    { key: 'misc', label: '其他偏好' }
  ];
  /* 节点 → 模块:Profile 中心常驻;MD 笔记节点不属于记忆模块(非"全部"时隐藏) */
  function catOf(n) {
    if (!n) return null;
    if (n.type === 'Profile') return '__center';
    if (n.type === 'Preference') return (n.props && n.props.cat) || 'misc';
    return '__docs';
  }

  const CY_STYLE = [
    { selector: 'node', style: {
      label: 'data(label)', 'font-size': 10, color: '#3B4A6B', 'text-valign': 'bottom', 'text-margin-y': 4,
      'background-color': '#C7D5F2', width: 18, height: 18, 'min-zoomed-font-size': 8
    } },
    { selector: 'node[type="Note"]', style: { 'background-color': '#2E5BE0', width: 26, height: 26, 'font-weight': 600, color: '#0B2B66' } },
    { selector: 'node[type="Heading"]', style: { 'background-color': '#8FA8E8', width: 14, height: 14 } },
    { selector: 'node[type="Tag"]', style: { 'background-color': '#E8B550', width: 15, height: 15 } },
    { selector: 'node[type="Concept"]', style: { 'background-color': '#B6C0D2', width: 13, height: 13, 'border-style': 'dashed', 'border-width': 1, 'border-color': '#7A889F' } },
    { selector: 'node[type="Preference"]', style: { 'background-color': '#3E9B6F', width: 16, height: 16 } },
    { selector: 'node[type="Profile"]', style: { 'background-color': '#0B2B66', width: 34, height: 34, 'font-size': 12, 'font-weight': 700 } },
    { selector: 'edge', style: { width: 1, 'line-color': '#C3CDE6', 'curve-style': 'haystack', 'haystack-tolerance': 0.4 } },
    { selector: 'edge[type="PREFERS"], edge[type="RELATES_TO"]', style: { 'line-color': '#9CC7B0' } },
    { selector: '.dim', style: { opacity: 0.1 } },
    { selector: '.hit', style: { 'border-width': 2, 'border-color': '#E8B550' } }
  ];
  function layoutConf() {
    const base = { name: state.layout, animate: true, animationDuration: 400, nodeDimensionsIncludeLabels: true };
    if (state.layout === 'breadthfirst') return Object.assign(base, { directed: true, spacingFactor: 1.2 });
    if (state.layout === 'circle') return Object.assign(base, { spacingFactor: 1.1 });
    return Object.assign(base, { nodeRepulsion: 6500, idealEdgeLength: 70 });
  }

  /* ── Cytoscape 按需加载(SRI 校验,完整性不符即拒载转下一源) ── */
  function ensureCy(cb) {
    if (window.cytoscape) return cb(true);
    if (state.cyLoading) { state.cyPending = cb; return; }   /* 加载中再触发:挂起,完成后补执行(切 tab/库不再被吞) */
    state.cyLoading = true;
    const trySrc = function (i) {
      if (i >= CY_SOURCES.length) { state.cyLoading = false; cb(false); return; }
      const s = document.createElement('script');
      s.src = CY_SOURCES[i].url;
      s.integrity = CY_SOURCES[i].integrity;
      s.crossOrigin = 'anonymous';
      s.onload = function () {
        state.cyLoading = false;
        cb(true);
        if (state.cyPending) { const p = state.cyPending; state.cyPending = null; p(true); }
      };
      s.onerror = function () { s.remove(); trySrc(i + 1); };
      document.head.appendChild(s);
    };
    trySrc(0);
  }

  /* ── 渲染 ── */
  function refresh() {
    renderCats();
    renderStores();
    renderStatus();
    renderGraph();
  }
  function renderCats() {
    const box = $('mem-cats');
    box.innerHTML = '';
    CAT_TABS.forEach(function (t) {
      const b = document.createElement('button');
      b.className = 'cat-chip' + (state.cat === t.key ? ' on' : '');
      b.textContent = t.label;
      b.onclick = function () { state.cat = t.key; refresh(); };
      box.appendChild(b);
    });
  }
  function renderStores() {
    const m = { stores: stores() };                       // stores() 见下,直接读底层
    const sel = $('mem-store');
    sel.innerHTML = stores().map(function (s) { return '<option value="' + s.id + '">' + EP.md.esc(s.name) + '</option>'; }).join('');
    if (state.store && stores().some(function (s) { return s.id === state.store; })) sel.value = state.store;
    else if (stores().length) state.store = stores()[0].id, sel.value = state.store;
  }
  function stores() {
    /* 与 memory.js 的存储一致:经 graphOf 不可拿库列表,这里读原始键 */
    try { return (JSON.parse(localStorage.getItem('ep_memory') || '{}').stores) || []; }
    catch (e) { return []; }
  }
  function renderStatus() {
    const p = EP.profile.load();
    const cnt = {
      company: p.facts.companies.length + p.facts.venues.length + p.facts.budgetTier.length + p.facts.audiences.length + p.defaults.duration.length,
      department: p.facts.departments.length,
      style: p.style.removedPhrases.length + p.facts.preferences.filter(function (x) { return x.cat === 'style'; }).length,
      misc: p.hotspots.length + p.facts.preferences.filter(function (x) { return x.cat !== 'style'; }).length
    };
    const total = cnt.company + cnt.department + cnt.style + cnt.misc;
    $('mem-profile-status').textContent = total
      ? '已学习 ' + total + ' 条记忆(公司 ' + cnt.company + ' · 部门 ' + cnt.department + ' · 风格 ' + cnt.style + ' · 其他 ' + cnt.misc + ')'
      : '尚未学习任何记忆';
  }
  function renderGraph() {
    const g0 = EP.memory.graphOf(state.store || '', { withProfile: true });
    state.lastGraph = g0;
    /* 模块 tab 过滤:只保留该模块的记忆节点与中心;MD 笔记节点在模块视图下隐藏 */
    let g = g0;
    if (state.cat) {
      const keep = {};
      Object.keys(g0.nodes).forEach(function (id) {
        const c = catOf(g0.nodes[id]);
        if (c === state.cat || c === '__center') keep[id] = g0.nodes[id];
      });
      g = { nodes: keep, edges: g0.edges.filter(function (e) { return keep[e.source] && keep[e.target]; }) };
    }
    const els = EP.memory.toCytoscape(g);
    $('mem-cy').removeAttribute('data-fallback');
    /* 空态 = 除常驻的档案中心外无任何节点(未导入且未学到偏好) */
    const realNodes = Object.keys(g.nodes).filter(function (id) { return g.nodes[id].type !== 'Profile'; }).length;
    if (!realNodes) {
      if (state.cy) { state.cy.destroy(); state.cy = null; }
      $('mem-cy').innerHTML = '<div class="empty-state" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div><b>还没有记忆</b>导入 MD 笔记,或先在创建活动中使用 AI,档案会自动生长</div></div>';
      hideDetail();
      return;
    }
    /* 大图保护:cose 力导向在千级节点同步计算会卡顿数秒,自动降级层次布局 */
    const N = els.elements.nodes.length;
    let conf = layoutConf();
    if (N > 800 && state.layout === 'cose') {
      conf = Object.assign(conf, { name: 'breadthfirst' });
      if (state.bigNotified !== N) {
        state.bigNotified = N;
        EP.app.toast('节点较多(' + N + ' 个),已自动改用层次布局避免卡顿;可点「布局」切换');
      }
    }
    ensureCy(function (ok) {
      if (!ok) { renderList(g, els); return; }
      if (!state.cy) {
        $('mem-cy').innerHTML = '';                   // 仅创建前清一次(空态提示/降级列表残留);canvas 此后由 cytoscape 自管
        state.cy = window.cytoscape({ container: $('mem-cy'), elements: els.elements, style: CY_STYLE, layout: conf, wheelSensitivity: 0.2 });
        state.cy.on('tap', 'node', function (e) { showDetail(e.target.data()); });
        state.cy.on('tap', function (e) { if (e.target === state.cy) hideDetail(); });
      } else {
        state.cy.elements().remove();
        state.cy.add(els.elements);
        state.cy.layout(conf).run();
      }
    });
  }
  /* CDN 不可达降级:列表视图(数据管理不阻塞) */
  function renderList(g, els) {
    if (state.cy) { state.cy.destroy(); state.cy = null; }
    $('mem-cy').setAttribute('data-fallback', '1');
    const rows = els.elements.nodes.map(function (n) {
      const raw = g.nodes[n.data.id] || {};
      return '<li><span class="chip mem-type-' + n.data.type + '">' + (TYPE_LABEL[n.data.type] || n.data.type) + '</span>' +
        '<span class="mem-li-label">' + EP.md.esc(n.data.label) + '</span>' +
        (raw.path ? '<span class="mem-li-path">' + EP.md.esc(raw.path) + '</span>' : '') + '</li>';
    }).join('');
    $('mem-cy').innerHTML = '<div class="mem-fallback"><p class="modal-note">渲染库加载失败(离线?),已切换列表视图;数据导入/删除/导出不受影响。</p><ul class="mem-list">' + rows + '</ul></div>';
  }

  /* ── 节点详情与操作 ── */
  function showDetail(d) {
    const raw = (state.lastGraph && state.lastGraph.nodes[d.id]) || {};
    const deg = state.cy ? state.cy.getElementById(d.id).degree(false) : 0;
    const box = $('mem-detail');
    let html = '<h4>' + EP.md.esc(d.label) + '</h4>' +
      '<p class="mem-meta">' + (TYPE_LABEL[d.type] || d.type) + ' · 连接 ' + deg + ' 条</p>' +
      (raw.path ? '<p class="mem-meta">📄 ' + EP.md.esc(raw.path) + '</p>' : '') +
      (raw.updatedAt ? '<p class="mem-meta">更新于 ' + new Date(raw.updatedAt).toLocaleString('zh-CN', { hour12: false }) + '</p>' : '');
    if (raw.type === 'Preference' && raw.props && raw.props.section) {
      html += '<button class="btn btn-danger-ghost btn-sm" id="mem-del-pref">删除此记忆</button>';
    } else if (raw.type === 'Note') {
      html += '<button class="btn btn-danger-ghost btn-sm" id="mem-del-node">移除此文件子图</button>';
    } else if (raw.type === 'Tag' || raw.type === 'Concept' || raw.type === 'Heading') {
      html += '<button class="btn btn-danger-ghost btn-sm" id="mem-del-node">删除节点及边</button>';
    }
    if (raw.path) html += ' <button class="btn btn-ghost btn-sm" id="mem-copy-path">复制路径</button>';
    box.innerHTML = html;
    box.hidden = false;
    const del = function (fn) { fn(); hideDetail(); refresh(); };
    const dp = $('mem-del-pref');
    if (dp) dp.onclick = function () {
      del(function () {
        EP.profile.remove(raw.props.section, raw.props.value);
        EP.app.toast('已删除该条记忆,之后的生成不再携带');
      });
    };
    const dn = $('mem-del-node');
    if (dn) dn.onclick = function () {
      del(function () { EP.memory.removeNode(state.store, d.id); EP.app.toast('已删除节点及关联边'); });
    };
    const cp = $('mem-copy-path');
    if (cp) cp.onclick = function () {
      try { navigator.clipboard.writeText(raw.path); EP.app.toast('路径已复制'); } catch (e) { EP.app.toast('复制失败', 'err'); }
    };
  }
  function hideDetail() { $('mem-detail').hidden = true; }

  /* ── 导入(浏览器 FileList → 纯数据数组;逐文件容错,坏文件不拖垮整批) ── */
  async function handleFiles(fileList) {
    if (!state.store) { EP.app.toast('请先新建记忆库', 'warn'); return; }
    const files = []; const failed = [];
    for (const f of fileList) {
      if (!/\.(md|markdown|txt)$/i.test(f.name)) continue;
      try {
        files.push({ path: f.webkitRelativePath || f.name, text: await f.text(), mtime: f.lastModified });
      } catch (e) { failed.push(f.name); }
    }
    if (!files.length) {
      EP.app.toast(failed.length ? '没有可导入的文件(读取失败 ' + failed.length + ' 个)' : '所选内容中没有 .md 文件', 'warn');
      return;
    }
    try {
      const r = EP.memory.importFiles(state.store, files);
      EP.app.toast('导入完成:' + r.added + ' 新 / ' + r.updated + ' 更新 / ' + r.skipped + ' 未变' +
        (failed.length ? ';另有 ' + failed.length + ' 个文件读取失败已跳过' : ''));
      renderGraph(); renderStatus();
    } catch (e) { EP.app.toast(e.message || '导入失败', 'err'); }
  }

  /* ── 过往方案导入(docs/14):提取文本 → AI 结构化 → 入档(逐文件容错) ── */
  async function handleIntake(fileList) {
    if (!EP.ai.ready()) { EP.app.toast('解析过往方案需先在「设置」配置 AI 接口', 'warn'); return; }
    let ok = 0;
    for (const f of fileList) {
      try {
        EP.app.toast('正在提取「' + f.name + '」文本…');
        const text = await EP.intake.extractText(f);
        if (!text || text.length < 50) { EP.app.toast('「' + f.name + '」未提取到足够文本(可能是扫描件/图片)', 'err'); continue; }
        EP.app.toast('AI 正在解析「' + f.name + '」的策划偏好…');
        const parsed = await EP.ai.parsePastPlan(text);
        if (!parsed.preferences.length && !parsed.facts.length) { EP.app.toast('「' + f.name + '」未发现可复用的偏好'); continue; }
        EP.profile.record({ t: 'past_plan_parsed', data: { name: f.name, facts: parsed.facts, preferences: parsed.preferences } });
        ok++;
      } catch (e) { EP.app.toast('「' + f.name + '」导入失败:' + ((e && e.message) || e), 'err'); }
    }
    if (ok) { EP.app.toast('已从 ' + ok + ' 份过往方案学习偏好,生成时将参考其排版与风格'); refresh(); }
  }
  /* 编辑对收集:方案库中有 prev 的章节 = "AI 初稿 vs 用户终稿"样本 */
  function collectPairs() {
    const pairs = [];
    EP.store.getPlans().forEach(function (p) {
      (p.sections || []).forEach(function (s) {
        if (s.prev && s.md && s.prev !== s.md && pairs.length < 5) pairs.push({ prev: s.prev, next: s.md });
      });
    });
    return pairs;
  }
  async function induceFromEdits() {
    const pairs = collectPairs();
    if (pairs.length < 3) { EP.app.toast('编辑样本不足:需要至少 3 处「AI 初稿 → 你的终稿」修改(重写/润色后再改几处)', 'warn'); return; }
    if (!EP.ai.ready()) { EP.app.toast('归纳偏好需先在「设置」配置 AI 接口', 'warn'); return; }
    EP.app.toast('AI 正在从你的 ' + pairs.length + ' 处编辑中归纳风格偏好…');
    try {
      const prefs = await EP.ai.inducePrefs(pairs);
      if (!prefs.length) { EP.app.toast('暂未发现稳定的编辑模式,多改几处 AI 内容后再试'); return; }
      EP.profile.record({ t: 'edit_induced', data: { preferences: prefs } });
      EP.app.toast('已归纳 ' + prefs.length + ' 条风格偏好(生成时作为排版与文风参考,图谱中可删)');
      refresh();
    } catch (e) { EP.app.toast((e && e.message) || '归纳失败', 'err'); }
  }

  /* ── 初始化(idempotent,由 app.openPanel('memory') 触发) ── */
  function init() {
    if (state.inited) { refresh(); return; }
    state.inited = true;
    $('mem-store').onchange = function () { state.store = this.value; renderGraph(); };
    $('mem-new').onclick = function () {
      EP.app.promptModal('新建记忆库', '', function (name) {
        if (!name || !name.trim()) return;
        state.store = EP.memory.createStore(name, '').id;
        refresh();
        EP.app.toast('已创建「' + name.trim() + '」');
      });
    };
    $('mem-del-store').onclick = function () {
      if (!state.store) return;
      const name = stores().find(function (s) { return s.id === state.store; });
      EP.app.confirmModal('删除笔记库「' + (name ? name.name : '') + '」?', '库内导入的图谱数据将一并删除;记忆偏好不受影响。', function () {
        EP.memory.deleteStore(state.store);
        state.store = null;
        refresh();
        EP.app.toast('记忆库已删除');
      });
    };
    $('mem-import').onclick = function () { $('mem-file-input').click(); };
    $('mem-import-dir').onclick = function () { $('mem-dir-input').click(); };
    $('mem-file-input').onchange = function (e) { handleFiles([...e.target.files]); e.target.value = ''; };
    $('mem-dir-input').onchange = function (e) { handleFiles([...e.target.files]); e.target.value = ''; };
    $('mem-intake').onclick = function () { $('mem-intake-input').click(); };
    $('mem-intake-input').onchange = function (e) { handleIntake([...e.target.files]); e.target.value = ''; };
    $('mem-induce').onclick = induceFromEdits;
    $('mem-layout').onclick = function () {
      const i = LAYOUTS.findIndex(function (l) { return l.key === state.layout; });
      state.layout = LAYOUTS[(i + 1) % LAYOUTS.length].key;
      this.textContent = '布局:' + LAYOUTS[(i + 1) % LAYOUTS.length].name;
      if (state.cy) state.cy.layout(layoutConf()).run();
    };
    $('mem-export').onclick = function () {
      if (!state.store) { EP.app.toast('请先新建记忆库', 'warn'); return; }
      EP.memory.exportJSON(state.store);
      EP.app.toast('已导出记忆库 JSON');
    };
    let t = null;
    $('mem-search').oninput = function () {
      const q = this.value.trim().toLowerCase();
      clearTimeout(t);
      t = setTimeout(function () { search(q); }, 200);
    };
    $('mem-profile-clear').onclick = function () {
      const p = EP.profile.load();
      if (!p.events.length) { EP.app.toast('记忆库为空,无需清除'); return; }
      EP.app.confirmModal('清除记忆库?', '已学习的偏好(' + p.events.length + ' 次使用观察)将被删除,之后的生成不再携带记忆库参考。方案与记忆库导入内容不受影响。', function () {
        EP.profile.clear();
        refresh();
        EP.app.toast('记忆库已清除');
      });
    };
    refresh();
  }
  function search(q) {
    if (!state.cy) return;
    state.cy.elements().removeClass('dim hit');
    if (!q) return;
    const hit = state.cy.nodes().filter(function (n) { return (n.data('label') || '').toLowerCase().includes(q); });
    state.cy.elements().addClass('dim');
    hit.removeClass('dim');
    hit.neighborhood().removeClass('dim');
    hit.addClass('hit');
    if (hit.length) state.cy.fit(hit, 90);
  }

  return { init: init, refresh: refresh, handleFiles: handleFiles, handleIntake: handleIntake, induceFromEdits: induceFromEdits };
})();
