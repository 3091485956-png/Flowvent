/* wiki.js — 记忆库 Wiki 化(docs/16,V1.1)
   范式来源:nashsu/LLM-Wiki(对 Karpathy LLM-wiki 模式的实现)——「知识一次编译、持续维护,
   而非每次查询重新推导」。借鉴其设计思想,零代码复制(该库 GPL-3.0,本项目不引入其代码)。
   三层映射:
     Raw Sources → EP.profile.rawLog(带 payload 的原始事件,profile.record 单一入口)
     Wiki        → ep_wiki.pages(实体页/偏好页,body 为观察句,links 互链,sources 溯源到 seq)
     Schema      → 本文件常量(页面类型/cat 契约)+ ai.js 编译 prompt 契约
   三操作:
     compile —— 增量编译水位线之后的事件:AI 两步 CoT(分析矛盾→产出页面补丁);
                无 AI / AI 失败时确定性编译(档案统计 → 页面,行为等价 V1.0 注入)
     assemble —— 注入组装(Query):confirmed 严格遵守 / inductive 仅供参考两级,
                ≤280 字「;」边界截断;wiki 无页面时回退 profile.summarize(零回归)
     lint    —— 确定性健康检查(过时/孤页/重复)+ AI 编译产出的矛盾 Review 卡
   防漂移铁律沿用:页面只陈述观察;venue/budget/department 只收集不注入(P1-1 / I-5);
   注入永不改变「未给信息写待定、不编造」契约。tombstone 保证用户删除的页面不被编译复活。 */
window.EP = window.EP || {};
EP.wiki = (function () {
  const K = 'ep_wiki';
  const MAX_PAGES = 80;            // 页面上限:超限逐出非 confirmed 低置信旧页(confirmed 永不自动逐出)
  const MAX_LOG = 20;              // 编译日志上限
  const MAX_BATCH = 40;            // 单次编译事件批量上限
  const STALE_DAYS = 180;          // lint:超过仍未更新视为过时(与档案半衰期一致)
  const TITLE_MAX = 40, BODY_MAX = 240;
  const CATS = ['company', 'department', 'style', 'misc'];
  const SUBS = ['company', 'venue', 'budget', 'audience', 'duration', 'department', 'hotspot'];
  /* 可注入的实体细分及措辞(与 profile.summarize 口径一致);venue/budget/department 只收集不注入 */
  const INJ_LABEL = { company: '常用组织', audience: '面向人群', duration: '常办' };

  function hash(s) {               // FNV-1a 32bit → base36(与 memory.js 同风格)
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
    return h.toString(36);
  }
  function pageKey(kind, title) { return kind + ':' + hash(String(title)); }

  function empty() {
    return { ver: 1, watermark: 0, pages: {}, compileLog: [], tombstones: [], reviews: [] };
  }
  function norm(w) {
    const e = empty();
    if (!w || typeof w !== 'object') return e;
    e.watermark = w.watermark || 0;
    e.pages = (w.pages && typeof w.pages === 'object') ? w.pages : {};
    Object.keys(e.pages).forEach(function (k) {
      const p = e.pages[k];
      if (!p || !p.title) { delete e.pages[k]; return; }
      p.links = Array.isArray(p.links) ? p.links.filter(Boolean) : [];
      p.sources = Array.isArray(p.sources) ? p.sources : [];
      p.level = p.level === 'confirmed' ? 'confirmed' : 'inductive';
      p.kind = p.kind === 'entity' ? 'entity' : 'preference';
      if (CATS.indexOf(p.cat) < 0) p.cat = p.kind === 'entity' ? 'company' : 'misc';
    });
    e.compileLog = Array.isArray(w.compileLog) ? w.compileLog.slice(-MAX_LOG) : [];
    e.noteHashes = (w.noteHashes && typeof w.noteHashes === 'object') ? w.noteHashes : {};   /* F11:笔记增量登记 */
    e.tombstones = Array.isArray(w.tombstones) ? w.tombstones : [];
    e.reviews = Array.isArray(w.reviews) ? w.reviews.filter(function (r) { return r && r.id; }) : [];
    return e;
  }
  function load() {
    try { const v = localStorage.getItem(K); return norm(v ? JSON.parse(v) : null); }
    catch (e) { return empty(); }
  }
  function save(w) { try { localStorage.setItem(K, JSON.stringify(w)); return true; } catch (e) { return false; } }
  function clear() { try { localStorage.removeItem(K); } catch (e) { /* 静默 */ } }
  function hasPages() { return Object.keys(load().pages).length > 0; }

  /* ── 确定性编译:当前档案统计 → 页面集(llm_wiki 的 local 兜底 / 旧数据迁移种子)。
        det:true 标记确定性页面,重编时整体重建;AI 页面(det 无)保留合入 ── */
  function detPage(title, kind, cat, sub, body, hits, extra) {
    const pg = {
      key: pageKey(kind, title), title: String(title).slice(0, TITLE_MAX), kind: kind, cat: cat, sub: sub || '',
      body: String(body).slice(0, BODY_MAX), links: [], sources: [], level: 'inductive',
      confidence: 0.5, hits: hits || 1, det: true, createdAt: 0, updatedAt: 0
    };
    return Object.assign(pg, extra || {});
  }
  function buildDeterministic(p) {
    const S = EP.struct, out = [], now = Date.now();
    const F = p.facts || {}, st = p.style || {};
    (F.companies || []).forEach(function (e) {
      out.push(detPage(e.value, 'entity', 'company', 'company', '在 ' + e.count + ' 次活动中担任组织方', e.count, { desc: '常用组织方,出现 ' + e.count + ' 次', updatedAt: e.lastSeen }));
    });
    (F.venues || []).forEach(function (e) {
      out.push(detPage(e.value, 'entity', 'company', 'venue', '作为活动场地出现 ' + e.count + ' 次(仅收集,不注入生成)', e.count, { desc: '常用场地,出现 ' + e.count + ' 次', updatedAt: e.lastSeen }));
    });
    (F.budgetTier || []).forEach(function (e) {
      out.push(detPage(e.value + ' 档', 'entity', 'company', 'budget', '预算档位出现 ' + e.count + ' 次(仅收集,不注入生成)', e.count, { updatedAt: e.lastSeen }));
    });
    (F.audiences || []).forEach(function (e) {
      out.push(detPage(S.AUD_LABEL[e.value] || e.value, 'entity', 'company', 'audience', '面向该人群 ' + e.count + ' 次', e.count, { desc: '常面向人群:' + (S.AUD_LABEL[e.value] || e.value), updatedAt: e.lastSeen }));
    });
    (((p.defaults || {}).duration) || []).forEach(function (e) {
      out.push(detPage(S.DUR_LABEL[e.value] || e.value, 'entity', 'company', 'duration', '常办时长 ' + e.count + ' 次', e.count, { updatedAt: e.lastSeen }));
    });
    (F.departments || []).forEach(function (e) {
      out.push(detPage(String(e.value).slice(0, TITLE_MAX), 'entity', 'department', 'department',
        '部门相关信息出现 ' + e.count + ' 次(仅收集,不注入生成)', e.count, { desc: '部门信息(仅图谱可见)', updatedAt: e.lastSeen }));
    });
    (F.preferences || []).forEach(function (e) {
      const confirmed = e.source === 'confirmed';
      const body = confirmed ? '已确认为默认偏好(' + new Date(e.confirmedAt || e.lastSeen || now).toLocaleDateString('zh-CN') + '),生成时严格遵守' +
          (e.why ? ';原因:' + String(e.why).slice(0, 100) : '')   /* V1.2 F8:知其所以然,AI 才有分寸感 */
        : e.source === 'intake' ? '从过往方案导入的观察' : e.source === 'induced' ? '从编辑行为归纳的观察' : '使用中观察到的偏好';
      out.push(detPage(e.value, 'preference', e.cat, '', body, e.count,
        { level: confirmed ? 'confirmed' : 'inductive', confidence: confirmed ? 0.95 : 0.6, desc: String(e.value).slice(0, 20), updatedAt: e.lastSeen }));
    });
    if (st.avgPara && st.avgPara.n >= 3 && st.avgPara.delta < -0.15)
      out.push(detPage('文风:倾向简洁', 'preference', 'style', '', '编辑后内容平均缩短 ' + Math.round(-st.avgPara.delta * 100) + '%(' + st.avgPara.n + ' 个样本)', st.avgPara.n, { updatedAt: now }));
    if (st.listDelta && st.listDelta.n >= 3 && st.listDelta.delta > 0.5)
      out.push(detPage('文风:列表化表达', 'preference', 'style', '', '编辑后列表行净增均 ' + st.listDelta.delta.toFixed(1) + '(' + st.listDelta.n + ' 个样本)', st.listDelta.n, { structOnly: true, updatedAt: now }));
    (st.removedPhrases || []).forEach(function (e) {
      out.push(detPage('文风:避免「' + e.value + '」', 'preference', 'style', '', '用户 ' + e.count + ' 次删除该套话', e.count, { updatedAt: e.lastSeen }));
    });
    if ((st.selSimplify || 0) >= 2)
      out.push(detPage('文风:常用本地精简', 'preference', 'style', '', '对选中文字使用本地精简 ' + st.selSimplify + ' 次', st.selSimplify, { updatedAt: now }));
    (p.hotspots || []).forEach(function (h) {
      const n = (h.regen || 0) + (h.undo || 0);
      if (n >= 3) out.push(detPage('热区:' + h.value, 'preference', 'misc', 'hotspot',
        '该类章节被重写/撤销 ' + n + ' 次,撰写时需格外贴近给定信息', n, { updatedAt: h.lastSeen || now }));
    });
    out.forEach(function (pg) { if (!pg.createdAt) pg.createdAt = pg.updatedAt || now; });
    return out;
  }
  function localCompile(w, p, batch) {
    const nw = norm(w);
    const pages = {};
    Object.keys(nw.pages).forEach(function (k) {          // AI 编译的页面保留(det 页重建)
      if (!nw.pages[k].det && nw.tombstones.indexOf(k) < 0) pages[k] = nw.pages[k];
    });
    let changed = 0;
    buildDeterministic(p).forEach(function (pg) {
      if (nw.tombstones.indexOf(pg.key) >= 0) return;     // 用户已删:确定性编译不得复活
      const old = nw.pages[pg.key];                        // 与编译前状态对比(det 页已被滤出 pages,不能作为基准)
      if (!old || old.body !== pg.body || old.level !== pg.level) changed++;
      pages[pg.key] = pg;
    });
    nw.pages = pages;
    if (batch && batch.length) nw.watermark = Math.max(nw.watermark, batch[batch.length - 1].seq);
    nw.compileLog.push({ at: Date.now(), mode: 'local', eventsIn: batch ? batch.length : 0, pagesChanged: changed });
    if (nw.compileLog.length > MAX_LOG) nw.compileLog.splice(0, nw.compileLog.length - MAX_LOG);
    return { wiki: nw, changed: changed };
  }

  /* ── AI 编译补丁校验与应用(原子:全部通过校验后一次落库) ── */
  function countSupport(batch, pg) {
    let n = 0;
    batch.forEach(function (ev) {
      const d = ev.d || {};
      if (pg.kind !== 'entity') {
        if (ev.t === 'preference_confirmed' && (String(d.value || '').indexOf(pg.title) >= 0 || pg.title.indexOf(String(d.value || '')) >= 0)) n++;
        return;
      }
      if (ev.t !== 'plan_generated') return;
      const f = d.form || {};
      if (pg.sub === 'company' && f.company && pg.title.indexOf(f.company) >= 0) n++;
      if (pg.sub === 'audience' && f.audience && pg.title === (EP.struct.AUD_LABEL[f.audience] || f.audience)) n++;
      if (pg.sub === 'duration' && f.duration && pg.title === (EP.struct.DUR_LABEL[f.duration] || f.duration)) n++;
    });
    return n;
  }
  function applyPatch(w, patch, batch) {
    const nw = norm(w);
    const now = Date.now();
    const titles = {};                                     // 标题 → key(链接解析,含本批新增)
    Object.keys(nw.pages).forEach(function (k) { titles[nw.pages[k].title] = k; });
    const pending = [];
    let changed = 0;
    (patch && patch.pages || []).slice(0, 12).forEach(function (raw) {
      if (!raw || !raw.title) return;
      const title = String(raw.title).trim().slice(0, TITLE_MAX);
      const kind = raw.kind === 'entity' ? 'entity' : 'preference';
      const key = pageKey(kind, title);
      if (nw.tombstones.indexOf(key) >= 0) return;         // 已删页面不复活
      if (raw.action === 'delete') {
        if (nw.pages[key]) { delete nw.pages[key]; delete titles[title]; changed++; }
        return;
      }
      let cat = CATS.indexOf(raw.cat) >= 0 ? raw.cat : (kind === 'entity' ? 'company' : 'misc');
      let sub = SUBS.indexOf(raw.sub) >= 0 ? raw.sub : '';
      /* F3 规则粗滤:活动本身的信息(日期/人数/金额特征)不建页——那是单次方案而非用户习惯 */
      if (kind === 'entity' && !sub && /\d{2,4}[-/年]|\d+\s*(人|元|万)/.test(title)) return;
      /* confirmed 只能由 preference_confirmed 类事件支撑(AI 不得自行升级严格级) */
      const support = countSupport(batch, { kind: kind, sub: sub, title: title });
      let level = raw.level === 'confirmed' && kind === 'preference' && support > 0 ? 'confirmed' : 'inductive';
      const old = nw.pages[key];
      const pg = {
        key: key, title: title, kind: kind, cat: cat, sub: sub,
        desc: String(raw.desc || '').trim().slice(0, 40),
        body: String(raw.body || '').trim().slice(0, BODY_MAX),
        links: [], sources: [], level: level,
        confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0.6)),
        hits: Math.max(old ? (old.hits || 0) : 0, support),
        createdAt: old ? old.createdAt : now, updatedAt: now
      };
      if (!pg.body) pg.body = title;
      titles[title] = key;
      pending.push({ pg: pg, links: (raw.links || []).slice(0, 6) });
      if (!old || old.body !== pg.body || old.level !== pg.level) changed++;
      nw.pages[key] = pg;
    });
    pending.forEach(function (item) {                      // 二段解析:链接只指向已存在/本批新增页面,悬空丢弃
      item.pg.links = item.links.map(function (t) { return titles[String(t).trim()]; })
        .filter(function (k) { return k && k !== item.pg.key; });
    });
    /* 上限逐出:非 confirmed 优先,低置信旧页让位 */
    const keys = Object.keys(nw.pages);
    if (keys.length > MAX_PAGES) {
      keys.sort(function (a, b) {
        const pa = nw.pages[a], pb = nw.pages[b];
        return (pa.level === 'confirmed') - (pb.level === 'confirmed') ||
               (pa.confidence || 0) - (pb.confidence || 0) || (pa.updatedAt || 0) - (pb.updatedAt || 0);
      });
      keys.slice(0, keys.length - MAX_PAGES).forEach(function (k) { delete nw.pages[k]; });
    }
    let reviewsAdded = 0;
    (patch && patch.reviews || []).slice(0, 3).forEach(function (rv) {
      if (!rv || !(rv.issue || rv.title)) return;
      const title = String(rv.title || '').slice(0, TITLE_MAX);
      const key = rv.pageKey && nw.pages[rv.pageKey] ? rv.pageKey : pageKey('preference', title);
      if (nw.reviews.some(function (r) { return r.status === 'open' && r.pageKey === key && r.issue === String(rv.issue).slice(0, 200); })) return;
      nw.reviews.push({ id: 'r' + now.toString(36) + Math.random().toString(36).slice(2, 6), pageKey: key, title: title,
        issue: String(rv.issue || '').slice(0, 200), suggestion: String(rv.suggestion || '').slice(0, 200),
        status: 'open', at: now });
      reviewsAdded++;
    });
    if (batch && batch.length) nw.watermark = Math.max(nw.watermark, batch[batch.length - 1].seq);
    nw.compileLog.push({ at: now, mode: 'ai', eventsIn: batch ? batch.length : 0, pagesChanged: changed });
    if (nw.compileLog.length > MAX_LOG) nw.compileLog.splice(0, nw.compileLog.length - MAX_LOG);
    return { wiki: nw, changed: changed, reviewsAdded: reviewsAdded };
  }

  /* ── compile:入口(AI 优先,失败回落确定性;force 时失败上抛) ── */
  function pendingEvents(w) {
    const wm = (w || load()).watermark;
    return ((EP.profile.load().rawLog) || []).filter(function (e) { return e.seq > wm; });
  }
  function contextPages(w, batch) {                        // prompt 上下文:confirmed 全量 + 最近更新,截 20 页
    const pages = Object.keys(w.pages).map(function (k) { return w.pages[k]; });
    pages.sort(function (a, b) {
      return (b.level === 'confirmed') - (a.level === 'confirmed') || (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return pages.slice(0, 20).map(function (p) {
      return { title: p.title, kind: p.kind, cat: p.cat, level: p.level, body: String(p.body).slice(0, 200) };
    });
  }
  async function compile(opts) {
    const o = opts || {};
    const w = load();
    const batch = pendingEvents(w).slice(-MAX_BATCH);
    if (!batch.length) return { mode: 'none', eventsIn: 0, pagesChanged: 0, reviewsAdded: 0 };
    if (EP.ai && EP.ai.ready() && !o.local) {
      try {
        const extras = noteEvents(w);                      /* F11:笔记库变更文件并入编译视野 */
        const r = await EP.ai.compileWiki(batch.concat(extras), contextPages(w, batch), w.tombstones);
        const applied = applyPatch(w, r.patch, batch);
        applied.wiki.noteHashes = w.noteHashes;            /* hash 登记随成功编译落库(失败下次重发) */
        save(applied.wiki);
        return { mode: 'ai', eventsIn: batch.length + extras.length, pagesChanged: applied.changed, reviewsAdded: applied.reviewsAdded };
      } catch (e) {
        if (o.force) throw e;                              // 手动编译:如实报错,不静默降级
      }
    }
    const local = localCompile(w, EP.profile.load(), batch);
    save(local.wiki);
    return { mode: 'local', eventsIn: batch.length, pagesChanged: local.changed, reviewsAdded: 0 };
  }

  /* ── init:幂等迁移(无 ep_wiki 且档案非空 → 确定性种子页面,水位线对齐当前 seq) ── */
  function init() {
    try {
      if (localStorage.getItem(K) !== null) return;
      const p = EP.profile.load();
      const raw = p.rawLog || [];
      if (!raw.length && !Object.keys(p.facts || {}).some(function (k) { return (p.facts[k] || []).length; })) return;
      const r = localCompile(empty(), p, []);
      r.wiki.watermark = p.seq || 0;
      save(r.wiki);
    } catch (e) { /* 迁移失败不阻塞主流程,下次 init 重试 */ }
  }

  /* ── assemble(Query):页面 → 注入摘要;无页面回退 profile.summarize(零回归)。
        V1.1.1:ctx.form 供相关性排序(llm_wiki 4-Signal 检索的简化:标题/正文与活动信息的
        关键词重合度优先,重合为零时退回 新近→频次 序,与确定性口径兼容)。
        V1.2 F2(Claude B1):归纳级页面带观察时间标注——记忆是过时的观察而非实时事实,
        具体表述越权威,过时越危险;confirmed 不加(避免稀释「严格遵守」语气) ── */
  function ageTag(p) {
    if (!p || p.level === 'confirmed') return '';
    const d = Math.floor((Date.now() - (p.updatedAt || 0)) / 86400000);
    if (d <= 1) return '';
    return d > 180 ? '(' + d + ' 天前观察,可能过时)' : '(' + d + ' 天前观察)';
  }
  /* ── F6 接受信号(Claude「从成功中学习」):assemble 记录注入 → 方案导出时回流 verified ── */
  let lastInjectedKeys = [];        /* 最近一次 assemble 选中的页面 key(非 confirmed 一并记录,供核对) */
  function markInjected(pages) {
    lastInjectedKeys = pages.map(function (p) { return p.key; });
    const w = load();
    let dirty = false;
    pages.forEach(function (p) {
      const pg = w.pages[p.key];
      if (pg) { pg.injectedCount = (pg.injectedCount || 0) + 1; pg.lastInjectedAt = Date.now(); dirty = true; }
    });
    if (dirty) save(w);
  }
  function consumedKeys() { return lastInjectedKeys.slice(); }
  /* 导出 = 认可票:本次方案生成时注入过的 confirmed 页 verified+1、confidence 微升(0.98 封顶,只加不减) */
  function verifyExport(keys) {
    const w = load();
    let n = 0;
    (keys || []).forEach(function (k) {
      const pg = w.pages[k];
      if (pg && pg.level === 'confirmed') {
        pg.verified = (pg.verified || 0) + 1;
        pg.confidence = Math.min(0.98, (pg.confidence || 0.6) + 0.02);
        n++;
      }
    });
    if (n) save(w);
    return n;
  }

  function relevance(pg, form) {
    if (!form) return 0;
    const hay = pg.title + ' ' + (pg.desc || '');
    const toks = [];
    [form.company, form.venue, form.name, form.notes,
     (EP.struct && EP.struct.typeLabel(form.type)) || form.type,
     (EP.struct && EP.struct.AUD_LABEL[form.audience]) || form.audience].forEach(function (t) {
      t = String(t || '').trim();
      if (t.length >= 2) toks.push(t.slice(0, 24));
    });
    let n = 0;
    toks.forEach(function (t) { if (hay.indexOf(t) >= 0) n++; });
    return n;
  }
  function cut280(s) {
    if (s.length <= 280) return s;
    const cut = s.slice(0, 280);
    return cut.slice(0, Math.max(cut.lastIndexOf(';'), 0));
  }
  function assemble(kind, ctx) {
    const w = load();
    const pages = Object.keys(w.pages).map(function (k) { return w.pages[k]; });
    if (!pages.length) return EP.profile.summarize(EP.profile.load(), kind);
    const form = ctx && ctx.form;
    const byNew = function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0) || (b.hits || 0) - (a.hits || 0); };
    const byRel = function (a, b) { return relevance(b, form) - relevance(a, form) || byNew(a, b); };
    const out = [];
    if (kind === 'plan') {
      const conf = pages.filter(function (p) { return p.kind === 'preference' && p.level === 'confirmed'; }).sort(byRel).slice(0, 3);
      if (conf.length) {
        out.push('已确认偏好(严格遵守,与上述活动信息冲突时一律以活动信息为准):' + conf.map(function (p) { return p.title; }).join(';'));
        markInjected(conf);                                  /* F6:注入即标记,导出时回流认可 */
      }
      const hot = pages.filter(function (p) { return p.sub === 'hotspot'; }).sort(function (a, b) { return (b.hits || 0) - (a.hits || 0); })[0];
      if (hot) out.push('注意:「' + hot.title.replace(/^热区:/, '') + '」类章节历史上常被重写,撰写时请格外贴近给定信息、不夸大');
      ['company', 'audience', 'duration'].forEach(function (sub) {
        const e = pages.filter(function (p) { return p.kind === 'entity' && p.sub === sub && (p.hits || 0) >= 2; }).sort(byRel)[0];
        if (e) out.push(INJ_LABEL[sub] + ':' + e.title + ageTag(e));
      });
      const ref = pages.filter(function (p) { return p.kind === 'preference' && p.level !== 'confirmed' && p.cat !== 'style' && !p.structOnly; })
        .sort(byRel).slice(0, 3);
      if (ref.length) out.push('过往记忆(参考):' + ref.map(function (p) { return p.title + ageTag(p); }).join(';'));
    } else {
      /* section / polish:style 页 + confirmed;polish 跳过结构向页面(P2-1 口径) */
      const st = pages.filter(function (p) { return p.cat === 'style' && !(kind === 'polish' && p.structOnly); }).sort(byNew);
      if (st.length) out.push('文风观察:' + st.slice(0, 3).map(function (p) { return p.body + ageTag(p); }).join(';'));
      const conf = pages.filter(function (p) { return p.kind === 'preference' && p.level === 'confirmed'; }).sort(byRel).slice(0, 3);
      if (conf.length) out.push('已确认偏好(严格遵守):' + conf.map(function (p) { return p.title; }).join(';'));
    }
    return cut280(out.join(';'));
  }

  /* ── 图谱洞察(llm_wiki Graph Insights 适配):枢纽页 / 跨模块桥接页 / 模块缺口 ── */
  function insights() {
    const w = load();
    const pages = Object.keys(w.pages).map(function (k) { return w.pages[k]; });
    const inDeg = {};
    pages.forEach(function (p) { (p.links || []).forEach(function (l) { inDeg[l] = (inDeg[l] || 0) + 1; }); });
    const CAT_NAME = { company: '公司', department: '各部门', style: '策划案风格', misc: '其他偏好' };
    const hubs = pages.filter(function (p) { return (inDeg[p.key] || 0) >= 2; })
      .sort(function (a, b) { return inDeg[b.key] - inDeg[a.key]; })
      .map(function (p) { return { title: p.title, cat: CAT_NAME[p.cat] || p.cat, deg: inDeg[p.key] }; });
    const bridges = pages.filter(function (p) {
      const cats = {};
      cats[p.cat] = 1;
      (p.links || []).forEach(function (l) { const t = w.pages[l]; if (t) cats[t.cat] = 1; });
      return Object.keys(cats).length >= 2;
    }).map(function (p) { return { title: p.title, cat: CAT_NAME[p.cat] || p.cat }; });
    const gaps = [];
    Object.keys(CAT_NAME).forEach(function (cat) {
      const cp = pages.filter(function (p) { return p.cat === cat; });
      if (!cp.length) { if (pages.length) gaps.push({ cat: CAT_NAME[cat], issue: '暂无该模块的记忆页面' }); return; }
      const linked = cp.some(function (p) { return (p.links || []).length || inDeg[p.key]; });
      if (!linked && pages.length > 3) gaps.push({ cat: CAT_NAME[cat], issue: '该模块 ' + cp.length + ' 页均无关联,可再次编译让 AI 建立互链' });
    });
    return { hubs: hubs, bridges: bridges, gaps: gaps };
  }

  /* ── 导出 Markdown(Obsidian 兼容,llm_wiki「wiki 目录即 vault」思想):
        索引 + 每页一节,frontmatter 式元信息 + [[wikilink]] 互链 ── */
  function toMarkdown() {
    const w = load();
    const CAT_NAME = { company: '公司', department: '各部门', style: '策划案风格', misc: '其他偏好' };
    const pages = Object.keys(w.pages).map(function (k) { return w.pages[k]; })
      .sort(function (a, b) { return a.cat.localeCompare(b.cat) || a.title.localeCompare(b.title, 'zh-CN'); });
    const esc = function (s) { return String(s || '').replace(/([\[\]])/g, '\\$1'); };   // 防御:正文方括号转义,标题不转(wikilink 需要精确匹配)
    const titleOf = {};
    pages.forEach(function (p) { titleOf[p.key] = p.title; });
    const last = w.compileLog.length ? w.compileLog[w.compileLog.length - 1] : null;
    let md = '# 秒策记忆库\n\n> 导出时间:' + new Date().toLocaleString('zh-CN', { hour12: false }) +
      ' · 共 ' + pages.length + ' 页' +
      (last ? ' · 上次编译:' + new Date(last.at).toLocaleString('zh-CN', { hour12: false }) + '(' + (last.mode === 'ai' ? 'AI' : '本地') + ')' : '') + '\n\n';
    md += '## 索引\n\n' + (pages.map(function (p) {
      return '- [[' + p.title + ']](' + (CAT_NAME[p.cat] || p.cat) + ' · ' + (p.kind === 'entity' ? '实体' : '偏好') + (p.level === 'confirmed' ? ' · 已确认' : '') + ')' + (p.desc ? ':' + p.desc : '');
    }).join('\n') || '(空)') + '\n';
    pages.forEach(function (p) {
      md += '\n## ' + p.title + '\n\n' +
        '类别:' + (CAT_NAME[p.cat] || p.cat) + ' · ' + (p.kind === 'entity' ? '实体' : '偏好') +
        ' · ' + (p.level === 'confirmed' ? '确认级(生成时严格遵守)' : '归纳级(仅供参考)') +
        ' · 更新于 ' + new Date(p.updatedAt || Date.now()).toLocaleDateString('zh-CN') + '\n\n' +
        esc(p.body) + '\n' +
        ((p.links || []).length ? '\n相关:' + p.links.map(function (l) { return titleOf[l] ? '[[' + titleOf[l] + ']]' : ''; }).filter(Boolean).join(' · ') + '\n' : '');
    });
    return md;
  }

  /* ── lint:确定性健康检查(矛盾类由 AI 编译产出 reviews 承担) ── */
  function lint() {
    const w = load();
    const now = Date.now();
    const out = [];
    const inDeg = {};
    Object.keys(w.pages).forEach(function (k) {
      (w.pages[k].links || []).forEach(function (l) { inDeg[l] = (inDeg[l] || 0) + 1; });
    });
    const byTitle = {};
    Object.keys(w.pages).forEach(function (k) {
      const pg = w.pages[k];
      if (now - (pg.updatedAt || 0) > STALE_DAYS * 86400000 && pg.level !== 'confirmed')
        out.push({ type: 'stale', key: k, title: pg.title, issue: '超过 ' + STALE_DAYS + ' 天未更新,可能已过时' });
      /* 孤页只检查 AI 编译页面:确定性种子页是统计事实,天然无互链,不算孤岛 */
      if (!pg.det && !(pg.links || []).length && !inDeg[k] && pg.level !== 'confirmed')
        out.push({ type: 'orphan', key: k, title: pg.title, issue: '孤页:与任何记忆页面无关联' });
      (byTitle[pg.title] = byTitle[pg.title] || []).push(k);
    });
    Object.keys(byTitle).forEach(function (t) {
      if (byTitle[t].length > 1)
        out.push({ type: 'dup', key: byTitle[t][0], title: t, issue: '存在 ' + byTitle[t].length + ' 个同名页面,建议保留一个' });
    });
    return out;
  }

  /* ── 页面删除(tombstone:确定性/AI 编译均不得复活)+ Review 裁决 ── */
  function remove(key) {
    const w = load();
    if (!w.pages[key]) return false;
    delete w.pages[key];
    if (w.tombstones.indexOf(key) < 0) w.tombstones.push(key);
    if (w.tombstones.length > 200) w.tombstones.splice(0, w.tombstones.length - 200);
    Object.keys(w.pages).forEach(function (k) {            // 级联清理指向它的链接(llm_wiki 死链清理思想)
      const pg = w.pages[k];
      const i = (pg.links || []).indexOf(key);
      if (i >= 0) pg.links.splice(i, 1);
    });
    w.reviews.forEach(function (r) { if (r.pageKey === key && r.status === 'open') r.status = 'resolved'; });
    return save(w);
  }
  function resolveReview(id, action) {
    if (action === 'delete') {                             // 删页面:remove 会一并关闭其 open review
      const rv = load().reviews.find(function (x) { return x.id === id; });
      return rv ? remove(rv.pageKey) : false;
    }
    const w = load();
    const r = w.reviews.find(function (x) { return x.id === id && x.status === 'open'; });
    if (!r) return false;
    r.status = action === 'apply' ? 'resolved' : 'ignored';
    return save(w);
  }

  /* ── F10 记忆库精灵:butler(只读编排,返回建议动作) + applyActions(校验后落库) ── */
  function butlerManifest() {
    const w = load();
    return Object.keys(w.pages).map(function (k) {
      const pg = w.pages[k];
      return { key: k, title: pg.title, desc: pg.desc || '', cat: pg.cat, level: pg.level };
    });
  }
  function butler(instruction) {
    const w = load();
    const manifest = butlerManifest();
    if (!manifest.length) return Promise.reject(new Error('记忆库还没有页面,先用一段时间或点「编译记忆」'));
    /* 相关页预选:指令与标题/描述关键词重合(中文按 2 字滑窗),≤5 页给全文 */
    const hay = String(instruction || '');
    const wins = [];
    for (let i = 0; i < hay.length - 1; i++) wins.push(hay.slice(i, i + 2));
    const scored = manifest.map(function (m) {
      let n = 0;
      const t = m.title + (m.desc || '');
      wins.forEach(function (g) { if (t.indexOf(g) >= 0) n++; });
      return { m: m, n: n };
    }).sort(function (a, b) { return b.n - a.n; });
    const fulls = scored.filter(function (x) { return x.n > 0; }).slice(0, 5).map(function (x) {
      const pg = w.pages[x.m.key];
      return { key: x.m.key, title: pg.title, body: '类别:' + pg.cat + ' · ' + (pg.level === 'confirmed' ? '确认级' : '归纳级') + '\n' + pg.body };
    });
    const reviews = w.reviews.filter(function (r) { return r.status === 'open'; })
      .map(function (r) { return { id: r.id, title: r.title, issue: r.issue }; });
    return EP.ai.butlerChat(instruction, manifest, fulls, reviews);
  }
  function applyActions(actions) {
    const w = load();
    const now = Date.now();
    let applied = 0;
    (actions || []).slice(0, 6).forEach(function (a) {
      if (!a || !a.key || !a.type) return;
      if (a.type === 'resolve') {
        const rv = w.reviews.find(function (r) { return r.id === a.key && r.status === 'open'; });
        if (rv) { rv.status = 'resolved'; applied++; EP.profile.record({ t: 'memory_butler_op', data: { action: 'resolve', key: a.key } }); }
        return;
      }
      const pg = w.pages[a.key];
      if (!pg) return;                                     /* 只能操作存在的页面 */
      if (a.type === 'delete') {
        delete w.pages[a.key];                             /* 全程只改内存 w,末尾统一保存(防中间保存被旧快照覆盖) */
        if (w.tombstones.indexOf(a.key) < 0) w.tombstones.push(a.key);
        Object.keys(w.pages).forEach(function (k) {
          const li = (w.pages[k].links || []).indexOf(a.key);
          if (li >= 0) w.pages[k].links.splice(li, 1);
        });
        w.reviews.forEach(function (r) { if (r.pageKey === a.key && r.status === 'open') r.status = 'resolved'; });
        applied++;
        EP.profile.record({ t: 'memory_butler_op', data: { action: 'delete', key: a.key } });
        return;
      }
      if (a.type === 'merge') {
        const other = w.pages[a.key2];
        if (!other || a.key2 === a.key) return;
        const links = {};
        (pg.links || []).concat(other.links || []).forEach(function (l) { if (l !== pg.key && l !== other.key) links[l] = 1; });
        pg.links = Object.keys(links);
        pg.updatedAt = now;
        delete w.pages[a.key2];
        if (w.tombstones.indexOf(a.key2) < 0) w.tombstones.push(a.key2);
        w.reviews.forEach(function (r) { if (r.pageKey === a.key2 && r.status === 'open') r.status = 'resolved'; });
        applied++;
        EP.profile.record({ t: 'memory_butler_op', data: { action: 'merge', key: a.key, key2: a.key2 } });
        return;
      }
      if (a.type === 'update') {
        const body = String(a.body || '').trim().slice(0, BODY_MAX);
        if (!body) return;                                 /* update 必须给全文 */
        if (a.title && a.title !== pg.title) {             /* 改名:新 key 承接,tombstone 防 resurrection */
          const nk = pageKey(pg.kind, a.title);
          if (w.pages[nk] || w.tombstones.indexOf(nk) >= 0) return;
          const np = Object.assign({}, pg, { key: nk, title: a.title.slice(0, TITLE_MAX), body: body, updatedAt: now });
          delete w.pages[a.key];
          if (w.tombstones.indexOf(a.key) < 0) w.tombstones.push(a.key);
          w.pages[nk] = np;
          Object.keys(w.pages).forEach(function (k) {      /* 互链重定向到新 key */
            w.pages[k].links = (w.pages[k].links || []).map(function (l) { return l === a.key ? nk : l; });
          });
        } else {
          pg.body = body;
          pg.updatedAt = now;
        }
        applied++;
        EP.profile.record({ t: 'memory_butler_op', data: { action: 'update', key: a.key } });
        return;
      }
    });
    save(w);                                               /* resolve/delete 内部已各自保存,这里兜底合并 */
    return { applied: applied };
  }

  /* ── F11 笔记库并入编译源:ep_memory 变更文件 → note_file_seen 合成事件(hash 去重) ── */
  function noteEvents(w) {
    let m = null;
    try { m = JSON.parse(localStorage.getItem('ep_memory') || '{}'); } catch (e) { return []; }
    const out = [];
    const seen = w.noteHashes = w.noteHashes || {};
    Object.keys(m.graphs || {}).forEach(function (storeId) {
      const g = m.graphs[storeId] || {};
      const notes = Object.keys(g.nodes || {}).map(function (k) { return g.nodes[k]; }).filter(function (n) { return n.type === 'Note'; });
      notes.forEach(function (n) {
        const heads = Object.keys(g.nodes).map(function (k) { return g.nodes[k]; })
          .filter(function (h) { return h.type === 'Heading' && h.path === n.path }).map(function (h) { return h.label; });
        const digest = (n.label + (heads.length ? ':' + heads.slice(0, 6).join('/') : '')).slice(0, 200);
        const h = hash(digest + '|' + (n.path || ''));
        const reg = (storeId + '/' + (n.path || n.label));
        if (seen[reg] === h) return;                       /* 未变更跳过(增量) */
        seen[reg] = h;
        out.push({ t: 'note_file_seen', seq: 'note', d: { title: n.label, path: n.path || '', digest: digest } });
      });
    });
    return out;
  }

  /* ── 图谱视图:页面 → memory.js 同构 nodes/edges(供 memoryview 渲染) ── */
  function wikiGraph() {
    const w = load();
    const now = Date.now();
    const nodes = {}, edges = [];
    /* V1.2:不造「记忆库」中心节点(用户裁定:无用)——图即页面网络,边只有页面互链 */
    Object.keys(w.pages).forEach(function (k) {
      const pg = w.pages[k];
      const id = 'Wiki:' + k;
      nodes[id] = {
        id: id, label: (pg.level === 'confirmed' ? '✓ ' : '') + String(pg.title).slice(0, 24),
        type: 'Wiki', createdAt: pg.createdAt, updatedAt: pg.updatedAt,
        props: { key: k, cat: pg.cat, kind: pg.kind, sub: pg.sub || '', level: pg.level, desc: pg.desc || '', body: pg.body, sources: pg.sources }
      };
      (pg.links || []).forEach(function (lk) {
        if (w.pages[lk]) edges.push({ id: 'wl' + hash(k + '>' + lk), source: id, target: 'Wiki:' + lk, type: 'LINKS_TO', fact: '', validAt: now });
      });
    });
    return { nodes: nodes, edges: edges };
  }
  function openReviews() { return load().reviews.filter(function (r) { return r.status === 'open'; }); }

  /* ── F5 抽屉小红点:矛盾优先,其次积压事件(≥6 才值得提醒);null = 不显示 ── */
  function badgeCount() {
    const w = load();
    const rv = w.reviews.filter(function (r) { return r.status === 'open'; }).length;
    if (rv) return { n: rv, kind: 'review' };
    const pe = pendingEvents(w).length;
    return pe >= 6 ? { n: pe, kind: 'pending' } : null;
  }

  return {
    load: load, save: save, clear: clear, init: init,
    hasPages: hasPages, pendingEvents: pendingEvents, compile: compile,
    assemble: assemble, lint: lint, remove: remove,
    insights: insights, toMarkdown: toMarkdown,
    resolveReview: resolveReview, openReviews: openReviews, wikiGraph: wikiGraph,
    badgeCount: badgeCount, consumedKeys: consumedKeys, verifyExport: verifyExport,
    butler: butler, applyActions: applyActions, butlerManifest: butlerManifest,
    _internals: { pageKey: pageKey, applyPatch: applyPatch, localCompile: localCompile, buildDeterministic: buildDeterministic, cut280: cut280, relevance: relevance, ageTag: ageTag }
  };
})();
