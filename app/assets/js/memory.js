/* memory.js — 记忆库图谱数据层(docs/13)
   零后端等价物:Graphiti 的形态(节点/边/命名空间/时间有效性)以纯函数 + localStorage 实现;
   MD 解析 → Note/Heading/Tag/Concept 节点与 CONTAINS/HAS_TAG/LINKS_TO 边;
   偏好子图(PREFERS/RELATES_TO)不落库,渲染时从 EP.profile 实时拼装,删除经 EP.profile.remove 回写。
   toCytoscape 为 Graphiti 形态 → Cytoscape JSON 的适配层。 */
window.EP = window.EP || {};
EP.memory = (function () {
  const K = 'ep_memory';
  const MAX_NODES = 3000;          // 单库上限:防 localStorage 溢出,超限报错引导分库/清理

  /* ── 工具 ── */
  function hash(s) {               // FNV-1a 32bit → base36(同步,变更检测足够)
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(36);
  }
  const nid = function (type, key) { return type + ':' + hash(key); };
  const eid = function (s, t, ty) { return hash(s + '>' + ty + '>' + t); };

  function load() {
    try {
      const v = localStorage.getItem(K);
      const m = v ? JSON.parse(v) : null;
      return { ver: 1, stores: (m && m.stores) || [], graphs: (m && m.graphs) || {}, files: (m && m.files) || {} };
    } catch (e) { return { ver: 1, stores: [], graphs: {}, files: {} }; }
  }
  function save(m) { try { localStorage.setItem(K, JSON.stringify(m)); return true; } catch (e) { return false; } }

  /* ── 记忆库 CRUD ── */
  function createStore(name, desc) {
    const m = load();
    const st = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.trim() || '未命名库', desc: (desc || '').trim(), createdAt: Date.now() };
    m.stores.push(st);
    if (!save(m)) throw new Error('本地存储写入失败(可能已满)');
    return st;
  }
  function deleteStore(id) {
    const m = load();
    m.stores = m.stores.filter(function (s) { return s.id !== id; });
    delete m.graphs[id]; delete m.files[id];
    save(m);
  }
  function renameStore(id, name) {
    const m = load();
    const st = m.stores.find(function (s) { return s.id === id; });
    if (st && name.trim()) { st.name = name.trim(); save(m); }
  }

  /* ── MD 解析:frontmatter(k:v 子集)/ 标题 / [[wikilink]](含 #锚点 |别名)/ 行内标签;
        普通 [text](url) 链接不采集(外部噪音) ── */
  function parseMd(text) {
    let body = String(text || '');
    const fm = {}; let fmTags = [];
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
    if (fmMatch) {
      body = body.slice(fmMatch[0].length);
      fmMatch[1].split(/\r?\n/).forEach(function (line) {
        const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
        if (!m) return;
        const val = m[2].replace(/^["']|["']$/g, '').trim();
        if (m[1] === 'tags') fmTags = val.split(/[,;、]\s*/).filter(Boolean);
        else fm[m[1]] = val;
      });
    }
    const headings = [], wikilinks = [], tags = [];
    body.split(/\r?\n/).forEach(function (line) {
      const h = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
      if (h) headings.push({ level: h[1].length, text: h[2] });
      const wm = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
      let w; while ((w = wm.exec(line))) { const t = w[1].trim(); if (t) wikilinks.push(t); }
      const tm = /(^|\s)#([^\s#.,;:!?"'()<>、]+)/g;    // # 后紧跟非空白 = 标签(标题行 # 后有空格,不冲突)
      let t; while ((t = tm.exec(line))) { if (t[2]) tags.push(t[2]); }
    });
    return { fm: fm, fmTags: fmTags, headings: headings, wikilinks: wikilinks, tags: tags };
  }

  /* ── 单文件 → 子图 ── */
  function buildFileGraph(g, f) {
    const r = parseMd(f.text);
    const now = Date.now();
    const noteId = nid('Note', f.path);
    const label = r.fm.title || (r.headings[0] && r.headings[0].text) ||
      f.path.replace(/.*[\/\\]/, '').replace(/\.md$/i, '');
    g.nodes[noteId] = { id: noteId, label: label, type: 'Note', path: f.path, createdAt: now, updatedAt: now, props: r.fm };
    const addEdge = function (src, tgt, type) {
      const id = eid(src, tgt, type);
      if (!g.edges.some(function (e) { return e.id === id; }))
        g.edges.push({ id: id, source: src, target: tgt, type: type, fact: '', validAt: now, invalidAt: null });
    };
    r.headings.slice(1).forEach(function (h) {          // 首个一级标题即 Note label,不重复建节点
      const hid = nid('Heading', f.path + '#' + h.text);
      g.nodes[hid] = { id: hid, label: h.text, type: 'Heading', path: f.path, createdAt: now, updatedAt: now, props: { level: h.level } };
      addEdge(noteId, hid, 'CONTAINS');
    });
    const seen = {};
    r.fmTags.concat(r.tags).forEach(function (t) {
      if (!t || seen[t]) return; seen[t] = 1;
      const tid = nid('Tag', t);
      if (!g.nodes[tid]) g.nodes[tid] = { id: tid, label: t, type: 'Tag', createdAt: now, updatedAt: now, props: {} };
      addEdge(noteId, tid, 'HAS_TAG');
    });
    r.wikilinks.forEach(function (w) {
      const note = Object.keys(g.nodes).map(function (k) { return g.nodes[k]; })
        .find(function (n) { return n.type === 'Note' && n.label === w; });
      let tid = note ? note.id : nid('Concept', w);
      if (!g.nodes[tid]) g.nodes[tid] = { id: tid, label: w, type: 'Concept', createdAt: now, updatedAt: now, props: {} };
      addEdge(noteId, tid, 'LINKS_TO');
    });
  }

  /* ── 删除一个文件旧子图:Note + 同文件 Heading + 孤儿 Tag/Concept ── */
  function removeFileSubgraph(g, path) {
    prune(g, function (n) { return n.type === 'Note' && n.path === path; });
  }
  function prune(g, matchNote) {
    const start = Object.keys(g.nodes).map(function (k) { return g.nodes[k]; }).filter(matchNote).map(function (n) { return n.id; });
    const doomed = {};
    start.forEach(function (id) { doomed[id] = 1; });
    g.edges.slice().forEach(function (e) {
      if (e.type === 'CONTAINS' && doomed[e.source]) doomed[e.target] = 1;   // Note 的 Heading
    });
    g.edges = g.edges.filter(function (e) { return !doomed[e.source] && !doomed[e.target]; });
    Object.keys(g.nodes).forEach(function (id) {             // 入度归零的 Tag/Concept 一并清理
      const t = g.nodes[id] && g.nodes[id].type;
      if ((t === 'Tag' || t === 'Concept') && !doomed[id] &&
          !g.edges.some(function (e) { return e.source === id || e.target === id; })) doomed[id] = 1;
    });
    Object.keys(doomed).forEach(function (id) { delete g.nodes[id]; });
  }

  /* ── 悬空 Concept 解析:目标 Note 到达后重定向并吸收 Concept ── */
  function resolveConcepts(g) {
    Object.keys(g.nodes).map(function (k) { return g.nodes[k]; })
      .filter(function (n) { return n.type === 'Concept'; })
      .forEach(function (c) {
        const note = Object.keys(g.nodes).map(function (k) { return g.nodes[k]; })
          .find(function (n) { return n.type === 'Note' && n.label === c.label; });
        if (!note) return;
        g.edges.forEach(function (e) {
          if (e.target === c.id) { e.target = note.id; e.id = eid(e.source, note.id, e.type); }
        });
        delete g.nodes[c.id];
      });
    g.edges = g.edges.filter(function (e, i) {               // 重定向可能产生的重复边去重
      return g.edges.findIndex(function (x) { return x.id === e.id; }) === i;
    });
  }

  /* ── 批量导入(增量:同 path 同 hash 跳过;变更重建子图) ── */
  function importFiles(storeId, files) {
    const m = load();
    if (!m.stores.some(function (s) { return s.id === storeId; })) throw new Error('记忆库不存在');
    const g = m.graphs[storeId] = m.graphs[storeId] || { nodes: {}, edges: [] };
    const reg = m.files[storeId] = m.files[storeId] || [];
    let added = 0, updated = 0, skipped = 0;
    (files || []).forEach(function (f) {
      const h = hash(f.text || '');
      const prev = reg.find(function (r) { return r.path === f.path; });
      if (prev && prev.hash === h) { skipped++; return; }
      if (prev) { removeFileSubgraph(g, f.path); updated++; } else added++;
      if (prev) { prev.hash = h; prev.mtime = f.mtime; }
      else reg.push({ path: f.path, hash: h, mtime: f.mtime });
      buildFileGraph(g, f);
    });
    if (Object.keys(g.nodes).length > MAX_NODES)
      throw new Error('导入后节点数超过上限(' + MAX_NODES + '),请分库导入或先删除旧内容');
    resolveConcepts(g);
    if (!save(m)) throw new Error('本地存储写入失败(可能已满),请导出备份后清理');
    return { added: added, updated: updated, skipped: skipped };
  }

  function removeNode(storeId, nodeId) {
    const m = load();
    const g = m.graphs[storeId];
    if (!g || !g.nodes[nodeId]) return;
    const n = g.nodes[nodeId];
    g.edges = g.edges.filter(function (e) { return e.source !== nodeId && e.target !== nodeId; });
    delete g.nodes[nodeId];
    if (n.type === 'Note' && n.path) {                     // 删文件主节点 = 删该文件整棵子图并取消登记
      Object.keys(g.nodes).forEach(function (id) { if (g.nodes[id].path === n.path) delete g.nodes[id]; });
      m.files[storeId] = reg(m, storeId).filter(function (r) { return r.path !== n.path; });
    }
    pruneOrphans(g);
    save(m);
  }
  function reg(m, storeId) { return m.files[storeId] || (m.files[storeId] = []); }
  function pruneOrphans(g) {
    Object.keys(g.nodes).forEach(function (id) {
      const t = g.nodes[id] && g.nodes[id].type;
      if ((t === 'Tag' || t === 'Concept') &&
          !g.edges.some(function (e) { return e.source === id || e.target === id; })) delete g.nodes[id];
    });
  }

  /* ── 偏好子图:档案的活视图(不落库,EP.profile 为唯一事实源) ── */
  function profileGraph() {
    const P = EP.profile, S = EP.struct;
    const p = P.load();
    const now = Date.now();
    const nodes = {}, edges = [];
    /* V1.2:去「记忆库」中心节点(用户裁定:无用);未编译档案无边,仅偏好节点 */
    const pref = function (section, label, value, edgeType, cat) {
      const id = 'Preference:' + section + ':' + value;
      nodes[id] = { id: id, label: label, type: 'Preference', createdAt: now, updatedAt: now,
        props: { section: section, value: value, cat: cat || SECTION_CAT[section] || 'misc' } };
    };
    /* 记忆四模块(docs/15 F3):company=公司 / department=各部门 / style=策划案风格 / misc=其他偏好 */
    const SECTION_CAT = { companies: 'company', venues: 'company', budgetTier: 'company', audiences: 'company',
      duration: 'company', departments: 'department', removedPhrases: 'style', preferences: 'misc', hotspots: 'misc' };
    p.facts.companies.forEach(function (e) { pref('companies', '组织:' + e.value, e.value); });
    p.facts.venues.forEach(function (e) { pref('venues', '场地:' + e.value, e.value); });
    p.facts.budgetTier.forEach(function (e) { pref('budgetTier', '预算:' + e.value, e.value); });
    p.facts.audiences.forEach(function (e) { pref('audiences', '人群:' + (S.AUD_LABEL[e.value] || e.value), e.value); });
    p.defaults.duration.forEach(function (e) { pref('duration', '常办:' + (S.DUR_LABEL[e.value] || e.value), e.value); });
    p.facts.departments.forEach(function (e) { pref('departments', '部门:' + e.value, e.value, 'PREFERS', 'department'); });
    p.style.removedPhrases.forEach(function (e) { pref('removedPhrases', '避免套话:' + e.value, e.value, 'PREFERS', 'style'); });
    p.hotspots.forEach(function (h) { pref('hotspots', '热区:' + h.value + '(重写 ' + (h.regen + h.undo) + ' 次)', h.value, 'RELATES_TO'); });
    /* 品味偏好(docs/14):✓ 前缀 = 已确认(严格遵守级),其余为导入/归纳的参考级 */
    p.facts.preferences.forEach(function (e) {
      pref('preferences', (e.source === 'confirmed' ? '✓ ' : '') + String(e.value).slice(0, 24), e.value,
        e.source === 'confirmed' ? 'RELATES_TO' : 'PREFERS', e.cat);
    });
    return { nodes: nodes, edges: edges };
  }

  function graphOf(storeId, opts) {
    const m = load();
    const g = m.graphs[storeId] || { nodes: {}, edges: [] };
    const nodes = Object.assign({}, g.nodes);
    let edges = g.edges || [];
    if (opts && opts.withProfile) {
      /* V1.1(docs/16):已编译记忆页面优先呈现(EP.wiki 为事实源);
         未编译/无页面时维持 V1.0 行为 —— 档案实时活视图 */
      const pg = (EP.wiki && EP.wiki.hasPages()) ? EP.wiki.wikiGraph() : profileGraph();
      Object.assign(nodes, pg.nodes);
      edges = edges.concat(pg.edges);
    }
    return { nodes: nodes, edges: edges };
  }

  /* ── 适配层:图数据 → Cytoscape elements JSON ── */
  function toCytoscape(graph) {
    return {
      elements: {
        nodes: Object.keys(graph.nodes).map(function (k) {
          const n = graph.nodes[k];
          return { data: { id: n.id, label: n.label, type: n.type, path: n.path || '', props: JSON.stringify(n.props || {}) } };
        }),
        edges: (graph.edges || []).map(function (e) {
          return { data: { id: 'e' + e.id, source: e.source, target: e.target, label: e.type } };
        })
      }
    };
  }

  function exportJSON(storeId) {                            // 本地优先承诺:记忆数据可带走
    const m = load();
    const payload = { store: m.stores.find(function (s) { return s.id === storeId; }), graph: m.graphs[storeId], files: m.files[storeId], exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ((payload.store ? payload.store.name : 'memory') + '-记忆库').replace(/[\\/:*?"<>|]/g, '_') + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 15000);   /* 6.1:大文件下载未完成即 revoke 会偶发取消,延长到 15s */
  }

  return {
    createStore: createStore, deleteStore: deleteStore, renameStore: renameStore,
    importFiles: importFiles, removeNode: removeNode,
    graphOf: graphOf, toCytoscape: toCytoscape, parseMd: parseMd, exportJSON: exportJSON
  };
})();
