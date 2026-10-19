/* memoryview.js — 记忆库面板(抽屉入口,docs/13/15/16)
   Cytoscape 按需从 CDN 加载(unpkg→jsdelivr),双源失败降级为列表视图,数据管理不阻塞;
   V1.1:记忆节点优先呈现 EP.wiki 编译页面(docs/16,编译式记忆库),未编译时为
   EP.profile 实时活视图;「编译记忆」、图谱/洞察双视图(待确认矛盾 + 健康检查 + 图谱洞察)。
   V1.1.1:分类 tab 删除,分类下沉图谱本体(节点按 cat 着色 + 图内图例);
   滚轮穿透修复(普通滚轮滚动页面,Ctrl+滚轮才缩放图谱)。 */
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
  const TYPE_LABEL = { File: '文件', Folder: '文件夹', Note: '笔记', Tag: '标签', Entity: '实体', Preference: '偏好记忆', Concept: '概念', Profile: '记忆库', Wiki: '记忆页面' };
  const state = { inited: false, cy: null, layout: 'cose', store: null, lastGraph: null, cyLoading: false, view: 'graph', butler: { msgs: [], busy: false, pending: null } };
  /* 分类颜色契约(图谱本体即分类):与图例 .lg-* 一致 */
  const CAT_COLOR = { company: '#2E5BE0', department: '#8B5CF6', style: '#E8B550', misc: '#3E9B6F' };

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
    { selector: 'node[type="Wiki"]', style: { width: 20, height: 20, 'font-weight': 600 } },
    { selector: 'node[type="Wiki"][cat="company"]', style: { 'background-color': '#2E5BE0', color: '#0B2B66' } },
    { selector: 'node[type="Wiki"][cat="department"]', style: { 'background-color': '#8B5CF6' } },
    { selector: 'node[type="Wiki"][cat="style"]', style: { 'background-color': '#E8B550' } },
    { selector: 'node[type="Wiki"][cat="misc"]', style: { 'background-color': '#3E9B6F', color: '#256B47' } },
    { selector: 'node[level="confirmed"]', style: { 'border-width': 2.5, 'border-color': '#0B2B66' } },
    { selector: 'node[type="Profile"]', style: { 'background-color': '#0B2B66', width: 34, height: 34, 'font-size': 12, 'font-weight': 700 } },
    { selector: 'edge', style: { width: 1, 'line-color': '#C3CDE6', 'curve-style': 'haystack', 'haystack-tolerance': 0.4 } },
    { selector: 'edge[type="PREFERS"], edge[type="RELATES_TO"]', style: { 'line-color': '#9CC7B0' } },
    { selector: '.dim', style: { opacity: 0.1 } },
    { selector: '.hdim', style: { opacity: 0.14 } },
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
    renderStores();
    renderStatus();
    renderInsight();
    renderGraph();
    if (EP.app && EP.app.refreshMemBadge) EP.app.refreshMemBadge();   // V1.2 F5:进入面板/裁决后同步小红点
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
    /* V1.1 整理:状态行只报页数与待编译数(四模块分布看 tab 过滤,编译时间看菜单);未编译时维持档案口径 */
    const w = EP.wiki.load();
    const n = Object.keys(w.pages).length;
    if (n) {
      const pending = EP.wiki.pendingEvents(w).length;
      $('mem-profile-status').textContent = '已编译 ' + n + ' 页记忆' + (pending ? ' · ' + pending + ' 条待编译' : '');
      return;
    }
    const p = EP.profile.load();
    const total = p.facts.companies.length + p.facts.venues.length + p.facts.budgetTier.length + p.facts.audiences.length +
      p.defaults.duration.length + p.facts.departments.length + p.style.removedPhrases.length + p.facts.preferences.length + p.hotspots.length;
    $('mem-profile-status').textContent = total
      ? '已学习 ' + total + ' 条记忆 · 点「编译记忆」生成记忆页面'
      : '尚未学习任何记忆';
  }

  /* ── 洞察子页(V1.1.1):待确认矛盾 / 健康检查 / 图谱洞察 / 编译记录,集中一处由用户裁决 ── */
  function insightItems() {
    const items = [];
    EP.wiki.openReviews().forEach(function (r) {
      items.push({ kind: 'review', id: r.id, title: r.title || '(页面)', issue: r.issue, suggestion: r.suggestion, actions: ['apply', 'ignore', 'delete'] });
    });
    EP.wiki.lint().forEach(function (l) {
      items.push({ kind: 'lint:' + l.type, id: 'lint:' + l.key, title: l.title, issue: l.issue, suggestion: l.type === 'dup' ? '删除多余同名页面' : '删除过时/孤岛页面', actions: ['delete'] });
    });
    return items;
  }
  function renderInsight() {
    const box = $('mem-view-insight');
    if (!box) return;
    const items = insightItems();
    /* 分段徽标:待办数实时同步 */
    const badge = $('mem-seg-badge');
    if (badge) {
      badge.textContent = items.length;
      badge.hidden = !items.length;
    }
    const w = EP.wiki.load();
    const ins = (Object.keys(w.pages).length >= 2) ? EP.wiki.insights() : { hubs: [], bridges: [], gaps: [] };
    let html = '';
    if (items.length) {
      const ACT = { apply: '标记已处理', ignore: '忽略', delete: '删除页面' };
      html += '<div class="mem-sec-title">待确认<span class="cnt">' + items.length + '</span></div>' +
        '<div class="mem-reviews">' + items.map(function (it, i) {
          return '<div class="mem-rev-card"><span class="chip">' + EP.md.esc(it.kind === 'review' ? '矛盾' : '检查') + '</span>' +
            '<b>' + EP.md.esc(it.title) + '</b><p>' + EP.md.esc(it.issue) +
            (it.suggestion ? '<br>建议:' + EP.md.esc(it.suggestion) : '') + '</p><div class="mem-rev-actions">' +
            it.actions.map(function (a) { return '<button class="btn btn-ghost btn-sm" data-act="' + a + '" data-i="' + i + '">' + ACT[a] + '</button>'; }).join('') +
            '</div></div>';
        }).join('') + '</div>';
    }
    const insightLines = []
      .concat(ins.hubs.map(function (h) { return '「' + h.title + '」是核心页面(' + h.cat + '),被 ' + h.deg + ' 页关联'; }))
      .concat(ins.bridges.map(function (b) { return '「' + b.title + '」(' + b.cat + ')连接了不同模块,是跨域记忆的桥梁'; }))
      .concat(ins.gaps.map(function (g) { return g.cat + '模块:' + g.issue; }));
    if (insightLines.length) {
      html += '<div class="mem-sec-title">图谱洞察</div>' +
        insightLines.map(function (l) { return '<div class="mem-insight-line">' + EP.md.esc(l) + '</div>'; }).join('');
    }
    if (w.compileLog.length) {
      html += '<div class="mem-sec-title">编译记录</div><div class="mem-log">' +
        w.compileLog.slice(-8).reverse().map(function (e) {
          return '<div><b>' + new Date(e.at).toLocaleString('zh-CN', { hour12: false }) + '</b> · ' +
            (e.mode === 'ai' ? 'AI 两步编译' : '本地编译') + ':' + e.eventsIn + ' 条事件 → ' + e.pagesChanged + ' 页更新</div>';
        }).join('') + '</div>';
    }
    box.innerHTML = html || '<div class="mem-insight-empty">没有待处理事项<br>编译产生的记忆矛盾与健康检查会出现在这里;图谱洞察与编译记录也在此沉淀</div>';
    box.querySelectorAll('button[data-act]').forEach(function (b) {
      b.onclick = function () {
        const it = items[Number(b.dataset.i)];
        if (it.kind === 'review') EP.wiki.resolveReview(it.id, b.dataset.act);
        else if (b.dataset.act === 'delete') EP.wiki.remove(it.id.slice(5));
        EP.app.toast(b.dataset.act === 'delete' ? '已删除该记忆页面(不会被编译复活)' : '已处理');
        refresh();
      };
    });
  }

  /* ── 记忆精灵(docs/18 F10):对话管记忆;AI 只给建议动作,点「应用」才落库 ── */
  const ACT_NAME = { update: '更新', delete: '删除', merge: '合并', resolve: '处理矛盾' };
  function renderButler() {
    const box = $('butler-msgs');
    if (!box) return;
    const b = state.butler;
    box.innerHTML = b.msgs.map(function (m) {
      if (m.kind === 'user') return '<div class="msg user">' + EP.md.esc(m.text) + '</div>';
      if (m.kind === 'ai') return '<div class="msg ai">' + EP.md.esc(m.text) + '</div>';
      if (m.kind === 'err') return '<div class="msg err">' + EP.md.esc(m.text) + '</div>';
      if (m.kind === 'actions') {
        return '<div class="msg action-card"><b>建议 ' + m.actions.length + ' 项修改(应用后才生效)</b>' +
          m.actions.map(function (a) {
            return '<div class="act-line">· ' + (ACT_NAME[a.type] || a.type) + ':' + EP.md.esc(a.title || a.key) +
              (a.type === 'merge' && a.key2 ? ' ← 并入 ' + EP.md.esc(a.key2) : '') +
              (a.body ? '<br><span style="color:#977A3C">新内容:' + EP.md.esc(String(a.body).slice(0, 80)) + (a.body.length > 80 ? '…' : '') + '</span>' : '') + '</div>';
          }).join('') +
          (m.done ? '<b style="display:block;margin-top:6px">✓ 已应用</b>' :
            '<div class="butler-apply-row"><button class="btn btn-primary btn-sm" data-bapply="' + b.msgs.indexOf(m) + '">应用全部</button>' +
            '<button class="btn btn-ghost btn-sm" data-bignore="' + b.msgs.indexOf(m) + '">忽略</button></div>') + '</div>';
      }
      return '';
    }).join('');
    box.scrollTop = box.scrollHeight;
    box.querySelectorAll('[data-bapply]').forEach(function (btn) {
      btn.onclick = function () {
        const m = b.msgs[Number(btn.dataset.bapply)];
        const r = EP.wiki.applyActions(m.actions);
        m.done = true;
        EP.app.toast('已应用 ' + r.applied + ' 项修改');
        refresh();
        renderButler();
      };
    });
    box.querySelectorAll('[data-bignore]').forEach(function (btn) {
      btn.onclick = function () { b.msgs[Number(btn.dataset.bignore)].done = true; renderButler(); };
    });
  }
  async function sendButler(text) {
    const b = state.butler;
    if (b.busy || !text) return;
    if (!EP.ai.ready()) { EP.app.toast('记忆精灵需先在「设置」配置 AI 接口', 'warn'); return; }
    b.msgs.push({ kind: 'user', text: text });
    b.busy = true;
    renderButler();
    try {
      const r = await EP.wiki.butler(text);
      b.msgs.push({ kind: 'ai', text: r.reply || '(已分析)' });
      if (r.actions && r.actions.length) b.msgs.push({ kind: 'actions', actions: r.actions, done: false });
    } catch (e) {
      b.msgs.push({ kind: 'err', text: (e && e.message) || '操作失败,请重试' });
    }
    b.busy = false;
    renderButler();
  }

  /* ── 编译记忆(docs/16):手动触发,如实汇报结果与失败 ── */
  async function doCompile() {
    if (!EP.wiki.pendingEvents().length) { EP.app.toast('没有新事件需要编译'); return; }
    const b = $('mem-compile');
    const orig = b.innerHTML;
    b.disabled = true; b.textContent = '编译中…';
    try {
      const r = await EP.wiki.compile({ force: true });
      EP.app.toast('记忆编译完成:' + (r.mode === 'ai' ? 'AI 两步编译' : '本地确定性编译') + ',' +
        r.eventsIn + ' 条事件 → ' + r.pagesChanged + ' 页更新' + (r.reviewsAdded ? ',' + r.reviewsAdded + ' 条待确认' : ''));
      refresh();
    } catch (e) {
      EP.app.toast('编译失败:' + ((e && e.message) || e), 'err');
    } finally {
      b.disabled = false; b.innerHTML = orig;
    }
  }
  function renderGraph() {
    const g = EP.memory.graphOf(state.store || '', { withProfile: true });
    state.lastGraph = g;
    const els = EP.memory.toCytoscape(g);
    /* 分类下沉图谱:节点按 cat 着色、确认级描边(toCytoscape 只给 props 字符串,这里补独立 data 字段供选择器用) */
    els.elements.nodes.forEach(function (n) {
      const raw = g.nodes[n.data.id];
      if (raw && raw.type === 'Wiki' && raw.props) {
        n.data.cat = raw.props.cat || 'misc';
        n.data.level = raw.props.level || '';
      }
    });
    $('mem-cy').removeAttribute('data-fallback');
    /* 空态 = 除常驻的档案中心外无任何节点(未导入且未学到偏好) */
    const realNodes = Object.keys(g.nodes).filter(function (id) { return g.nodes[id].type !== 'Profile'; }).length;
    if (!realNodes) {
      if (state.cy) { state.cy.destroy(); state.cy = null; }
      $('mem-cy').innerHTML = '<div class="empty-state" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div><b>还没有记忆</b>点右下角「＋导入」添加笔记,或先去创建活动——使用中记忆会自动生长</div></div>';
      hideDetail();
      return;
    }
    /* 大图保护:cose 力导向在千级节点同步计算会卡顿数秒,自动降级层次布局 */
    const N = els.elements.nodes.length;
    let conf = layoutConf();
    if (!els.elements.edges.length && state.layout === 'cose') conf = Object.assign(conf, { name: 'grid' });   /* 去中心后无边的档案视图:网格排布更整齐 */
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
        /* 悬停高亮:突出该节点及其连线邻域,其余压灰;用独立 hdim 类,与搜索的 dim 高亮互不覆盖 */
        state.cy.on('mouseover', 'node', function (e) {
          state.cy.elements().not(e.target.closedNeighborhood()).addClass('hdim');
        });
        state.cy.on('mouseout', 'node', function () {
          state.cy.elements().removeClass('hdim');
        });
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
    if (raw.type === 'Wiki' && raw.props) {
      /* 记忆页面详情(docs/16):观察句 + 两级标记 + 溯源 */
      const pr = raw.props;
      const pg = EP.wiki.load().pages[pr.key] || {};
      html += (pr.desc ? '<p class="mem-meta">检索描述:' + EP.md.esc(pr.desc) + '</p>' : '') +
        '<p class="mem-wiki-body">' + EP.md.esc(pr.body || '') + '</p>' +
        '<p class="mem-meta">' + (pr.level === 'confirmed' ? '✓ 确认级(生成时严格遵守)' : '归纳级(仅供参考)') +
        (pr.sub ? ' · 细分:' + pr.sub : '') +
        ((pr.sources && pr.sources.length) ? ' · 溯源:' + pr.sources.length + ' 条事件' : ' · 来源:档案统计') +
        ((pg.injectedCount || pg.verified) ? ' · 注入 ' + (pg.injectedCount || 0) + ' 次' + (pg.verified ? ' · 被导出认可 ' + pg.verified + ' 次' : '') : '') + '</p>' +
        '<button class="btn btn-danger-ghost btn-sm" id="mem-del-wiki">删除此页面</button>';
    } else if (raw.type === 'Preference' && raw.props && raw.props.section) {
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
    const dw = $('mem-del-wiki');
    if (dw) dw.onclick = function () {
      del(function () {
        EP.wiki.remove(raw.props.key);
        EP.app.toast('已删除该记忆页面(已加 tombstone,编译不会复活)');
      });
    };
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
    if (!state.store) { EP.app.toast('请先在「⋯」菜单新建笔记库', 'warn'); return; }
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
  /* V1.2 F9:导入前先选类型 —— 过往策划案 / 公司制度·部门资料,两套解析契约 */
  function handleIntake(fileList) {
    if (!EP.ai.ready()) { EP.app.toast('解析文件需先在「设置」配置 AI 接口', 'warn'); return; }
    const d = document.createElement('div');
    d.style.cssText = 'color:var(--ink-2);font-size:14px;line-height:1.8';
    d.innerHTML = '<p style="margin:0 0 6px"><b>' + fileList.length + '</b> 个文件,按哪种类型解析?</p>' +
      '<p style="margin:0;font-size:12.5px;color:var(--ink-3)">策划案提取风格与偏好;制度/部门资料提取组织事实与品牌口径</p>';
    EP.app.modal('导入类型', d, [
      { txt: '取消' },
      { txt: '公司制度 / 部门资料', fn: function () { runIntake(fileList, 'org'); } },
      { txt: '过往策划案', cls: 'btn-primary', fn: function () { runIntake(fileList, 'plan'); } }
    ]);
  }
  async function runIntake(fileList, kind) {
    let ok = 0;
    for (const f of fileList) {
      try {
        EP.app.toast('正在提取「' + f.name + '」文本…');
        const text = await EP.intake.extractText(f);
        if (!text || text.length < 50) { EP.app.toast('「' + f.name + '」未提取到足够文本(可能是扫描件/图片)', 'err'); continue; }
        EP.app.toast('AI 正在解析「' + f.name + '」' + (kind === 'org' ? '的组织事实与规范…' : '的策划偏好…'));
        const parsed = await EP.ai.parsePastPlan(text, kind);
        if (!parsed.preferences.length && !parsed.facts.length) { EP.app.toast('「' + f.name + '」未发现可复用的内容'); continue; }
        EP.profile.record({ t: 'past_plan_parsed', data: { name: f.name, kind: kind, facts: parsed.facts, preferences: parsed.preferences } });
        ok++;
      } catch (e) { EP.app.toast('「' + f.name + '」导入失败:' + ((e && e.message) || e), 'err'); }
    }
    if (ok) { EP.app.toast('已从 ' + ok + ' 份文件学习' + (kind === 'org' ? '组织事实与规范' : '策划偏好') + ',生成时将参考'); refresh(); }
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
    EP.wiki.init();                                       // 幂等迁移:老档案 → 种子记忆页面
    /* 滚轮穿透修复:普通滚轮 = 页面滚动(捕获阶段拦截,不让 cytoscape 吞掉);
       Ctrl+滚轮 / 触控板双指捏合(ctrlKey wheel)= 图谱缩放 */
    $('mem-cy').addEventListener('wheel', function (e) {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    }, true);
    /* 图谱 / 洞察 双视图切换 */
    const setView = function (v) {
      state.view = v;
      $('mem-seg-graph').classList.toggle('on', v === 'graph');
      $('mem-seg-insight').classList.toggle('on', v === 'insight');
      $('mem-view-graph').hidden = v !== 'graph';
      $('mem-view-insight').hidden = v !== 'insight';
      if (v === 'graph' && state.cy) state.cy.resize();
    };
    $('mem-seg-graph').onclick = function () { setView('graph'); };
    $('mem-seg-insight').onclick = function () { setView('insight'); };
    /* 导出记忆页面为 Obsidian 兼容 Markdown(llm_wiki「wiki 即 vault」) */
    $('mem-export-wiki').onclick = function () {
      closePops();
      const w = EP.wiki.load();
      if (!Object.keys(w.pages).length) { EP.app.toast('还没有记忆页面,先编译或使用后再导出', 'warn'); return; }
      const blob = new Blob([EP.wiki.toMarkdown()], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '秒策记忆库-' + new Date().toISOString().slice(0, 10) + '.md';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 15000);
      EP.app.toast('已导出记忆页面 Markdown(含索引与互链)');
    };
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
    /* 图谱右下角浮层(V1.1 整理):+导入 / ⋯ 管理两个弹出菜单,收拢全部低频入口 */
    const closePops = function (except) {
      ['mem-pop-import', 'mem-pop-more'].forEach(function (id) { if (id !== except) $(id).hidden = true; });
    };
    $('mem-fab-import').onclick = function (e) {
      e.stopPropagation();
      const show = $('mem-pop-import').hidden;
      closePops();
      $('mem-pop-import').hidden = !show;
    };
    $('mem-fab-more').onclick = function (e) {
      e.stopPropagation();
      const show = $('mem-pop-more').hidden;
      closePops();
      $('mem-pop-more').hidden = !show;
      if (show) renderStores();                             // 打开时刷新库列表
    };
    document.addEventListener('mousedown', function (e) {
      if (e.target.closest('.mem-popover') || e.target.closest('.mem-fabs')) return;
      closePops();
    });
    document.querySelectorAll('#mem-pop-import [data-mimport]').forEach(function (b) {
      b.onclick = function () {
        closePops();
        const act = b.dataset.mimport;
        if (act === 'file') $('mem-file-input').click();
        else if (act === 'dir') $('mem-dir-input').click();
        else if (act === 'intake') $('mem-intake-input').click();
        else if (act === 'induce') induceFromEdits();
      };
    });
    $('mem-file-input').onchange = function (e) { handleFiles([...e.target.files]); e.target.value = ''; };
    $('mem-dir-input').onchange = function (e) { handleFiles([...e.target.files]); e.target.value = ''; };
    $('mem-intake-input').onchange = function (e) { handleIntake([...e.target.files]); e.target.value = ''; };
    $('mem-compile').onclick = doCompile;
    /* 记忆精灵面板(F10) */
    $('mem-butler').onclick = function () {
      const p = $('butler-panel');
      p.hidden = !p.hidden;
      if (!p.hidden) { renderButler(); $('butler-input').focus(); }
    };
    $('butler-close').onclick = function () { $('butler-panel').hidden = true; };
    $('butler-send').onclick = function () {
      const inp = $('butler-input');
      const t = inp.value.trim();
      if (!t) return;
      inp.value = '';
      sendButler(t);
    };
    $('butler-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('butler-send').click(); }
    });
    document.querySelectorAll('.butler-quick button').forEach(function (b2) {
      b2.onclick = function () { sendButler(b2.dataset.bq); };
    });
    /* 静默自动编译:积压 ≥6 条事件时后台补一次(成功静默刷新,失败不打扰;手动编译仍可随时触发) */
    if (EP.wiki.pendingEvents().length >= 6)
      EP.wiki.compile().then(function () { refresh(); }).catch(function () { });
    $('mem-layout').onclick = function () {
      const i = LAYOUTS.findIndex(function (l) { return l.key === state.layout; });
      state.layout = LAYOUTS[(i + 1) % LAYOUTS.length].key;
      this.title = '切换布局(当前:' + LAYOUTS[(i + 1) % LAYOUTS.length].name + ')';
      if (state.cy) state.cy.layout(layoutConf()).run();
    };
    $('mem-export').onclick = function () {
      if (!state.store) { EP.app.toast('请先在「⋯」菜单新建笔记库', 'warn'); return; }
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
      const w = EP.wiki.load();
      if (!p.events.length && !Object.keys(w.pages).length) { EP.app.toast('记忆库为空,无需清除'); return; }
      EP.app.confirmModal('清除记忆库?', '已学习的偏好与编译的记忆页面(' + p.events.length + ' 次使用观察)将被删除,之后的生成不再携带记忆库参考。方案与笔记库导入内容不受影响。', function () {
        EP.profile.clear();
        EP.wiki.clear();                                  // 原始层与编译层一并清除(含 tombstone,全部重学)
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
