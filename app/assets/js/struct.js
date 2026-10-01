/* struct.js — 文档结构契约层(取代原模板/引擎)
   模板内容包已删除:方案由 AI 一次性生成整份文档,本章只负责结构契约:
   · TYPES       活动类型表(仅表单选项与 AI 上下文,不携带任何内容模板)
   · parseDoc    AI 输出(## 章节式 Markdown)→ sections[] 结构化章节
   · migrate     旧版 plan.modules(十大固定模块)→ plan.sections 迁移
   · simplify    本地「精简」降级(离线可用,与 AI 无关) */
window.EP = window.EP || {};
EP.struct = (function () {

  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];

  /* ── 活动类型:纯表单枚举,生成内容完全交给 AI ── */
  const TYPES = [
    { key: 'team_building', name: '公司团建' },
    { key: 'birthday', name: '员工生日会' },
    { key: 'annual_gala', name: '企业年会' },
    { key: 'client_salon', name: '客户沙龙·答谢会' },
    { key: 'product_launch', name: '新品发布会' },
    { key: 'training', name: '内部培训' },
    { key: 'festival', name: '节日主题活动' },
    { key: 'outdoor', name: '户外拓展' },
    { key: 'other', name: '其他活动' }
  ];
  const TYPE_LABEL = TYPES.reduce(function (m, t) { m[t.key] = t.name; return m; }, {});

  const DUR_LABEL = { half: '半天(约 4 小时)', day: '一天', dayhalf: '一天半', two: '两天一夜' };
  const VENUE_LABEL = { office: '公司内', indoor: '室内场地', outdoor: '户外', online: '线上线下结合' };
  const AUD_LABEL = { staff: '员工', client: '客户', partner: '合作伙伴', mixed: '混合人群' };

  function typeLabel(key) { return TYPE_LABEL[key] || key || '未分类'; }
  function typeIcon(key) {
    /* 类型图标沿用已内嵌的 tpl-* 资产;未知类型兜底为通用文档图标 */
    return (EP.icons && EP.icons['tpl-' + key]) ? EP.icon('tpl-' + key) : EP.icon('text');
  }

  /* ── 旧数据契约:十大固定模块(仅用于 migrate,新方案不再产生该结构) ── */
  const LEGACY = [
    { key: 'overview', title: '活动整体概述与背景' },
    { key: 'schedule', title: '活动流程时间表' },
    { key: 'segments', title: '活动环节详细设计' },
    { key: 'staffing', title: '活动人员分工表' },
    { key: 'materials', title: '活动物料清单' },
    { key: 'budget', title: '活动预算明细表' },
    { key: 'copy', title: '活动宣传文案' },
    { key: 'script', title: '活动主持词完整稿件' },
    { key: 'safety', title: '安全预案与风险规避' },
    { key: 'review', title: '活动复盘维度清单' }
  ];

  function migrate(plan) {
    if (!plan || plan.sections) return plan;
    const mods = plan.modules || {};
    plan.sections = LEGACY.map(function (m, i) {
      const old = mods[m.key] || {};
      return { id: 's' + i, title: m.title, md: old.md || '', flags: old.flags || {}, prev: old.prev };
    }).filter(function (s) { return s.md; });
    delete plan.modules;
    return plan;
  }

  /* ── 方案基本信息字段表(单一事实源):exporter(Markdown 表)与 word(docx 表)共用;
        doceditor.metaLine 形态不同(单行摘要)不在此列 ── */
  function metaRows(form) {
    return [
      ['活动类型', typeLabel(form.type)],
      ['活动日期', (form.date || '待定') + (form.startTime ? ' ' + form.startTime + ' 开始' : '')],
      ['活动时长', DUR_LABEL[form.duration] || form.duration || '待定'],
      ['活动地点', (form.venue || '待定') + '(' + (VENUE_LABEL[form.venueType] || '待定') + ')'],
      ['参与人数', form.headcount ? form.headcount + ' 人' : '待定'],
      ['面向人群', AUD_LABEL[form.audience] || '待定'],
      ['预算总额', form.budgetTotal ? '¥' + Number(form.budgetTotal).toLocaleString() : '未设定'],
      ['组织单位', form.company || '待定']
    ];
  }

  /* ── AI 输出 → 章节 ──
     契约:章节以「## 标题」分隔(宽容接受「# 」);章内允许 #### 小节标题、
     段落、列表、管道表格、引用;更深的标题一律降级为 ####(渲染层唯一支持的小节层级) */
  function parseDoc(raw) {
    let text = String(raw || '').replace(/\r\n?/g, '\n').trim();
    text = text.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?\s*```\s*$/, '');   // 容错:剥掉模型偶尔包裹的代码块围栏
    const sections = [];
    let cur = null;
    text.split('\n').forEach(function (line) {
      const h = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
      if (h) {
        cur = { title: h[2], md: [] };
        sections.push(cur);
        return;
      }
      if (!cur) return;                                  // 首个章节前的内容(模型寒暄)丢弃
      cur.md.push(line.replace(/^#{3,6}\s+/, '#### '));
    });
    const out = sections.map(function (s, i) {
      const title = (s.title || '第' + (i + 1) + '节')
        .replace(/^[一二三四五六七八九十0-9]+\s*[、.．)]\s*/, '')   // 剥掉模型自带的序号(渲染时统一加「一、」)
        .replace(/[::]\s*$/, '');
      return { id: 's' + i, title: title, md: s.md.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
    }).filter(function (s) { return s.md || s.title; });
    if (!out.length) return { ok: false, error: 'AI 返回内容中没有「## 」章节标题,无法解析为文档' };
    return { ok: true, sections: out };
  }

  /* ── 本地「精简」:确定性降级(未接 AI 也可用) ── */
  function simplify(md) {
    let removed = 0;
    const lines = md.split('\n').filter(function (line) {
      const t = line.trim();
      if (/^[-*]\s.*((\(可选\))|【可选】|加分项)/.test(t)) { removed++; return false; }
      return true;
    }).map(function (line) {
      const t = line.trim();
      if (t && !t.startsWith('|') && !t.startsWith('#') && !t.startsWith('-') && !t.startsWith('>') && t.length > 90) {
        removed++;
        let cut = t.slice(0, t.indexOf('。') > 20 ? t.indexOf('。') + 1 : 90) + '……';
        if (((cut.match(/\*\*/g) || []).length) % 2) cut += '**';   // 截断点落在加粗内部时闭合标记
        return cut;
      }
      return line;
    });
    return { md: lines.join('\n'), removed: removed };
  }

  return {
    CN: CN, TYPES: TYPES,
    DUR_LABEL: DUR_LABEL, VENUE_LABEL: VENUE_LABEL, AUD_LABEL: AUD_LABEL,
    typeLabel: typeLabel, typeIcon: typeIcon,
    migrate: migrate, parseDoc: parseDoc, simplify: simplify, metaRows: metaRows
  };
})();
