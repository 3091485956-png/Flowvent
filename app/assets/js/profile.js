/* profile.js — 企业/用户档案(「越用越懂用户」)
   全被动捕获、只存本机、可审计可清除。三层纯函数:
     record(event) → update(profile, event) → summarize(profile, kind)
   设计依据 docs/12:确定性规则不用 LLM 提取(事件源已半结构化);
   ≥2 次才进摘要(NOOP 默认,防偶发污染);条目级时间戳 + 0.5^(天/180) 衰减;
   摘要限长 200 字、只陈述观察不下结论;事件环形缓冲只存统计量不存全文(全文在方案自身 prev 中)。
   防漂移铁律:档案仅作风格与背景参考注入,不改变「未给信息写待定、不编造」契约。
   V1.1(docs/16,llm_wiki 范式):record 同步追加 rawLog —— 带全量 payload(字段截断)的
   原始事件层(Raw Sources),供 EP.wiki 增量编译与 sources 溯源;seq 单调递增作编译水位线。 */
window.EP = window.EP || {};
EP.profile = (function () {
  const K = 'ep_profile';
  const MAX_EVENTS = 500;
  const MAX_ENTRY = 3;
  const MIN_COUNT = 2;
  const HALF_LIFE_DAYS = 180;
  const MAX_RAW = 200;             // rawLog 环形缓冲上限(有界增长,防 localStorage 溢出)
  const RAW_STR = 400;             // payload 字符串字段截断长度

  /* AI 输出中常见、用户删掉即为明确负信号的公文套话 */
  const PHRASES = ['综上所述', '值得一提的是', '众所周知', '不难看出', '由此可见', '不言而喻', '总而言之'];
  /* 热区话题归类:AI 自拟标题措辞多变,按关键词聚合避免信号碎片化 */
  const TOPICS = [
    ['预算', ['预算', '费用', '开销']],
    ['分工', ['分工', '人员', '职责']],
    ['时间表', ['时间表', '流程', '日程']],
    ['物料', ['物料', '物资', '采购']],
    ['安全', ['安全', '风险', '应急', '预案']],
    ['文案', ['文案', '宣传', '推广']],
    ['主持', ['主持', '串词']],
    ['环节', ['环节', '游戏', '活动设计']],
    ['复盘', ['复盘', '评估', '总结']],
    ['概述', ['概述', '背景', '目的']]
  ];

  function topicOf(title) {
    const t = String(title || '');
    for (let i = 0; i < TOPICS.length; i++) if (TOPICS[i][1].some(function (k) { return t.includes(k); })) return TOPICS[i][0];
    return '';
  }
  function budgetTier(n) {
    const v = Number(n);
    if (!v || v <= 0) return '';
    if (v < 10000) return '1万以内';
    if (v < 30000) return '1万-3万';
    if (v < 50000) return '3万-5万';
    if (v < 100000) return '5万-10万';
    return '10万以上';
  }

  /* 条目归并:命中则计数并刷新 lastSeen;未命中追加;超限时按计数优先保留(高频不被新词挤掉) */
  function bump(list, value, now, max) {
    if (!value) return list;
    const hit = list.find(function (e) { return e.value === value; });
    if (hit) { hit.count++; hit.lastSeen = now; return list; }
    list.push({ value: value, count: 1, firstSeen: now, lastSeen: now });
    const cap = max || MAX_ENTRY;
    if (list.length > cap) {
      list.sort(function (a, b) { return (b.count - a.count) || (b.lastSeen - a.lastSeen); });
      list.length = cap;
    }
    return list;
  }
  function weight(e, now) {
    const days = Math.max(0, (now - (e.lastSeen || 0)) / 86400000);
    return (e.count || 1) * Math.pow(0.5, days / HALF_LIFE_DAYS);
  }
  function flowingAvg(cur, sample) {
    const n = cur.n + 1;
    return { n: n, delta: cur.delta + (sample - cur.delta) / n };
  }

  function empty() {
    return {
      ver: 2,                                          // v2:记忆库四模块分类(docs/15 F3)
      facts: { companies: [], venues: [], budgetTier: [], audiences: [], departments: [], preferences: [] },
      style: { avgPara: { n: 0, delta: 0 }, listDelta: { n: 0, delta: 0 }, removedPhrases: [], selSimplify: 0 },
      hotspots: [],
      defaults: { duration: [], venueType: [], audience: [] },
      notesSeen: {},          // 特殊需求/对话子句计数(重复→确认建议,docs/14 T1)
      lastFormSig: '',
      events: [],
      seq: 0,                 // V1.1:rawLog 事件序号(单调递增,EP.wiki 编译水位线)
      rawLog: []              // V1.1:原始事件层(带截断 payload,环形缓冲 MAX_RAW)
    };
  }
  /* 载入即归并:兼容字段缺失的旧档案(v1→v2 迁移:补 departments 与 preferences[].cat) */
  function norm(p) {
    const e = empty();
    if (!p || typeof p !== 'object') return e;
    e.facts = Object.assign(e.facts, p.facts || {});
    e.facts.preferences = (p.facts && p.facts.preferences) || [];
    e.facts.departments = (p.facts && p.facts.departments) || [];
    e.facts.preferences.forEach(function (x) {
      if (!x.cat) x.cat = x.kind === 'style' ? 'style' : 'misc';   // v1 迁移:按 kind 推导分类
    });
    const st = p.style || {};
    e.style = Object.assign(e.style, st);
    e.style.avgPara = Object.assign({ n: 0, delta: 0 }, st.avgPara || {});
    e.style.listDelta = Object.assign({ n: 0, delta: 0 }, st.listDelta || {});
    e.style.removedPhrases = st.removedPhrases || [];
    e.style.selSimplify = st.selSimplify || 0;
    e.hotspots = p.hotspots || [];
    e.defaults = Object.assign(e.defaults, p.defaults || {});
    e.notesSeen = p.notesSeen || {};
    e.lastFormSig = p.lastFormSig || '';
    e.events = p.events || [];
    e.seq = p.seq || 0;
    e.rawLog = p.rawLog || [];
    e.ver = 2;
    return e;
  }
  /* rawLog payload 深截断:字符串 400 字、数组 12 项、对象 16 键(有界存储,溯源足够) */
  function trunc(v) {
    if (typeof v === 'string') return v.length > RAW_STR ? v.slice(0, RAW_STR) + '…' : v;
    if (Array.isArray(v)) return v.slice(0, 12).map(trunc);
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).slice(0, 16).forEach(function (k) { o[k] = trunc(v[k]); });
      return o;
    }
    return v;
  }
  /* 特殊需求子句规范化:去空白与标点后计数,容忍微小措辞差异 */
  function normClause(s) {
    return String(s || '').replace(/[\s,。;:!.?~、()()[\]【】"'""'']+/g, '').toLowerCase();
  }
  /* 偏好条目归并:确认级可升级既有条目,其余计数 */
  function bumpPref(list, value, kind, source, now, cat) {
    const hit = list.find(function (e) { return e.value === value; });
    if (hit) {
      hit.count++;
      hit.lastSeen = now;
      if (source === 'confirmed') { hit.source = 'confirmed'; hit.confirmedAt = now; }
      if (cat) hit.cat = cat;
      return hit;
    }
    const item = { value: value, kind: kind || 'rule', cat: cat || (kind === 'style' ? 'style' : 'misc'), source: source, count: 1, firstSeen: now, lastSeen: now };
    if (source === 'confirmed') item.confirmedAt = now;
    list.push(item);
    if (list.length > 24) {                       // 偏好上限:确认级优先保留
      list.sort(function (a, b) { return (b.source === 'confirmed') - (a.source === 'confirmed') || b.count - a.count; });
      list.length = 24;
    }
    return item;
  }
  /* 特殊需求 / 对话指令的子句计数共用管道(docs/14 T1);boost 供强意图词加权 */
  function trackClauses(p, text, boost) {
    String(text || '').split(/[;;\n。]/).forEach(function (cl) {
      const raw = cl.trim();
      if (raw.length < 6 || raw.length > 40) return;
      const key = normClause(raw);
      const seen = p.notesSeen[key] = p.notesSeen[key] || { raw: raw, count: 0, state: 'pending' };
      seen.count += boost;
    });
  }

  /* ── update:纯函数,事件 → 档案(不触存储,可 node 测试) ── */
  function update(profile, event) {
    const p = norm(profile);
    const ev = event || {};
    const now = ev.at || Date.now();
    const d = ev.data || {};

    if (ev.t === 'plan_generated') {
      const f = d.form || {};
      bump(p.facts.companies, String(f.company || '').trim(), now);
      bump(p.facts.venues, String(f.venue || '').trim(), now);
      bump(p.facts.budgetTier, budgetTier(f.budgetTotal), now);
      bump(p.facts.audiences, f.audience, now);
      trackClauses(p, f.notes, 1);                 // 特殊需求子句 = 品味信号
    } else if (ev.t === 'past_plan_parsed' || ev.t === 'edit_induced') {
      /* 过往方案导入 / 编辑对归纳:AI 已结构化并分类的偏好直接入档(归纳级) */
      (d.preferences || []).forEach(function (pr) {
        if (pr && pr.value) bumpPref(p.facts.preferences, String(pr.value).trim(), pr.kind,
          ev.t === 'past_plan_parsed' ? 'intake' : 'induced', now, pr.cat);
      });
      if (ev.t === 'past_plan_parsed') {
        (d.facts || []).forEach(function (fa) {
          if (!fa || !fa.value) return;
          if (fa.kind === 'company') bump(p.facts.companies, String(fa.value).trim(), now);
          if (fa.kind === 'venue') bump(p.facts.venues, String(fa.value).trim(), now);
          if (fa.kind === 'audience' && fa.value) bump(p.facts.audiences, fa.value, now);
          if (fa.kind === 'department') bump(p.facts.departments, String(fa.value).trim(), now);   // 记忆库·各部门模块
        });
      }
    } else if (ev.t === 'chat_message') {
      /* AI 编辑对话:指令并入偏好检测;「以后/默认/记住」等强意图词立即达到确认门槛 */
      const intent = /以后|默认|记住|总是|每次都/.test(String(d.text || ''));
      trackClauses(p, d.text, intent ? 3 : 1);
    } else if (ev.t === 'preference_confirmed') {
      /* 用户显式确认:升级为最高优先级(严格遵守),该子句不再建议;why=确认时的原话/理由(V1.2 F8) */
      bumpPref(p.facts.preferences, String(d.value || '').trim(), 'rule', 'confirmed', now);
      const hit = p.facts.preferences.find(function (e) { return e.value === String(d.value || '').trim(); });
      if (hit && d.why) hit.why = String(d.why).slice(0, 120);
      const key = normClause(d.value);
      if (p.notesSeen[key]) p.notesSeen[key].state = 'confirmed';
    } else if (ev.t === 'preference_rejected') {
      /* 拒绝:冷却,不再就该子句打扰 */
      const key = normClause(d.value);
      if (p.notesSeen[key]) p.notesSeen[key].state = 'rejected';
    } else if (ev.t === 'section_edited') {
      const prev = String(d.prevMd || ''), next = String(d.newMd || '');
      if (prev && next) {                            // 清空整节不构成文风样本
        p.style.avgPara = flowingAvg(p.style.avgPara, (next.length - prev.length) / Math.max(prev.length, 1));
        const listLines = function (md) {
          return ((md.match(/^[*-] /gm) || []).length + (md.match(/^\d+[.、] /gm) || []).length);
        };
        p.style.listDelta = flowingAvg(p.style.listDelta, listLines(next) - listLines(prev));
        PHRASES.forEach(function (ph) {
          if (prev.includes(ph) && !next.includes(ph)) bump(p.style.removedPhrases, ph, now, PHRASES.length);
        });
      }
    } else if (ev.t === 'section_ai_op') {
      const topic = topicOf(d.title);
      if (topic) {
        let hot = p.hotspots.find(function (h) { return h.value === topic; });
        if (!hot) { hot = { value: topic, regen: 0, polish: 0, expand: 0, undo: 0, lastSeen: 0 }; p.hotspots.push(hot); }
        if (d.op === 'undoai') hot.undo++; else if (hot[d.op] !== undefined) hot[d.op]++;
        hot.lastSeen = now;
      }
    } else if (ev.t === 'selection_op') {
      if (d.op === 'simplify') p.style.selSimplify++;
      /* V1.2 F1:选区修改的意图原话并入偏好检测(意图常含「以后/都要」类长期表述,强意图加权) */
      trackClauses(p, d.instruction, /以后|默认|记住|总是|每次都/.test(String(d.instruction || '')) ? 3 : 1);
    } else if (ev.t === 'form_defaults') {
      const f = d.form || {};
      const sig = [f.duration, f.venueType, f.audience, budgetTier(f.budgetTotal)].join('|');
      if (sig === p.lastFormSig) return p;          // 同签名草稿:既不计数也不占事件缓冲(P1-2,防刷满环形缓冲)
      p.lastFormSig = sig;
      bump(p.defaults.duration, f.duration, now);
      bump(p.defaults.venueType, f.venueType, now);
      bump(p.defaults.audience, f.audience, now);
    }

    /* 环形缓冲只存事件骨架(类型/话题/操作),供 P3 展示与算法升级重放 */
    const skel = { t: ev.t, at: now };
    if (ev.t === 'section_edited' || ev.t === 'section_ai_op') skel.topic = topicOf(d.title);
    if (ev.t === 'section_ai_op' || ev.t === 'selection_op') skel.op = d.op;
    p.events.push(skel);
    if (p.events.length > MAX_EVENTS) p.events.splice(0, p.events.length - MAX_EVENTS);
    /* V1.1 rawLog:全量 payload 落原始层(docs/16),seq 即编译水位线;
       form_defaults 同签名在上方早退,与此处骨架口径一致(去重事件不重复占用缓冲) */
    p.seq = (p.seq || 0) + 1;
    p.rawLog.push({ seq: p.seq, at: now, t: ev.t, d: trunc(d) });
    if (p.rawLog.length > MAX_RAW) p.rawLog.splice(0, p.rawLog.length - MAX_RAW);
    return p;
  }

  /* 重复特殊需求的确认建议(pending 且 ≥3 次;确认/拒绝后不再出现) */
  function pendingSuggestions() {
    const p = load();
    return Object.keys(p.notesSeen).map(function (k) { return p.notesSeen[k]; })
      .filter(function (s) { return s.state === 'pending' && s.count >= 3; })
      .sort(function (a, b) { return b.count - a.count; })
      .map(function (s) { return { value: s.raw, count: s.count }; });
  }

  /* ── summarize:纯函数,档案 → 限长摘要;只陈述观察,结论由生成模型自行消化 ── */
  function top(list, now) {
    return list.filter(function (e) { return e.count >= MIN_COUNT; })
               .sort(function (a, b) { return weight(b, now) - weight(a, now); })[0] || null;
  }
  function summarize(profile, kind) {
    const p = norm(profile);
    const now = Date.now();
    const S = EP.struct;
    const out = [];
    if (kind === 'plan') {
      /* 两级注入(docs/14):确认级=严格遵守;归纳级(导入/归纳)=参考。
         I-5(用户裁定 a):departments 只收集不注入 —— 表单没有部门字段,注入过往人名/职务
         等于给 AI 提供编造素材,违反「未给信息写待定、不编造」铁律(P1-1 原则);图谱中仍可见可删 */
      const conf = p.facts.preferences.filter(function (x) { return x.source === 'confirmed'; })
        .sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0); });   /* 最近确认的优先注入 */
      if (conf.length) out.push('已确认偏好(严格遵守,与上述活动信息冲突时一律以活动信息为准):' +
        conf.slice(0, 3).map(function (x) { return x.value; }).join(';'));
      const hot = p.hotspots.filter(function (h) { return (h.regen + h.undo) >= 3; })
                            .sort(function (x, y) { return (y.regen + y.undo) - (x.regen + x.undo); })[0];
      if (hot) out.push('注意:「' + hot.value + '」类章节历史上常被重写,撰写时请格外贴近给定信息、不夸大');
      const c = top(p.facts.companies, now); if (c) out.push('常用组织:' + c.value);
      const a = top(p.facts.audiences, now); if (a) out.push('面向人群:' + (S.AUD_LABEL[a.value] || a.value));
      const dur = top(p.defaults.duration, now); if (dur) out.push('常办:' + (S.DUR_LABEL[dur.value] || dur.value));
      const ref = p.facts.preferences.filter(function (x) { return x.source !== 'confirmed'; });
      if (ref.length) out.push('过往方案分析(参考):' +
        ref.sort(function (x, y) { return y.count - x.count; }).slice(0, 3).map(function (x) { return x.value; }).join(';'));
    } else if (kind === 'section' || kind === 'polish') {
      const st = p.style;
      if (st.avgPara.n >= 3 && st.avgPara.delta < -0.15) out.push('用户倾向更简洁(编辑后内容平均缩短 ' + Math.round(-st.avgPara.delta * 100) + '%)');
      /* 「偏好列表化」是结构向信号:regen 可调整组织方式故保留;polish/expand 的 system
         契约要求结构完全不变,注入会与之冲突(P2-1) */
      if (kind === 'section' && st.listDelta.n >= 3 && st.listDelta.delta > 0.5) out.push('偏好以列表要点表达');
      const ph = top(st.removedPhrases, now); if (ph) out.push('避免「' + ph.value + '」类套话');
      if (st.selSimplify >= 2) out.push('常对选区使用本地精简');
      const conf = p.facts.preferences.filter(function (x) { return x.source === 'confirmed'; });
      if (conf.length) out.push('已确认偏好(严格遵守):' + conf.slice(0, 3).map(function (x) { return x.value; }).join(';'));
    }
    /* 限长截断落在「;」分段边界:半句偏好语义残缺,反而误导模型 */
    let s = out.join(';');
    if (s.length > 280) {
      const cut = s.slice(0, 280);
      s = cut.slice(0, Math.max(cut.lastIndexOf(';'), 0));
    }
    return s;
  }

  /* ── 本地存取(档案为辅助数据:满盘/损坏一律静默,不影响主流程) ── */
  function load() {
    try { const v = localStorage.getItem(K); return norm(v ? JSON.parse(v) : null); }
    catch (e) { return empty(); }
  }
  function save(p) { try { localStorage.setItem(K, JSON.stringify(p)); } catch (e) { /* 静默 */ } return p; }
  function record(event) { try { save(update(load(), event)); } catch (e) { /* 埋点绝不影响主流程 */ } }
  function clear() { try { localStorage.removeItem(K); } catch (e) { /* 静默 */ } }
  /* 条目级删除(记忆图谱/档案卡片的"逐条删除"通路):section 为列表型字段名 */
  function remove(section, value) {
    const p = load();
    const lists = {
      companies: p.facts.companies, venues: p.facts.venues, budgetTier: p.facts.budgetTier, audiences: p.facts.audiences,
      duration: p.defaults.duration, venueType: p.defaults.venueType, audience: p.defaults.audience,
      removedPhrases: p.style.removedPhrases
    };
    const list = section === 'hotspots' ? p.hotspots : section === 'preferences' ? p.facts.preferences
      : section === 'departments' ? p.facts.departments : lists[section];
    if (!list) return false;
    const i = list.findIndex(function (e) { return e.value === value; });
    if (i < 0) return false;
    list.splice(i, 1);
    save(p);
    return true;
  }

  return {
    load: load, save: save, record: record, clear: clear, remove: remove,
    update: update, summarize: summarize, pendingSuggestions: pendingSuggestions,
    _internals: { topicOf: topicOf, budgetTier: budgetTier, normClause: normClause }
  };
})();
