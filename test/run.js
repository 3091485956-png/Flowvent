/* test/run.js — 最小可行测试基线(零依赖,node:test 风格手写断言)
   运行:node test/run.js
   v2(模板引擎已删除,AI 整案生成架构)覆盖:
   文档结构契约(parseDoc 解析 / 旧数据迁移 / 类型表)、md 渲染与转义、
   Word(.docx)导出的 ZIP 结构与 OOXML 内容、存储 CRUD 与写入失败路径、
   Markdown 导出 / 本地精简 / AI prompt 契约。
   说明:app.js / doceditor.js 定义期依赖 DOM,不在 node 层测试,走浏览器实测;
   AI 网络层(fetch)以 prompt 纯函数与解析器为测试边界。 */
process.title = 'ep-test';
global.window = global;                      // 各模块约定 window.EP 全局命名空间

/* localStorage 桩:可控抛错以复现写入失败路径 */
const store = {};
global.localStorage = {
  quotaFail: false,
  setItem(k, v) { if (this.quotaFail) throw new Error('QuotaExceededError'); store[k] = String(v); },
  getItem(k) { return k in store ? store[k] : null; },
  removeItem(k) { delete store[k]; }
};

const path = require('path');
const J = f => path.join(__dirname, '..', 'app', 'assets', 'js', f);
['icons', 'md', 'struct', 'profile', 'intake', 'memory', 'ai', 'storage', 'exporter', 'word'].forEach(m => require(J(m)));

let pass = 0, fail = 0; const failures = []; const queue = [];
function t(name, fn) { queue.push([name, fn]); }   // 入队,支持 async 断言(run 时统一执行)
async function run() {
  for (const item of queue) {
    const name = item[0], fn = item[1];
    try { await fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) { fail++; failures.push(name + ' :: ' + e.message); console.log('  ✗ ' + name + ' — ' + e.message); }
  }
  console.log('\n' + '='.repeat(52));
  console.log('结果:' + pass + ' 通过 / ' + fail + ' 失败');
  if (failures.length) { console.log('\n失败清单:'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}
const assert = require('assert');

const FORM = (key) => ({
  company: '星海科技', name: '测试活动', type: key || 'team_building', purpose: '增强凝聚力',
  date: '2026-10-24', startTime: '08:30', duration: 'two', headcount: 60,
  venueType: 'outdoor', venue: '临湖基地', budgetTotal: 30000,
  audience: 'staff', notes: '有 3 位素食同事', festival: key === 'festival' ? '中秋' : '', product: key === 'product_launch' ? '星舰Pro' : ''
});
const PLAN = () => ({
  id: 'ptest', name: '2026 秋季全员团建<测试>', type: 'team_building',
  createdAt: 1, updatedAt: 1, status: 'active', form: FORM(),
  sections: [
    { id: 's0', title: '活动概述', md: '**概述**段落第一行。\n\n| 时间 | 环节 |\n| --- | --- |\n| 08:30 | 签到 |{:sum}' },
    { id: 's1', title: '流程时间表', md: '#### 上半场\n- 签到集合\n- 破冰热身\n\n> 全程配置安全员,每 30 分钟巡查一次' }
  ]
});

/* ── AI 输出样例:覆盖代码块围栏容错 / 自带序号 / ### 降级 / 表格行标记 / 前置寒暄 ── */
const AI_SAMPLE = '好的,以下是方案:\n```markdown\n## 一、活动概述\n这是概述。\n\n### 我是不该出现的深层标题\n概述继续。\n\n## 二、流程时间表\n| 时间 | 环节 |\n| --- | --- |\n| 09:00 | 开场 |\n| 10:00 | 团队挑战 |{:warn}\n\n## 三、预算明细\n预算合计 **¥30,000**。\n```';

console.log('\n[1] parseDoc:AI 输出 → 章节结构');
t('按 ## 切分章节,剥掉代码块围栏与前置寒暄', () => {
  const r = EP.struct.parseDoc(AI_SAMPLE);
  assert.ok(r.ok, '解析失败:' + r.error);
  assert.strictEqual(r.sections.length, 3);
  assert.strictEqual(r.sections[0].title, '活动概述', '未剥模型自带序号:' + r.sections[0].title);
});
t('章内 ### 降级为 ####(渲染层唯一支持的小节层级)', () => {
  const r = EP.struct.parseDoc(AI_SAMPLE);
  assert.ok(r.sections[0].md.includes('#### 我是不该出现的深层标题'), r.sections[0].md);
});
t('表格 {:warn} 行标记与 ** 加粗原样保留', () => {
  const r = EP.struct.parseDoc(AI_SAMPLE);
  assert.ok(r.sections[1].md.includes('| 10:00 | 团队挑战 |{:warn}'));
  assert.ok(r.sections[2].md.includes('**¥30,000**'));
});
t('无任何 ## 标题时报可读错误(不产出空方案)', () => {
  const r = EP.struct.parseDoc('这段没有任何章节标题。');
  assert.ok(!r.ok && /## /.test(r.error));
});
t('章节 id 稳定生成(s0 起,供编辑页 data-m 映射)', () => {
  const r = EP.struct.parseDoc(AI_SAMPLE);
  assert.deepStrictEqual(r.sections.map(s => s.id), ['s0', 's1', 's2']);
});

console.log('\n[2] migrate:旧版 plan.modules → plan.sections');
t('十大固定模块按原顺序迁移,空模块剔除', () => {
  const old = { id: 'p1', name: '旧方案', type: 'team_building', form: FORM(), modules: {
    overview: { md: '概述内容' }, schedule: { md: '' }, budget: { md: '预算内容', flags: { edited: true } }
  } };
  const m = EP.struct.migrate(old);
  assert.ok(!m.modules, 'modules 未删除');
  assert.strictEqual(m.sections.length, 2);
  assert.strictEqual(m.sections[0].title, '活动整体概述与背景');
  assert.strictEqual(m.sections[1].flags.edited, true, 'flags 丢失');
});
t('已是 sections 结构的方案原样通过;storage 读取时自动迁移', () => {
  global.localStorage.removeItem('ep_plans');
  const legacy = { id: 'pold', name: '旧', type: 'training', form: FORM('training'), modules: { overview: { md: 'x' } } };
  global.localStorage.setItem('ep_plans', JSON.stringify([legacy]));
  const got = EP.store.getPlan('pold');
  assert.ok(got.sections && got.sections.length === 1, 'storage 未迁移旧数据');
});

console.log('\n[3] 类型表与渲染契约');
t('9 个活动类型,键唯一且含 other 兜底', () => {
  assert.strictEqual(EP.struct.TYPES.length, 9);
  assert.strictEqual(new Set(EP.struct.TYPES.map(t => t.key)).size, 9);
  assert.ok(EP.struct.TYPES.some(t => t.key === 'other'));
});
t('typeLabel 未知类型回退原值,known 返回中文名', () => {
  assert.strictEqual(EP.struct.typeLabel('annual_gala'), '企业年会');
  assert.strictEqual(EP.struct.typeLabel('mystery'), 'mystery');
});
t('md.render:表格 {:sum} 行 / 列表 / 引用 / ⚠→图标', () => {
  const html = EP.md.render('| a | b |\n| --- | --- |\n| x | y |{:sum}');
  assert.ok(html.includes('sum-row'));
  const h2 = EP.md.render('- 甲\n- 乙\n> 提示\n⚠ 警告');
  assert.ok(h2.includes('<ul>') && h2.includes('<blockquote>') && h2.includes('<svg'), h2);
});
t('表格行尾 {:warn} 标记不泄漏为单元格,表头与数据列数一致', () => {
  const html = EP.md.render('| 时间 | 环节 | 备注 |\n| --- | --- | --- |\n| 19:00 | 晚宴 | 十佳员工 |{:warn}');
  assert.ok(!/\{:\w+\}/.test(html), '标记泄漏进单元格:' + html);
  assert.strictEqual((html.match(/<th>/g) || []).length, 3);
  assert.strictEqual((html.match(/<td>/g) || []).length, 3);
});
t('esc 引号转义(属性注入防护)', () => {
  const out = EP.md.esc('a"b\'c<d');
  assert.ok(out.indexOf('&quot;') >= 0 && out.indexOf('&#39;') >= 0);
});

console.log('\n[4] Word(.docx)导出:ZIP 结构完整性');
t('ZIP:签名 / EOCD / 条目数 / CRC 全部有效', () => {
  const bytes = EP.word.build(PLAN());
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.strictEqual(dv.getUint32(0, true), 0x04034b50, '缺 local file header 签名');
  /* 找 EOCD(末 22 字节固定) */
  assert.strictEqual(dv.getUint32(bytes.length - 22, true), 0x06054b50, '缺 EOCD 签名');
  const n = dv.getUint16(bytes.length - 22 + 10, true);
  assert.strictEqual(n, 5, '条目数应为 5,实际 ' + n);
  /* 逐条目校验 CRC 与数据长度(STORE:紧跟文件名即数据) */
  const dec = new TextDecoder();
  let off = 0, checked = 0;
  while (off < bytes.length - 22) {
    if (dv.getUint32(off, true) !== 0x04034b50) break;
    const crc = dv.getUint32(off + 14, true), sz = dv.getUint32(off + 18, true), nl = dv.getUint16(off + 26, true);
    const data = bytes.subarray(off + 30 + nl, off + 30 + nl + sz);
    assert.strictEqual(EP.word._internals.crc32(data), crc, 'CRC 校验失败');
    checked++;
    off += 30 + nl + sz;
  }
  assert.strictEqual(checked, 5, '实际遍历条目 ' + checked);
  assert.ok(bytes.length > 3000, '产物过小:' + bytes.length);
});
t('ZIP:必备 OOXML 部件齐全', () => {
  const bytes = EP.word.build(PLAN());
  const dec = new TextDecoder();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names = [];
  let off = 0;
  while (off < bytes.length - 22) {
    if (dv.getUint32(off, true) !== 0x04034b50) break;
    const sz = dv.getUint32(off + 18, true), nl = dv.getUint16(off + 26, true);
    names.push(dec.decode(bytes.subarray(off + 30, off + 30 + nl)));
    off += 30 + nl + sz;
  }
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml']
    .forEach(nm => assert.ok(names.includes(nm), '缺部件 ' + nm));
});

console.log('\n[5] Word:OOXML 内容正确性');
t('文档名与章节标题进入 document.xml,特殊字符已转义', () => {
  const xml = EP.word.docXml(PLAN());
  assert.ok(xml.includes('2026 秋季全员团建&lt;测试&gt;'), '标题未转义或缺失');
  assert.ok(xml.includes('一、活动概述') && xml.includes('二、流程时间表'));
});
t('表格 / 表头着色 / {:sum} 行着色 / 加粗 run / 列表 / 引用边框', () => {
  const xml = EP.word.docXml(PLAN());
  assert.ok(xml.includes('<w:tbl>'));
  assert.ok(xml.includes('w:fill="E8EEF9"'), '表头未着色');
  assert.ok(xml.includes('w:fill="EAF1FD"'), '{:sum} 行未着色');
  assert.ok(/<w:r><w:rPr><w:b\/>/.test(xml), '加粗未生成独立 run');
  assert.ok(xml.includes('• 签到集合'), '无序列表前缀缺失');
  assert.ok(xml.includes('<w:pBdr>'), '引用左边框缺失');
});
t('A4 页面与 sectPr 存在,样式表含中文字体声明', () => {
  const xml = EP.word.docXml(PLAN());
  assert.ok(xml.includes('w:w="11906"') && xml.includes('<w:sectPr>'));
});

console.log('\n[6] 存储:CRUD 与写入失败路径');
t('quotaFail 时 savePlan 返回失败标记且不误报成功', () => {
  global.localStorage.removeItem('ep_plans');
  EP.store.savePlan(PLAN());
  assert.strictEqual(EP.store.getPlans().length, 1);
  global.localStorage.quotaFail = true;
  const r = EP.store.savePlan(Object.assign(PLAN(), { id: 'p2' }));
  global.localStorage.quotaFail = false;
  assert.ok(r && r.saved === false, '写入失败未传播:' + JSON.stringify(r));
  assert.strictEqual(EP.store.getPlans().length, 1);
});
t('savePlan 基于最新存储做数组级合并(多标签并发回归)', () => {
  global.localStorage.removeItem('ep_plans');
  EP.store.savePlan(Object.assign(PLAN(), { id: 'tagA-p1' }));
  const cur = JSON.parse(global.localStorage.getItem('ep_plans'));
  cur.unshift(Object.assign(PLAN(), { id: 'tagB-p2' }));
  global.localStorage.setItem('ep_plans', JSON.stringify(cur));
  EP.store.savePlan(Object.assign(PLAN(), { id: 'tagA-p1', name: 'v2' }));
  const ids = EP.store.getPlans().map(p => p.id).sort();
  assert.deepStrictEqual(ids, ['tagA-p1', 'tagB-p2'], '他人写入被覆盖:' + ids);
});
t('listPlans 搜索 / 类型过滤 / 归档分组', () => {
  global.localStorage.removeItem('ep_plans');
  EP.store.savePlan(PLAN());
  const other = Object.assign(PLAN(), { id: 'px', name: '年会', type: 'annual_gala' });
  EP.store.savePlan(other);
  EP.store.archivePlan('px', true);
  assert.strictEqual(EP.store.listPlans('', 'team_building').active.length, 1);
  assert.strictEqual(EP.store.listPlans('年会').archived.length, 1);
  assert.strictEqual(EP.store.listPlans().active.length, 1);
});
t('copyPlan:sections 方案复制成功(新 id / 副本无 prev / 源不受影响)', () => {
  global.localStorage.removeItem('ep_plans');
  const src = PLAN();
  src.sections[0].prev = '旧内容';
  EP.store.savePlan(src);
  const copy = EP.store.copyPlan('ptest');
  assert.ok(copy, 'copyPlan 抛错或返回空');
  assert.notStrictEqual(copy.id, 'ptest', '副本未分配新 id');
  assert.ok(copy.name.indexOf('副本') >= 0);
  assert.ok(copy.sections.every(s => !('prev' in s)), '副本继承了撤销历史 prev');
  const again = EP.store.getPlan('ptest');
  assert.strictEqual(again.sections[0].prev, '旧内容', '源方案被改动');
  assert.strictEqual(EP.store.getPlans().length, 2);
});
t('sections[].md 为空串可正常写入读回(编辑页清空整节场景)', () => {
  global.localStorage.removeItem('ep_plans');
  const p = PLAN();
  p.sections[1].md = '';
  EP.store.savePlan(p);
  const got = EP.store.getPlan('ptest');
  assert.ok(got.sections[1].md === '', '空内容在存储往返中丢失');
});

console.log('\n[7] Markdown 导出与本地精简');
t('toMarkdown:基本信息表 + 章节标题 + 内容', () => {
  const md = EP.exporter.toMarkdown(PLAN());
  assert.ok(md.includes('# 2026 秋季全员团建<测试>'));
  assert.ok(md.includes('## 一、活动概述'));
  assert.ok(md.includes('| 活动类型 | 公司团建 |'));
});
t('章节超 20 个:中文序号兜底为数字,导出与 docx 均无 undefined', () => {
  const p = Object.assign(PLAN(), {
    sections: Array.from({ length: 25 }, function (_, i) { return { id: 's' + i, title: '第' + (i + 1) + '节', md: '内容' }; })
  });
  const md = EP.exporter.toMarkdown(p);
  assert.ok(md.indexOf('undefined') < 0, 'Markdown 导出出现 undefined');
  assert.ok(md.indexOf('## 21、第21节') >= 0, '数字兜底缺失');
  const xml = EP.word.docXml(p);
  assert.ok(xml.indexOf('undefined') < 0, 'docx 出现 undefined');
  assert.ok(xml.indexOf('21、第21节') >= 0, 'docx 数字兜底缺失');
});
t('基本信息字段单一事实源:struct.metaRows 驱动 Markdown 表与 docx 表', () => {
  const rows = EP.struct.metaRows(FORM());
  assert.strictEqual(rows.length, 8, '字段数与预期不符:' + rows.length);
  rows.forEach(function (r) {
    assert.strictEqual(r.length, 2);
    assert.ok(r[0] && String(r[1]).indexOf('undefined') < 0, r[0] + ' 值异常:' + r[1]);
  });
  const md = EP.exporter.toMarkdown(PLAN());
  rows.forEach(function (r) { assert.ok(md.indexOf('| ' + r[0] + ' |') >= 0, 'Markdown 缺字段 ' + r[0]); });
  const xml = EP.word.docXml(PLAN());
  const firstTable = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'));
  assert.strictEqual((firstTable.match(/<w:tr>/g) || []).length, rows.length + 1,
    'docx 基本信息表行数(' + (firstTable.match(/<w:tr>/g) || []).length + ')与 metaRows(' + rows.length + '+表头)不一致');
});
t('精简截断不得破坏加粗标记(** 成对)', () => {
  const md = 'x'.repeat(30) + '**' + 'y'.repeat(120);
  const r = EP.struct.simplify(md);
  assert.ok(r.removed > 0);
  assert.strictEqual((r.md.match(/\*\*/g) || []).length % 2, 0);
});
t('精简剔除(可选)类列表项', () => {
  const r = EP.struct.simplify('- 必备物料 A\n- 桌牌(可选)');
  assert.ok(!r.md.includes('可选') && r.removed === 1);
});

console.log('\n[8] AI prompt 契约(不触网,校验纯函数输出结构)');
t('parseDoc 能消化 SYS_PLAN 约定的输出形态(## 章节 + #### + 表格 + 引用)', () => {
  const sample = '## 活动概述\n一句话概述。\n\n## 流程时间表\n| 时间 | 环节 |\n| --- | --- |\n| 09:00 | 开场 |\n\n## 安全预案\n> 户外活动全程配置安全员';
  const r = EP.struct.parseDoc(sample);
  assert.ok(r.ok && r.sections.length === 3);
  assert.ok(r.sections[2].md.startsWith('> '));
});
t('typeIcon 未知类型兜底不产出空图标', () => {
  const html = EP.struct.typeIcon('mystery');
  assert.ok(html.includes('<svg'), '兜底图标缺失');
});

console.log('\n[9] EP.profile:越用越懂用户(事件→档案→摘要→注入)');
const NOW0 = Date.now();
const DAY = 86400000;
const evE1 = (company, venue) => ({ t: 'plan_generated', at: NOW0, data: { form: Object.assign(FORM(), { company: company, venue: venue }) } });
const LONG_MD = '综上所述,本次团建旨在增强凝聚力,值得一提的是全体同事将参与户外拓展训练,众所周知团队协作是企业发展的基石,由此可见团队建设的重要性不言而喻,我们期待通过本次活动深化协作与沟通。';
const SHORT_LIST = '- 增强凝聚力\n- 户外拓展训练\n- 深化跨部门协作';
const evE2 = () => ({ t: 'section_edited', at: NOW0, data: { title: '活动概述', prevMd: LONG_MD, newMd: SHORT_LIST } });

t('E1 生成两次:公司事实计数;场地/预算只收集不注入(表单可空字段,防绕过待定契约)', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record(evE1('星海科技', '临湖山庄'));
  EP.profile.record(evE1('星海科技', '临湖山庄'));
  const p = EP.profile.load();
  assert.strictEqual(p.facts.companies[0].value, '星海科技');
  assert.strictEqual(p.facts.companies[0].count, 2);
  assert.strictEqual(p.facts.venues[0].count, 2, '场地未收集(P3 档案卡与显式确认仍需要)');
  const s = EP.profile.summarize(p, 'plan');
  assert.ok(s.includes('星海科技'), s);
  assert.ok(!s.includes('临湖山庄'), 'P1-1:历史场地被注入摘要(可空字段有编造风险)');
});
t('单次观察不入摘要(防偶发污染,NOOP 默认)', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record(evE1('一次性公司', '一次性场地'));
  const s = EP.profile.summarize(EP.profile.load(), 'plan');
  assert.ok(!s.includes('一次性公司'), s);
});
t('空档案摘要为空串', () => {
  global.localStorage.removeItem('ep_profile');
  assert.strictEqual(EP.profile.summarize(EP.profile.load(), 'plan'), '');
});
t('E2 编辑对照:缩短/列表化/套话删除被统计,样本≥3 次进章节摘要', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record(evE2()); EP.profile.record(evE2()); EP.profile.record(evE2());
  const p = EP.profile.load();
  assert.ok(p.style.avgPara.n === 3 && p.style.avgPara.delta < -0.3, JSON.stringify(p.style));
  assert.ok(p.style.listDelta.delta > 1, '列表化未被统计');
  assert.strictEqual(p.style.removedPhrases.find(x => x.value === '综上所述').count, 3);
  const s = EP.profile.summarize(p, 'section');
  assert.ok(s.includes('简洁') || s.includes('缩短'), s);
  assert.ok(s.includes('列表'), s);
  assert.ok(s.includes('综上所述'), s);
});
t('E2 样本不足 3 次:文风结论不进摘要', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record(evE2()); EP.profile.record(evE2());
  const s = EP.profile.summarize(EP.profile.load(), 'section');
  assert.ok(!s.includes('缩短') && !s.includes('列表化'), s);
});
t('E3 热区:预算类章节 regen 3 次+撤销 1 次 → 整案摘要提示谨慎', () => {
  global.localStorage.removeItem('ep_profile');
  for (let i = 0; i < 3; i++) EP.profile.record({ t: 'section_ai_op', at: NOW0, data: { title: '预算明细', op: 'regen' } });
  EP.profile.record({ t: 'section_ai_op', at: NOW0, data: { title: '预算明细', op: 'undoai' } });
  const p = EP.profile.load();
  const hot = p.hotspots.find(h => h.value === '预算');
  assert.ok(hot && hot.regen === 3 && hot.undo === 1, JSON.stringify(p.hotspots));
  assert.ok(EP.profile.summarize(p, 'plan').includes('预算'), '热区未进摘要');
});
t('E4 选区本地精简 2 次 → 偏好简洁佐证进章节摘要', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record({ t: 'selection_op', at: NOW0, data: { op: 'simplify', before: 'x'.repeat(80), after: 'x'.repeat(30) } });
  EP.profile.record({ t: 'selection_op', at: NOW0, data: { op: 'simplify', before: 'y'.repeat(80), after: 'y'.repeat(20) } });
  assert.ok(EP.profile.summarize(EP.profile.load(), 'section').includes('精简'), '选区精简信号丢失');
});
t('E5 表单默认值:相同签名去重,变化才计数', () => {
  global.localStorage.removeItem('ep_profile');
  const f = Object.assign(FORM(), { duration: 'half', venueType: 'outdoor', audience: 'staff' });
  EP.profile.record({ t: 'form_defaults', at: NOW0, data: { form: f } });
  EP.profile.record({ t: 'form_defaults', at: NOW0, data: { form: f } });
  let p = EP.profile.load();
  assert.strictEqual(p.defaults.duration[0].count, 1, '相同签名被重复计数');
  EP.profile.record({ t: 'form_defaults', at: NOW0, data: { form: Object.assign({}, f, { duration: 'day' }) } });
  p = EP.profile.load();
  assert.strictEqual(p.defaults.duration.length, 2, '变化未入档');
});
t('时间衰减:同计数下新观察优先(0.5^(天/180))', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.save({ ver: 1, facts: { companies: [
    { value: '一年前的公司', count: 5, firstSeen: NOW0 - 365 * DAY, lastSeen: NOW0 - 365 * DAY },
    { value: '本周的公司', count: 5, firstSeen: NOW0 - 2 * DAY, lastSeen: NOW0 - 2 * DAY }
  ] }, style: {}, hotspots: [], defaults: {}, events: [] });
  const s = EP.profile.summarize(EP.profile.load(), 'plan');
  assert.ok(s.includes('本周的公司') && !s.includes('一年前的公司'), s);
});
t('注入零回归:无档案时整案 prompt 与现状逐字节一致', () => {
  global.localStorage.removeItem('ep_profile');
  const msgs = EP.ai.buildPlanMessages(FORM());
  assert.strictEqual(msgs[1].content, '活动信息如下:\n' + EP.ai.formBrief(FORM()), '无档案时 prompt 发生变化');
  const rmsgs = EP.ai.buildRegenMessages(FORM(), '一、概述', '活动概述', '旧内容');
  assert.ok(!rmsgs[1].content.includes('偏好'), '无档案时重写 prompt 被拼接偏好');
});
t('注入:有档案时整案 prompt 含记忆库段 + 优先级声明 + 学到的事实', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record(evE1('星海科技', ''));
  EP.profile.record(evE1('星海科技', ''));
  const msgs = EP.ai.buildPlanMessages(FORM());
  assert.ok(msgs[1].content.includes('记忆库'), '缺档案段');
  assert.ok(msgs[1].content.includes('以活动信息为准'), '缺优先级声明');
  assert.ok(msgs[1].content.includes('星海科技'), '档案事实未注入');
  assert.ok(msgs[1].content.length <= 800, '注入过长:' + msgs[1].content.length);
});
t('P1-1 注入语义边界:表单留空的场地/预算不得被档案历史值填充', () => {
  global.localStorage.removeItem('ep_profile');
  for (let i = 0; i < 2; i++) EP.profile.record(evE1('星海科技', '临湖山庄'));   // FORM 预算 3 万 → 档位「1万-3万」×2
  const form = Object.assign(FORM(), { company: '北辰新公司', venue: '', budgetTotal: '' });
  const user = EP.ai.buildPlanMessages(form)[1].content;
  assert.ok(!user.includes('临湖山庄'), '历史场地进入未填场地的活动 prompt');
  assert.ok(!user.includes('1万-3万'), '历史预算档位进入未填预算的活动 prompt');
  assert.ok(!user.includes('预算档位') && !user.includes('常用场地'), '可空字段类型整体不应出现');
});
t('P1-2 事件缓冲去重:同签名草稿反复保存只占一条骨架', () => {
  global.localStorage.removeItem('ep_profile');
  for (let i = 0; i < 5; i++) EP.profile.record({ t: 'form_defaults', at: NOW0, data: { form: FORM() } });
  const p = EP.profile.load();
  assert.strictEqual(p.events.filter(e => e.t === 'form_defaults').length, 1,
    '骨架未去重,环形缓冲将被高频草稿事件刷满');
});
t('P2-1 polish/expand 注入不含结构向偏好(与「结构完全不变」契约不冲突)', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record(evE2()); EP.profile.record(evE2()); EP.profile.record(evE2());
  const p = EP.profile.load();
  const sPolish = EP.profile.summarize(p, 'polish');
  const sRegen = EP.profile.summarize(p, 'section');
  assert.ok(!sPolish.includes('列表'), 'polish/expand 摘要含结构向偏好:' + sPolish);
  assert.ok(sRegen.includes('列表'), 'regen 摘要仍应保留列表化偏好');
});
t('P2-3 热区提示排整案摘要前列(超长截断时不丢失;确认偏好之后)', () => {
  global.localStorage.removeItem('ep_profile');
  for (let i = 0; i < 3; i++) EP.profile.record({ t: 'section_ai_op', at: NOW0, data: { title: '预算明细', op: 'regen' } });
  for (let i = 0; i < 2; i++) EP.profile.record(evE1('名字特别长的某某集团股份有限公司', '名字特别长的临湖国际会展中心度假村'));
  const s = EP.profile.summarize(EP.profile.load(), 'plan');
  assert.ok(s.indexOf('注意:') >= 0 && s.indexOf('注意:') < 100, '热区被挤出前置区:' + s);
  assert.ok(s.includes('预算'));
});

console.log('\n[10] EP.memory:记忆库图谱(数据层)');
const MD_A = '---\ntitle: 团建方案\ntags: 团建, 预算\n---\n# 团建方案\n\n## 时间安排\n详见 [[物料清单]] 与 [[复盘模板#格式|模板]]。\n\n#户外 #跨部门';
const MD_B = '# 物料清单\n\n关联 [[团建方案]]。\n内容含普通链接 [外部](https://example.com) 不建节点。';
const evFile = (path, text) => ({ path: path, text: text, mtime: 1 });

t('parseMd:frontmatter / 标题 / wikilink(含 #锚点与 |别名)/ 行内标签 / 普通链接不采集', () => {
  const r = EP.memory.parseMd(MD_A);
  assert.strictEqual(r.fm.title, '团建方案');
  assert.deepStrictEqual(r.fmTags, ['团建', '预算'], 'frontmatter tags 未解析:' + JSON.stringify(r.fmTags));
  assert.ok(r.headings.some(h => h.level === 2 && h.text === '时间安排'));
  assert.deepStrictEqual(r.wikilinks.sort(), ['物料清单', '复盘模板'].sort());
  assert.ok(r.tags.includes('户外') && r.tags.includes('跨部门'), JSON.stringify(r.tags));
  const rb = EP.memory.parseMd(MD_B);
  assert.ok(!JSON.stringify(rb.wikilinks).includes('example.com'), '普通链接被当作 wikilink');
});
t('createStore / 多库隔离 / importFiles 构建节点与四类边', () => {
  global.localStorage.removeItem('ep_memory');
  const s1 = EP.memory.createStore('工作库', '测试');
  const s2 = EP.memory.createStore('私人库', '');
  assert.notStrictEqual(s1.id, s2.id);
  const r = EP.memory.importFiles(s1.id, [evFile('notes/a.md', MD_A), evFile('notes/b.md', MD_B)]);
  assert.ok(r.added >= 2, '导入计数异常:' + JSON.stringify(r));
  const g = EP.memory.graphOf(s1.id, { withProfile: false });
  const types = {};
  Object.values(g.nodes).forEach(n => { types[n.type] = (types[n.type] || 0) + 1; });
  assert.ok(types.Note === 2, 'Note 数:' + JSON.stringify(types));
  assert.ok(types.Tag >= 4, 'Tag 数(团建/预算/户外/跨部门):' + JSON.stringify(types));
  assert.ok(types.Heading >= 1, 'Heading 缺失');
  const edgeTypes = {};
  g.edges.forEach(e => { edgeTypes[e.type] = (edgeTypes[e.type] || 0) + 1; });
  assert.ok(edgeTypes.CONTAINS >= 1, 'CONTAINS 缺失');
  assert.ok(edgeTypes.HAS_TAG >= 4, 'HAS_TAG 缺失');
  assert.ok((edgeTypes.LINKS_TO || 0) >= 3, '双链缺失(a→物料/复盘模板,b→团建方案):' + JSON.stringify(edgeTypes));
  /* 库隔离:s2 无数据 */
  assert.strictEqual(Object.keys(EP.memory.graphOf(s2.id, { withProfile: false }).nodes).length, 0);
});
t('悬空 wikilink 建 Concept;目标后导入自动连边', () => {
  global.localStorage.removeItem('ep_memory');
  const s = EP.memory.createStore('库', '');
  EP.memory.importFiles(s.id, [evFile('x.md', MD_A)]);          // 引用 [[物料清单]],目标未导入
  let g = EP.memory.graphOf(s.id, { withProfile: false });
  const dangling = Object.values(g.nodes).find(n => n.type === 'Concept' && n.label === '物料清单');
  assert.ok(dangling, '悬空 Concept 未创建');
  const noteA = Object.values(g.nodes).find(n => n.type === 'Note' && n.label === '团建方案');
  assert.ok(g.edges.some(e => e.type === 'LINKS_TO' && e.source === noteA.id && e.target === dangling.id), '未连向悬空 Concept');
  EP.memory.importFiles(s.id, [evFile('b.md', MD_B)]);          // 目标到来
  g = EP.memory.graphOf(s.id, { withProfile: false });
  const noteB = Object.values(g.nodes).find(n => n.type === 'Note' && n.label === '物料清单');
  assert.ok(noteB && g.edges.some(e => e.type === 'LINKS_TO' && e.source === noteA.id && e.target === noteB.id),
    '目标导入后未重定向到 Note');
});
t('增量导入:未变更跳过;内容变更重建子图且旧标签不残留', () => {
  global.localStorage.removeItem('ep_memory');
  const s = EP.memory.createStore('库', '');
  EP.memory.importFiles(s.id, [evFile('a.md', MD_A)]);
  const r2 = EP.memory.importFiles(s.id, [evFile('a.md', MD_A)]);
  assert.strictEqual(r2.skipped, 1, '同 hash 未跳过');
  const r3 = EP.memory.importFiles(s.id, [evFile('a.md', '# 新标题\n\n只有 #新标签')]);
  assert.ok(r3.updated === 1, '变更未识别:' + JSON.stringify(r3));
  const g = EP.memory.graphOf(s.id, { withProfile: false });
  const labels = Object.values(g.nodes).map(n => n.label);
  assert.ok(!labels.includes('时间安排'), '旧 Heading 残留');
  assert.ok(!labels.includes('户外'), '旧 Tag 残留');
  assert.ok(labels.includes('新标签'), '新 Tag 缺失');
});
t('removeNode:节点与连带边删除,共享 Tag 保留', () => {
  global.localStorage.removeItem('ep_memory');
  const s = EP.memory.createStore('库', '');
  EP.memory.importFiles(s.id, [evFile('a.md', MD_A), evFile('b.md', '# B\n#共享\n详见 [[团建方案]]')]);
  let g = EP.memory.graphOf(s.id, { withProfile: false });
  const noteA = Object.values(g.nodes).find(n => n.type === 'Note' && n.label === '团建方案');
  EP.memory.removeNode(s.id, noteA.id);
  g = EP.memory.graphOf(s.id, { withProfile: false });
  assert.ok(!g.nodes[noteA.id], 'Note 未删除');
  const labels = Object.values(g.nodes).map(n => n.label);
  assert.ok(labels.includes('共享'), '被 B 引用的共享 Tag 被误删');
  assert.ok(!labels.includes('时间安排'), 'A 专属 Heading 未连带删除');
  assert.ok(!g.edges.some(e => e.source === noteA.id || e.target === noteA.id), '边未清理');
});
t('toCytoscape 适配层:输出 {elements:{nodes,edges}} 且 data 形状正确', () => {
  global.localStorage.removeItem('ep_memory');
  const s = EP.memory.createStore('库', '');
  EP.memory.importFiles(s.id, [evFile('a.md', MD_A)]);
  const cy = EP.memory.toCytoscape(EP.memory.graphOf(s.id, { withProfile: false }));
  assert.ok(cy.elements && Array.isArray(cy.elements.nodes) && Array.isArray(cy.elements.edges));
  cy.elements.nodes.forEach(n => assert.ok(n.data.id && n.data.label !== undefined, '节点 data 缺字段'));
  cy.elements.edges.forEach(e => assert.ok(e.data.source && e.data.target && e.data.id, '边 data 缺字段'));
});
t('节点上限保护:超限导入报可读错误', () => {
  global.localStorage.removeItem('ep_memory');
  const s = EP.memory.createStore('库', '');
  let big = '# 大文件\n';
  for (let i = 0; i < 3200; i++) big += '\n段落 #标签' + i;
  assert.throws(() => EP.memory.importFiles(s.id, [evFile('big.md', big)]), /超过上限|过多/);
});
t('graphOf(withProfile):档案条目实时呈现为 Preference 子图;remove 条目级删除', () => {
  global.localStorage.removeItem('ep_profile');
  global.localStorage.removeItem('ep_memory');
  EP.profile.record(evE1('星海科技', ''));
  EP.profile.record(evE1('星海科技', ''));
  const s = EP.memory.createStore('库', '');
  const g = EP.memory.graphOf(s.id, { withProfile: true });
  const pref = Object.values(g.nodes).filter(n => n.type === 'Preference');
  assert.ok(pref.some(n => n.label.includes('星海科技')), '偏好节点未出现');
  assert.ok(g.edges.some(e => e.type === 'PREFERS'), 'PREFERS 边缺失');
  /* 条目删除后子图即时收缩 */
  EP.profile.remove('companies', '星海科技');
  const g2 = EP.memory.graphOf(s.id, { withProfile: true });
  assert.ok(!Object.values(g2.nodes).some(n => n.label && n.label.includes('星海科技')), '删除后偏好节点仍在');
  const p = EP.profile.load();
  assert.ok(!p.facts.companies.some(c => c.value === '星海科技'), '档案未真正删除');
});

console.log('\n[11] 品味学习:过往方案导入 / 偏好确认闭环 / 两级注入');
t('intake.extractDocxText:STORE zip(word.js 产物)roundtrip 还原正文文本', async () => {
  const bytes = EP.word.build(PLAN());
  const text = await EP.intake.extractDocxText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.ok(text.includes('2026 秋季全员团建'), '标题丢失:' + text.slice(0, 120));
  assert.ok(text.includes('概述') && text.includes('签到集合'), '正文/列表项丢失');
  assert.ok(/\n/.test(text), '段落边界丢失');
});
t('intake.extractDocxText:DEFLATE(Word 实际产物)经 DecompressionStream 还原', async () => {
  const zlib = require('zlib');
  const enc = new TextEncoder();
  const xml = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>压缩段落一</w:t></w:r></w:p><w:p><w:r><w:t>压缩段落二</w:t></w:r></w:p></w:body></w:document>';
  const data = zlib.deflateRawSync(Buffer.from(enc.encode(xml)));
  /* 手工构造单条目 DEFLATE zip:local header + data + central + EOCD */
  const nameB = enc.encode('word/document.xml');
  const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4);
  head.writeUInt16LE(8, 8); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameB.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(30 + nameB.length + data.length, 16);
  const zip = Buffer.concat([head, nameB, data, cd, nameB, eocd]);
  const text = await EP.intake.extractDocxText(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength));
  assert.ok(text.includes('压缩段落一') && text.includes('压缩段落二'), 'DEFLATE 提取失败:' + text);
});
t('E6 past_plan_parsed:过往方案的规则与风格特征入档(归纳级,可注入)', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record({ t: 'past_plan_parsed', at: NOW0, data: { name: '2025年会', facts: [], preferences: [
    { kind: 'rule', value: '领导致辞不超过 10 分钟' },
    { kind: 'style', value: '时间表精确到 5 分钟粒度' },
    { kind: 'style', value: '章节短段落+列表为主' }
  ] } });
  const p = EP.profile.load();
  assert.strictEqual(p.facts.preferences.length, 3, '偏好未入档');
  assert.ok(p.facts.preferences.every(x => x.source === 'intake' && x.count === 1));
  const s = EP.profile.summarize(p, 'plan');
  assert.ok(s.includes('过往方案分析') && s.includes('致辞'), '导入偏好未进摘要:' + s);
});
t('B1 偏好确认闭环:特殊需求子句重复 3 次触发建议,确认后升级为严格级且不再建议', () => {
  global.localStorage.removeItem('ep_profile');
  const withNotes = () => evE1('星海科技', '') && ({ t: 'plan_generated', at: NOW0, data: { form: Object.assign(FORM(), { notes: '致辞不超过10分钟;户外要有雨天备案' }) } });
  EP.profile.record(withNotes());
  assert.strictEqual(EP.profile.pendingSuggestions().length, 0, '1 次即建议');
  EP.profile.record(withNotes());
  EP.profile.record(withNotes());
  let sug = EP.profile.pendingSuggestions();
  assert.ok(sug.some(x => x.value.includes('致辞不超过10分钟')), '重复 3 次未触发:' + JSON.stringify(sug));
  /* 确认 → 严格级注入,建议消失 */
  EP.profile.record({ t: 'preference_confirmed', at: NOW0, data: { value: '致辞不超过10分钟' } });
  sug = EP.profile.pendingSuggestions();
  assert.ok(!sug.some(x => x.value.includes('致辞')), '确认后仍建议');
  const p = EP.profile.load();
  const conf = p.facts.preferences.find(x => x.value === '致辞不超过10分钟');
  assert.ok(conf && conf.source === 'confirmed', '确认级未落档');
  const s = EP.profile.summarize(p, 'plan');
  assert.ok(s.indexOf('已确认偏好') >= 0 && s.includes('致辞不超过10分钟'), '确认偏好未进严格级:' + s);
  assert.ok(s.indexOf('已确认偏好') < s.indexOf('过往方案分析') || !s.includes('过往方案分析'), '严格级未排在参考级之前');
  /* 拒绝 → 冷却不再建议 */
  EP.profile.record({ t: 'preference_rejected', at: NOW0, data: { value: '户外要有雨天备案' } });
  assert.ok(!EP.profile.pendingSuggestions().some(x => x.value.includes('雨天')), '拒绝后仍建议');
});
t('两级注入:确认级(严格遵守)与归纳级(参考)分立呈现于整案 prompt', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record({ t: 'past_plan_parsed', at: NOW0, data: { name: '旧案', facts: [], preferences: [{ kind: 'style', value: '预算表按科目分组给占比' }] } });
  EP.profile.record({ t: 'preference_confirmed', at: NOW0, data: { value: '必有互动抽奖环节' } });
  const user = EP.ai.buildPlanMessages(FORM())[1].content;
  assert.ok(user.includes('严格遵守') && user.includes('必有互动抽奖环节'), '确认级缺失');
  assert.ok(user.includes('过往方案分析') && user.includes('占比'), '归纳级缺失');
  assert.ok(user.indexOf('必有互动抽奖') < user.indexOf('占比'), '确认级未排在归纳级前');
});
t('remove 支持 preferences 条目(图谱逐条删除通路)', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record({ t: 'preference_confirmed', at: NOW0, data: { value: '茶歇必备' } });
  assert.ok(EP.profile.remove('preferences', '茶歇必备'));
  assert.ok(!EP.profile.load().facts.preferences.length, '未删除');
});

console.log('\n[12] 记忆库四模块:cat 分类 / 部门 / 对话事件 / 迁移(docs/15 F3)');
t('旧档案迁移:载入即补 cat(style→style,rule→misc)与 departments 域', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.save({
    ver: 1,
    facts: { companies: [{ value: '腾讯', count: 2, firstSeen: 1, lastSeen: 1 }], venues: [], budgetTier: [], audiences: [],
      preferences: [{ value: '时间表精确到5分钟', kind: 'style', source: 'intake', count: 1, firstSeen: 1, lastSeen: 1 },
                    { value: '致辞≤10分钟', kind: 'rule', source: 'confirmed', count: 1, firstSeen: 1, lastSeen: 1 }] },
    style: {}, hotspots: [], defaults: {}, lastFormSig: '', events: []
  });
  const p = EP.profile.load();
  assert.strictEqual(p.ver, 2, '版本未升级');
  assert.ok(Array.isArray(p.facts.departments), 'departments 域缺失');
  const st = p.facts.preferences.find(x => x.kind === 'style');
  const rule = p.facts.preferences.find(x => x.kind === 'rule');
  assert.strictEqual(st.cat, 'style', 'style 偏好未归类');
  assert.strictEqual(rule.cat, 'misc', 'rule 偏好未归类');
});
t('past_plan_parsed:AI 分类落地 —— 部门条目与 cat 标注', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record({ t: 'past_plan_parsed', at: NOW0, data: { name: '旧案', facts: [
    { kind: 'company', value: '腾讯' },
    { kind: 'department', value: '行政部:活动负责人王五' }
  ], preferences: [
    { kind: 'rule', value: '致辞≤10分钟', cat: 'misc' },
    { kind: 'style', value: '预算按科目分组', cat: 'style' }
  ] } });
  const p = EP.profile.load();
  assert.ok(p.facts.departments.some(d => d.value.includes('行政部')), '部门条目未入档:' + JSON.stringify(p.facts.departments));
  assert.strictEqual(p.facts.preferences.find(x => x.value === '预算按科目分组').cat, 'style');
  /* I-5(用户裁定 a):部门信息只收集不注入 —— 表单没有部门字段,注入等于给 AI 提供编造素材(王五未必是本次活动负责人),
     违反「未给信息写待定、不编造」铁律;部门信息在记忆图谱中仍可见可管理 */
  assert.ok(!EP.profile.summarize(p, 'plan').includes('行政部'), '部门信息不得注入摘要(P1-1 原则)');
  assert.ok(!EP.profile.summarize(p, 'plan').includes('王五'), '部门人名不得泄漏进摘要');
  /* I-1:删除部门条目真实生效(此前 remove 白名单漏 departments,UI 谎报成功) */
  assert.ok(EP.profile.remove('departments', '行政部:活动负责人王五'), 'remove(departments) 未生效');
  assert.ok(!EP.profile.load().facts.departments.length, '部门条目未真正删除');
});
t('注入摘要:确认级按最近优先,截断落在分段边界(不产生半句)', () => {
  global.localStorage.removeItem('ep_profile');
  for (let i = 0; i < 4; i++) EP.profile.record({ t: 'preference_confirmed', at: NOW0 + i * 86400000, data: { value: '确认偏好' + i + '号占位文本稍长一点' } });
  const s = EP.profile.summarize(EP.profile.load(), 'plan');
  assert.ok(s.includes('确认偏好3号'), '最新确认的偏好反被挤出:' + s);
  assert.ok(!s.includes('确认偏好0号'), '最旧的应让位');
  /* 截断不切半段:每段以「;」为完整边界 */
  const seg = s.slice(0, 280);
  if (s.length >= 280) {
    const lastSemi = seg.lastIndexOf(';');
    assert.ok(lastSemi > 0, '截断未落在分段边界');
  }
});
t('chat_message:对话指令并入偏好检测管道,强意图词(以后/默认/记住)立即触发建议', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record({ t: 'chat_message', at: NOW0, data: { text: '致辞控制在十分钟以内' } });
  EP.profile.record({ t: 'chat_message', at: NOW0, data: { text: '致辞控制在十分钟以内' } });
  assert.strictEqual(EP.profile.pendingSuggestions().length, 0, '2 次即建议');
  EP.profile.record({ t: 'chat_message', at: NOW0, data: { text: '致辞控制在十分钟以内' } });
  assert.ok(EP.profile.pendingSuggestions().some(s => s.value.includes('致辞')), '对话重复 3 次未触发');
  /* 强意图:一句话直接触发 */
  EP.profile.record({ t: 'chat_message', at: NOW0, data: { text: '以后都默认下午两点半开场' } });
  assert.ok(EP.profile.pendingSuggestions().some(s => s.value.includes('两点半')), '强意图未立即触发');
});

console.log('\n[13] AI 深度思考流(docs/15 F1):SSE 解析 / 流式生成 / 非流式回落');
t('parseSSE:思考增量与正文增量分路,事件以空行分块,残包保留待续', () => {
  const r1 = EP.ai._sseParse('data: {"choices":[{"delta":{"reasoning_content":"用户要办"}}]}\n\ndata: {"choices":[{"delta":{"reasoning_content":"团建活动"}}]}\n\n');
  assert.strictEqual(r1.events.length, 2, '事件数:' + r1.events.length);
  assert.ok(r1.events.every(e => e.reasoning && !e.content), '思考增量被误判为正文');
  const r2 = EP.ai._sseParse('data: {"choices":[{"delta":{"content":"## 一、"}}]}\n\ndata: [DONE]\n\n');
  assert.ok(r2.events[0].content === '## 一、', '正文增量丢失');
  assert.ok(r2.done, '[DONE] 未识别');
  const r3 = EP.ai._sseParse('data: {"choices":[{"delta":{"co');
  assert.strictEqual(r3.events.length, 0, '半包被强行解析');
  assert.ok(r3.rest.startsWith('data:'), '残包未保留:' + JSON.stringify(r3.rest));
});
t('parseSSE:CRLF 行尾(Azure OpenAI 等网关实际发送)完整解析(I-2)', () => {
  const r = EP.ai._sseParse('data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"正文"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  assert.strictEqual(r.events.length, 2, 'CRLF 流事件数:' + r.events.length);
  assert.ok(r.events[0].reasoning === '思考' && r.events[1].content === '正文', 'CRLF 分路失败:' + JSON.stringify(r.events));
  assert.ok(r.done, 'CRLF 下 [DONE] 未识别');
});
t('parseSSE:混合块(思考+正文同 delta)与 [DONE] 识别', () => {
  const r = EP.ai._sseParse('data: {"choices":[{"delta":{"reasoning_content":"想","content":"绪"}}]}\n\ndata: [DONE]\n\n');
  assert.ok(r.events[0].reasoning === '想' && r.events[0].content === '绪', '同 delta 双路未拆:' + JSON.stringify(r.events));
  assert.ok(r.done, '[DONE] 未识别');
});
t('generatePlanStream:非流式整包回落(网关不支持 stream 时仍能产出全文)', async () => {
  global.localStorage.setItem('ep_ai', JSON.stringify({ baseURL: 'http://x', apiKey: 'k', model: 'm' }));
  const origFetch = global.fetch;
  const plan = { choices: [{ message: { content: '## 活动概述\n整包回落产出。' } }] };
  global.fetch = async () => new Response(JSON.stringify(plan), { status: 200 });
  try {
    const out = await EP.ai.generatePlanStream(FORM(), { effort: 'high' });
    assert.ok(out.includes('整包回落产出'), '回落产出异常:' + out.slice(0, 60));
    assert.ok(out.includes('## '), '章节结构丢失');
  } finally { global.fetch = origFetch; }
});

console.log('\n[14] AI 对话编辑(docs/15 F2):契约构建 / JSON 容错解析 / 章节定位');
t('buildChatMessages:含目录/目标章节现文/对话历史/活动信息/偏好摘要', () => {
  global.localStorage.removeItem('ep_profile');
  EP.profile.record({ t: 'preference_confirmed', at: NOW0, data: { value: '致辞≤10分钟' } });
  const plan = PLAN();
  const msgs = EP.ai.buildChatMessages(plan,
    [{ role: 'user', content: '上次说的致辞限制' }, { role: 'assistant', content: '好的,已遵守' }],
    '把流程表整体提前半小时', plan.sections[1].title);
  const sys = msgs[0].content, user = msgs[1].content;
  assert.ok(sys.includes('JSON'), '缺输出契约');
  assert.ok(user.includes('流程时间表'), '缺目标章节现文');
  assert.ok(user.includes('活动概述'), '缺目录');
  assert.ok(user.includes('上次说的致辞限制'), '缺对话历史');
  assert.ok(user.includes('星海科技'), '缺活动信息');
  assert.ok(user.includes('致辞≤10分钟'), '缺偏好摘要');
});
t('parseEditReply:JSON 容错(裸 JSON / 围栏包裹 / 无 edit 纯对话 / 坏 JSON 报错)', () => {
  const r1 = EP.ai.parseEditReply('{"reply":"已改好","edit":{"section":"流程时间表","md":"新内容"},"save_pref":null}');
  assert.strictEqual(r1.edit.section, '流程时间表');
  const r2 = EP.ai.parseEditReply('```json\n{"reply":"建议如下","edit":null}\n```');
  assert.ok(r2.reply === '建议如下' && !r2.edit);
  assert.throws(() => EP.ai.parseEditReply('这不是 JSON'), /无法解析/);
});

console.log('\n' + '='.repeat(52));
console.log('结果:(异步执行中,见下方汇总)');
run();
