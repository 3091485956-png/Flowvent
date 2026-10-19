/* ai.js — AI 生成层(OpenAI 兼容 /chat/completions)
   定位变更:AI 是方案的唯一生成来源(整案生成 / 章节重写 / 润色 / 扩写 / 选区改写),
   模板内容包已删除;仅查看、编辑、导出已有方案不依赖网络。
   API Key 只存本地 localStorage,代码零硬编码密钥。 */
window.EP = window.EP || {};
EP.ai = (function () {

  function normBase(url) {
    let u = (url || '').trim().replace(/\/+$/, '');
    u = u.replace(/\/chat\/completions$/i, '');
    return u;
  }
  function cfg() { return EP.store.getAI(); }
  function ready() { const c = cfg(); return !!(c.baseURL && c.apiKey && c.model); }

  async function chat(messages, opts) {
    const c = cfg();
    if (!c.baseURL || !c.apiKey || !c.model) throw new Error('尚未配置 AI 接口:请到「设置」填写接口地址、密钥与模型名');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 60000);
    let res;
    try {
      res = await fetch(normBase(c.baseURL) + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },
        body: JSON.stringify({ model: c.model, messages: messages, temperature: (opts && opts.temp) || 0.3 }),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      throw new Error('网络错误或接口地址不可达:' + (e.name === 'AbortError' ? '请求超时' : e.message));
    }
    clearTimeout(timer);
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.code)) || ''; } catch (e) { /* ignore */ }
      throw new Error('接口返回 ' + res.status + (detail ? ':' + String(detail).slice(0, 120) : ''));
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content || !content.trim()) throw new Error('接口返回内容为空,请检查模型名是否正确');
    return content.trim();
  }

  /* ── 表单 → 活动信息摘要(所有生成 prompt 共用的上下文) ── */
  function formBrief(form) {
    const S = EP.struct;
    const rows = [
      ['组织 / 公司', form.company],
      ['活动名称', form.name],
      ['活动类型', S.typeLabel(form.type)],
      ['活动目的 / 背景', form.purpose],
      ['活动日期', form.date],
      ['开始时间', form.startTime],
      ['活动时长', S.DUR_LABEL[form.duration] || form.duration],
      ['地点类型', S.VENUE_LABEL[form.venueType]],
      ['具体地点', form.venue],
      ['参与人数', form.headcount ? form.headcount + ' 人' : ''],
      ['面向人群', S.AUD_LABEL[form.audience]],
      ['预算总额', form.budgetTotal ? '¥' + Number(form.budgetTotal).toLocaleString() : ''],
      ['节日主题', form.festival],
      ['产品名称', form.product],
      ['特殊需求', form.notes]
    ].filter(function (r) { return r[1] !== undefined && r[1] !== null && String(r[1]).trim() !== ''; });
    return rows.map(function (r) { return r[0] + ':' + r[1]; }).join('\n');
  }

  /* ── 整案生成:一次对话产出整份策划文档 ── */
  const SYS_PLAN = '你是资深企业活动策划专家,为企业撰写正式的《活动策划方案》完整文档。输出要求:\n' +
    '1.全文为 Markdown,由若干个以「## 」开头的章节组成(8~12 个),文档中不得出现「## 」以外的任何一级标题或「### 」标题;\n' +
    '2.章节结构建议覆盖:活动概述、流程时间表、环节详细设计、人员分工、物料清单、预算明细、宣传文案、主持词、安全预案、复盘清单——可按活动性质增删合并,标题自拟、专业达意;\n' +
    '3.章节内可使用:「#### 」小节标题、普通段落、「- 」无序列表、「1. 」有序列表、竖线管道表格、「> 」引用;\n' +
    '4.流程时间表、人员分工、物料清单、预算明细必须使用表格;时间表从给定开始时间排起,按活动时长排满;\n' +
    '5.预算明细需与给定预算总额一致并在末行给出合计;未给定预算时按人数规模给出建议明细并标注「建议」;\n' +
    '6.只能使用下方活动信息中给定的事实;未提供的信息一律写「待定」,不得编造人名、地名、品牌与金额;\n' +
    '7.全文中文,正式商务文书风格,内容专业、可落地执行;\n' +
    '8.直接输出文档正文,不要任何解释、开场白或代码块包裹。';

  /* ── 档案注入(「越用越懂用户」):仅供参考的追加段,无档案时 prompt 与既往逐字节一致。
        V1.1(docs/16):优先取 EP.wiki 编译页面;wiki 无页面/异常时回退统计档案(零回归);
        form 供相关性排序(与本次活动更相关的记忆页面优先注入) ── */
  function memBlock(kind, form) {
    try {
      if (EP.wiki) return EP.wiki.assemble(kind, { form: form }) || '';
      return (EP.profile && EP.profile.summarize(EP.profile.load(), kind)) || '';
    } catch (e) { return ''; }
  }

  function buildPlanMessages(form, noMemory) {
    const user = '活动信息如下:\n' + formBrief(form);
    const mem = noMemory ? '' : memBlock('plan', form);   // V1.2 F4:勾选「本次不参考记忆」时与无档案用户逐字节一致
    return [
      { role: 'system', content: SYS_PLAN },
      { role: 'user', content: mem ? user + '\n\n记忆库(该用户的历史使用观察,仅供参考;与上述活动信息冲突时,一律以活动信息为准):\n' + mem : user }
    ];
  }

  async function generatePlan(form) {
    return chat(buildPlanMessages(form), { temp: 0.5, timeout: 240000 });
  }

  /* ── 深度思考流(docs/15 F1):SSE 流式生成,思考增量(reasoning_content)与正文增量分路 ──
     parseSSE 纯函数:输入累积缓冲,输出 {events:[{reasoning,content}], done, rest(残包保留)} */
  function parseSSE(buffer) {
    const events = []; let done = false; let rest = '';
    /* SSE 规范允许 \r\n 行尾(Azure OpenAI 等网关实际发送),先归一化再按空行分块 */
    const blocks = String(buffer).replace(/\r\n/g, '\n').split('\n\n');
    rest = blocks.pop() || '';                       // 最后一段可能不完整,保留待续
    blocks.forEach(function (block) {
      const datas = block.split('\n').filter(function (l) { return l.indexOf('data:') === 0; })
        .map(function (l) { return l.slice(5).trim(); });
      if (!datas.length) return;
      if (datas.join('') === '[DONE]') { done = true; return; }
      try {
        const j = JSON.parse(datas.join(''));
        const d = j.choices && j.choices[0] && (j.choices[0].delta || j.choices[0].message) || {};
        if (d.reasoning_content || d.content) events.push({ reasoning: d.reasoning_content || '', content: d.content || '' });
      } catch (e) { /* 非 JSON 块忽略 */ }
    });
    return { events: events, done: done, rest: rest };
  }

  async function generatePlanStream(form, opts) {
    const c = cfg();
    if (!c.baseURL || !c.apiKey || !c.model) throw new Error('尚未配置 AI 接口:请到「设置」填写接口地址、密钥与模型名');
    const o = opts || {};
    const base = { model: c.model, messages: buildPlanMessages(form, !!o.noMemory), temperature: 0.5, stream: true };
    const callWith = async function (extra) {
      const ctrl = new AbortController();
      /* 连接阶段超时:响应头迟迟不达时 fetch 可挂起约 5 分钟(闸门锁死且无取消),60 秒即断 */
      const connectTimer = setTimeout(function () { ctrl.abort(); }, 60000);
      try {
        const res = await fetch(normBase(c.baseURL) + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },
          body: JSON.stringify(Object.assign({}, base, extra)), signal: ctrl.signal
        });
        return { res: res, ctrl: ctrl };
      } finally { clearTimeout(connectTimer); }
    };
    let r;
    try { r = await callWith({ reasoning_effort: o.effort || 'high' }); }
    catch (e) { throw new Error('网络错误或接口地址不可达:' + (e.name === 'AbortError' ? '请求超时' : e.message)); }
    /* 部分接口不认 reasoning_effort:去掉参数重试一次 */
    if (r.res.status === 400) {
      try { r = await callWith({}); } catch (e) { throw new Error('网络错误:' + e.message); }
    }
    if (!r.res.ok) {
      let detail = '';
      try { const j = await r.res.json(); detail = (j.error && (j.error.message || j.error.code)) || ''; } catch (e) { /* ignore */ }
      throw new Error('接口返回 ' + r.res.status + (detail ? ':' + String(detail).slice(0, 120) : ''));
    }
    /* 无流式 body(网关聚合):整包回落 */
    if (!r.res.body || typeof r.res.body.getReader !== 'function') {
      const data = await r.res.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content || !content.trim()) throw new Error('接口返回内容为空');
      return content.trim();
    }
    const reader = r.res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    /* 空转超时:30 秒无任何 token 判死(有 token 即续期);总时长上限仍 4 分钟 */
    let lastToken = Date.now();
    const started = Date.now();
    const guard = setInterval(function () {
      if (Date.now() - lastToken > 30000 || Date.now() - started > 240000) r.ctrl.abort();
    }, 2000);
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        lastToken = Date.now();
        const parsed = parseSSE(buf + dec.decode(chunk.value, { stream: true }));
        buf = parsed.rest;
        parsed.events.forEach(function (ev) {
          if (ev.reasoning && o.onThinking) o.onThinking(ev.reasoning);
          if (ev.content) { full += ev.content; if (o.onDelta) o.onDelta(full); }
        });
        if (parsed.done) break;
      }
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? (full ? '生成中断(网络空闲超时)' : '生成超时:接口长时间无响应') : ('网络错误:' + e.message));
    } finally { clearInterval(guard); try { reader.releaseLock(); } catch (e) { /* ignore */ } }
    /* 流式无产出(非 SSE 网关):尝试按整包 JSON 解析 */
    if (!full.trim()) {
      const tail = (buf + dec.decode()).trim();
      try {
        const j = JSON.parse(tail);
        const content = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (content && content.trim()) return content.trim();
      } catch (e) { /* fallthrough */ }
      throw new Error('接口未返回流式内容(可能不支持 stream),请重试或更换模型');
    }
    return full.trim();
  }

  /* ── 章节级重写:输出仅该章节正文(不含「## 」标题行) ── */
  function buildRegenMessages(form, outline, title, md) {
    const sys = '你是资深企业活动策划专家。现有一份《活动策划方案》文档,需要重写其中的「' + title +
      '」章节。要求:1.风格与信息口径与原文档一致,只依据给定的活动信息,不编造事实;2.直接输出该章节的正文(Markdown,可用「#### 」小节、列表、表格、引用),不要以「## 」标题开头,不要解释;';
    const user = '活动信息:\n' + formBrief(form) + '\n\n文档章节目录:\n' + outline +
      '\n\n「' + title + '」章节现内容(供参考,重写时可调整组织方式):\n' + (md || '(空)');
    const mem = memBlock('section', form);   // regen 可调整组织方式,保留结构向偏好;polish/expand 用 polish 变体
    return [
      { role: 'system', content: sys },
      { role: 'user', content: mem ? '用户偏好摘要(仅供参考):\n' + mem + '\n\n' + user : user }
    ];
  }
  async function regenSection(form, outline, title, md) {
    return chat(buildRegenMessages(form, outline, title, md), { temp: 0.55, timeout: 120000 });
  }

  const SYS = {
    polish: function (title) {
      return '你是企业活动策划文案专家。请润色下面这份活动方案中的「' + title +
        '」章节(Markdown 格式)。严格要求:1.保持所有标题、表格结构、列表层级完全不变,不得增删表格行列;2.只优化行文、用词与语气,使其更专业、更符合企业正式文书风格;3.不得编造任何原文没有的事实(时间、地点、金额、人名);4.直接输出润色后的完整 Markdown,不要任何解释或代码块包裹。';
    },
    expand: function (title) {
      return '你是企业活动策划专家。请在保持结构与表格完全不变的前提下,为下面这份活动方案的「' + title +
        '」章节补充执行细节(如操作要点、注意事项、话术示例)。严格要求:1.不新增一级标题,不改变任何现有标题文字与表格行列;2.补充内容必须通用可执行,不得编造具体人名、地名、品牌与金额;3.直接输出补全后的完整 Markdown,不要任何解释或代码块包裹。';
    }
  };

  const SYS_TEXT = {
    polish: '你是企业文书润色专家。请润色下面这段文字:保持原意与长度基本不变,只优化文风、用词与通顺度,使其更专业。直接输出润色后的文字,不要任何解释、引号或换行修饰。',
    expand: '你是企业活动策划专家。请在保持原意的前提下,为下面这段文字补充一到两句可执行的细节。直接输出扩写后的完整文字,不要解释或引号。',
    rewrite: '你是企业文书专家。请换一种更专业、更有表现力的写法重写下面这段文字,保持原意与长度相当。直接输出重写后的文字,不要解释或引号。',
    /* V1.2 F1:自定义指令(op='custom' 时 instruction 必填,是唯一任务来源) */
    custom: '你是企业文书编辑专家。请按用户给出的要求修改下面的文字:只做要求范围内的修改,保持其余内容与原意不变;要求未提及的信息不得编造。直接输出修改后的完整文字,不要解释或引号。'
  };

  /* 选区文字操作的 prompt 构建(纯函数,node 可测;V1.2 F1:支持用户意图 instruction) */
  function buildTextMessages(op, text, instruction) {
    const sys = SYS_TEXT[op] || SYS_TEXT.custom;
    const req = String(instruction || '').trim().slice(0, 200);
    const user = req ? String(text) + '\n\n用户对这段文字的要求:' + req : String(text);
    return [{ role: 'system', content: sys }, { role: 'user', content: user }];
  }

  /* ── 导入文件解析(docs/14/15 + V1.2 F9 分类型):策划案 / 公司制度·部门资料 两套契约 ── */
  const SYS_PARSE = {
    plan: '你是企业活动策划分析师。分析下面这份过往活动策划方案,提取其中明确体现的组织事实与策划偏好,并归入四个记忆模块之一。只输出 JSON 对象(不要解释、不要代码块包裹):{"facts":[{"kind":"company|venue|audience|department","value":"组织名/场地名/人群/部门信息(如:行政部:活动负责人王五)"}],"preferences":[{"kind":"rule|style","cat":"company|department|style|misc","value":"偏好内容"}]}。cat 为记忆模块:company=公司级事实(组织/场地/人群/预算习惯),department=与某部门相关的信息,style=策划案排版与文风特征,misc=其他用户偏好。要求:1.只提取文中明确体现的,不得推测;2.facts 至多 4 条,preferences 至多 8 条;3.value 为简短中文短语。',
    org: '你是企业管理制度分析员。分析下面这份公司制度/部门资料/品牌规范类文件,提取组织事实与长期有效的规范口径,供活动策划参考。只输出 JSON 对象(不要解释、不要代码块包裹):{"facts":[{"kind":"company|venue|audience|department","value":"组织名/部门职责/场地/人群信息(如:行政部:负责全司活动统筹)"}],"preferences":[{"kind":"rule|style","cat":"company|department|style|misc","value":"品牌口径/流程规则/注意事项(如:对外文案必须用公司全称)"}]}。cat 为记忆模块:company=公司级事实,department=部门信息,style=文书风格规范,misc=其他规则。要求:1.只提取文中明确写明的,不得推测;2.facts 至多 6 条,preferences 至多 10 条;3.value 为简短中文短语;4.临时性、带明确期限的内容不提取。'
  };
  function buildParseMessages(text, kind) {
    const sys = kind === 'org' ? SYS_PARSE.org : SYS_PARSE.plan;
    return [{ role: 'system', content: sys },
      { role: 'user', content: String(text || '').slice(0, 8000) }];
  }
  async function parsePastPlan(text, kind) {
    const raw = await chat(buildParseMessages(text, kind), { temp: 0.2, timeout: 120000 });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI 返回的内容无法解析为结构化偏好,请重试');
    let j;
    try { j = JSON.parse(m[0]); } catch (e) { throw new Error('AI 返回的 JSON 格式异常,请重试'); }
    const cap = kind === 'org' ? [6, 10] : [4, 8];
    return {
      facts: (j.facts || []).filter(function (x) { return x && x.value; }).slice(0, cap[0]),
      preferences: (j.preferences || []).filter(function (x) { return x && x.value; }).slice(0, cap[1])
    };
  }

  /* ── 编辑对归纳(docs/14 T2,PRELUDE 式):AI 初稿 vs 用户终稿 → 偏好描述 ── */
  const SYS_INDUCE = '你是策划文案风格分析师。下面是同一章节的「AI 初稿」与「用户终稿」对照样本。从中归纳该用户稳定反复体现的排版与文风偏好(单一样本中的偶然差异不算)。只输出 JSON(不要解释):{"preferences":[{"kind":"style","cat":"style","value":"偏好描述,如:段落控制在两行以内"}]}。cat 固定为 style(排版与文风);至多 5 条,只归纳多份样本共有的模式;没有稳定模式则输出空数组。';
  async function inducePrefs(pairs) {
    const body = (pairs || []).map(function (p, i) {
      return '【样本' + (i + 1) + '】AI 初稿:\n' + String(p.prev || '').slice(0, 500) + '\n用户终稿:\n' + String(p.next || '').slice(0, 500);
    }).join('\n\n');
    const raw = await chat([{ role: 'system', content: SYS_INDUCE }, { role: 'user', content: body }], { temp: 0.2, timeout: 120000 });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('归纳结果无法解析,请重试');
    const j = JSON.parse(m[0]);
    return (j.preferences || []).filter(function (x) { return x && x.value; }).slice(0, 5);
  }

  /* ── 记忆库 Wiki 编译(docs/16,llm_wiki Two-Step CoT 思想):
        第一步分析(实体/偏好/与现有页面的矛盾),第二步依据分析产出页面补丁。
        JSON 契约容错解析与 parseEditReply 同风格;页面补丁的最终校验在 wiki.applyPatch ── */
  const SYS_WIKI_ANALYZE = '你是用户记忆库的编译分析器。输入为用户使用事件批次与记忆库现有页面,第一步只做分析、不产出页面。只输出 JSON 对象(不要解释、不要代码块包裹):{"notes":["从事件中可提取的组织事实或偏好观察,每条一句"],"contradictions":[{"title":"冲突的现有页面标题","issue":"与新事件的矛盾点"}],"plan":"一句话页面更新计划"}。要求:1.只依据事件中明确出现的信息,不得推测;2.矛盾指现有页面与新事件对同一事实表述不一致;3.notes 至多 10 条;4.注意区分「单次活动信息」与「长期习惯」——具体日期、地点、人数、预算金额属于单次方案,不构成记忆,notes 中不得提取。';
  const SYS_WIKI_WRITE = '你是用户记忆库的写入器。依据分析与事件批次产出记忆页面补丁。只输出 JSON 对象(不要解释、不要代码块包裹):{"pages":[{"action":"upsert 或 delete","title":"页面标题(20 字内;实体用名称本身,偏好用要求原文)","kind":"entity 或 preference","cat":"company|department|style|misc","sub":"entity 细分:company|venue|budget|audience|duration|department,偏好留空","desc":"一句话检索描述,20 字内,用于判断与活动的相关性","body":"一句观察,只陈述观察不下结论,如:在 3 次活动中担任组织方","links":["其他页面标题,仅可引用现有页面或本批新增页面"],"level":"inductive(默认)或 confirmed(仅当事件中存在 preference_confirmed 支撑时)","confidence":0到1的小数}],"reviews":[{"title":"涉及页面标题","issue":"矛盾或需用户判断的事项","suggestion":"建议动作"}]}。铁律:1.不得编造事件中没有的事实(人名、金额、品牌、地点);2.页面只记观察,不写结论或建议;3.links 不得引用不存在的页面;4.至多 upsert 8 页、delete 2 页、reviews 3 条;没有值得记录的内容时对应数组留空;5.confirmed 偏好页 body 尽量带「原因:」与「适用:」说明(事件中有用户原话时引用);6.不建「活动本身」的页面:具体日期、地点、人数、预算金额是单次方案信息而非用户习惯,即使出现多次也只在达到长期模式时才记(如「常于周末办活动」可记,「1 月 20 日办年会」不记);6.只出现一次的偶发行为不记;7.能从活动信息表单直接推导的不重复记。';

  function wikiBatchDigest(batch) {
    return (batch || []).map(function (e) {
      let d = '';
      try { d = JSON.stringify(e.d); } catch (err) { d = '(不可序列化)'; }
      return '#' + e.seq + ' [' + e.t + '] ' + d;
    }).join('\n');
  }
  function buildWikiAnalyzeMessages(batch, pages, tombstones) {
    const pageLines = (pages || []).map(function (p) {
      return '- ' + p.title + '(' + p.kind + '/' + p.cat + '/' + p.level + '):' + p.body;
    }).join('\n') || '(空)';
    return [{ role: 'system', content: SYS_WIKI_ANALYZE },
      { role: 'user', content: '事件批次(按时间序):\n' + wikiBatchDigest(batch) +
        '\n\n现有页面:\n' + pageLines +
        ((tombstones || []).length ? '\n\n以下页面 key 已被用户删除,禁止重建同内容:' + tombstones.join(',') : '') }];
  }
  function buildWikiWriteMessages(analysis, batch, pages) {
    return [{ role: 'system', content: SYS_WIKI_WRITE },
      { role: 'user', content: '分析结果(JSON):\n' + JSON.stringify(analysis) +
        '\n\n事件批次:\n' + wikiBatchDigest(batch) +
        '\n\n现有页面标题(links 仅可引用这些或本批新增):\n' + ((pages || []).map(function (p) { return p.title; }).join('\n') || '(空)') }];
  }
  function extractJson(raw) {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI 返回无法解析为 JSON,请重试');
    try { return JSON.parse(m[0]); } catch (e) { throw new Error('AI 返回的 JSON 格式异常,请重试'); }
  }
  function parseWikiPatch(raw) {
    const j = extractJson(raw);
    return {
      pages: (j.pages || []).filter(function (x) { return x && x.title; }).map(function (x) {
        return {
          action: x.action === 'delete' ? 'delete' : 'upsert',
          title: String(x.title), kind: x.kind === 'entity' ? 'entity' : 'preference',
          cat: x.cat, sub: x.sub || '', desc: String(x.desc || ''), body: String(x.body || ''),
          links: Array.isArray(x.links) ? x.links.map(String) : [],
          level: x.level === 'confirmed' ? 'confirmed' : 'inductive',
          confidence: x.confidence
        };
      }),
      reviews: (j.reviews || []).filter(function (x) { return x && (x.issue || x.title); })
    };
  }
  async function compileWiki(batch, pages, tombstones) {
    const aRaw = await chat(buildWikiAnalyzeMessages(batch, pages, tombstones), { temp: 0.2, timeout: 120000 });
    const analysis = extractJson(aRaw);
    const wRaw = await chat(buildWikiWriteMessages(analysis, batch, pages), { temp: 0.2, timeout: 120000 });
    return { analysis: analysis, patch: parseWikiPatch(wRaw) };
  }

  /* ── 记忆库精灵(docs/18 F10,V1.2):自然语言管记忆;动作先卡后落,应用前不落库 ── */
  const SYS_BUTLER = '你是记忆库管理精灵,帮用户用一句话维护自己的记忆库。输入为用户指令、记忆页面清单(标题/描述/类别/级别)、相关页面全文、待确认矛盾清单。只输出 JSON 对象(不要解释、不要代码块包裹):{"reply":"给用户的简短说明(40 字内)","actions":[{"type":"update|delete|merge|resolve","key":"目标页面 key(必须取自清单)","key2":"merge 时被并入的另一页 key","title":"update 改名时的新标题(可选)","body":"update 时的新正文全文(必填;只做用户要求范围内的修改,不得编造用户没有提供的信息)"}]}。resolve 用于处理待确认矛盾(此时 key 填矛盾 id)。规则:1.只能操作清单中存在的页面/矛盾;2.不得改变页面的确认/归纳级别(升级确认只能由用户显式操作);3.每次至多 6 个动作;4.没有需要的动作时 actions 留空并在 reply 说明;5.merge 时 key 保留、key2 被并入后删除。';
  function buildButlerMessages(instruction, manifest, fulls, reviews) {
    const NL = '\n';
    const man = (manifest || []).map(function (m) {
      return '- ' + m.key + ' | ' + m.title + '(' + m.cat + '/' + m.level + ')' + (m.desc ? ':' + m.desc : '');
    }).join(NL) || '(空)';
    const full = (fulls || []).map(function (f) {
      return '【' + f.title + '】key=' + f.key + NL + NL + f.body;
    }).join(NL + NL) || '(无)';
    const rev = (reviews || []).map(function (r) {
      return '- 矛盾id ' + r.id + ':「' + r.title + '」' + r.issue;
    }).join(NL) || '(无)';
    return [{ role: 'system', content: SYS_BUTLER },
      { role: 'user', content: '用户指令:' + String(instruction || '').slice(0, 300) +
        NL + NL + '记忆页面清单:' + NL + man +
        NL + NL + '相关页面全文:' + NL + full +
        NL + NL + '待确认矛盾:' + NL + rev }];
  }
  function parseButlerReply(raw) {
    const j = extractJson(raw);
    return {
      reply: String(j.reply || ''),
      actions: (j.actions || []).filter(function (x) { return x && x.key && x.type; }).slice(0, 6).map(function (x) {
        return { type: x.type, key: String(x.key), key2: x.key2 ? String(x.key2) : '',
                 title: x.title ? String(x.title).slice(0, 40) : '', body: x.body ? String(x.body) : '' };
      })
    };
  }
  async function butlerChat(instruction, manifest, fulls, reviews) {
    const raw = await chat(buildButlerMessages(instruction, manifest, fulls, reviews), { temp: 0.2, timeout: 120000 });
    return parseButlerReply(raw);
  }

  /* ── AI 对话编辑(docs/15 F2):对话式修改方案,JSON 契约(reply+edit+save_pref) ── */
  const SYS_CHAT = '你是活动策划方案的 AI 编辑助手,用户以对话方式要求你修改他的方案。只输出 JSON 对象(不要解释、不要代码块包裹):{"reply":"给用户的简短说明(做了什么/建议,50 字内)","edit":{"section":"要修改的章节标题(必须与目录中的标题一致)","md":"修改后的该章节完整正文 Markdown,可用 #### 小节/列表/表格/引用,不要 ## 标题行"},"save_pref":"当用户的话里表达了长期通用偏好(如『以后都…』)时,提取该偏好原文;否则为 null"}。规则:1.edit 仅在用户确实要求修改内容时给出,纯咨询/确认类对话 edit 为 null;2.只依据活动信息与用户要求修改,未提及的信息保持原文,不编造;3.md 必须是完整章节(不是片段补丁)。';
  function buildChatMessages(plan, history, userMsg, targetTitle) {
    const outline = (plan.sections || []).map(function (s, i) {
      return (EP.struct.CN[i] || i + 1) + '、' + s.title;
    }).join('\n');
    const target = (plan.sections || []).find(function (s) { return s.title === targetTitle; }) ||
      (plan.sections || [])[0] || { title: '(无)', md: '' };
    const hist = (history || []).slice(-6).map(function (m) {
      return m.role + ':' + m.content;
    }).join('\n');
    const user = '活动信息:\n' + formBrief(plan.form) +
      '\n\n文档章节目录:\n' + outline +
      '\n\n当前聚焦章节「' + target.title + '」现内容:\n' + (target.md || '(空)') +
      (hist ? '\n\n最近对话:\n' + hist : '') +
      (memBlock('section') ? '\n\n用户偏好摘要(仅供参考):\n' + memBlock('section') : '') +
      '\n\n用户要求:' + userMsg;
    return [{ role: 'system', content: SYS_CHAT }, { role: 'user', content: user }];
  }
  function parseEditReply(raw) {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI 返回无法解析,请重试');
    let j;
    try { j = JSON.parse(m[0]); } catch (e) { throw new Error('AI 返回的 JSON 格式异常,请重试'); }
    return {
      reply: String(j.reply || ''),
      edit: (j.edit && j.edit.section && j.edit.md) ? { section: String(j.edit.section), md: String(j.edit.md) } : null,
      save_pref: j.save_pref ? String(j.save_pref) : null
    };
  }
  async function chatEdit(plan, history, userMsg, targetTitle) {
    const raw = await chat(buildChatMessages(plan, history, userMsg, targetTitle), { temp: 0.4, timeout: 120000 });
    return parseEditReply(raw);
  }

  return {
    buildChatMessages: buildChatMessages,
    parseEditReply: parseEditReply,
    chatEdit: chatEdit,
    buildWikiAnalyzeMessages: buildWikiAnalyzeMessages,
    buildWikiWriteMessages: buildWikiWriteMessages,
    parseWikiPatch: parseWikiPatch,
    buildButlerMessages: buildButlerMessages,
    parseButlerReply: parseButlerReply, butlerChat: butlerChat,
    compileWiki: compileWiki,
    ready: ready,
    config: cfg,
    formBrief: formBrief,
    buildPlanMessages: buildPlanMessages,
    buildRegenMessages: buildRegenMessages,
    generatePlan: generatePlan,
    regenSection: regenSection,
    generatePlanStream: generatePlanStream,
    _sseParse: parseSSE,
    parsePastPlan: parsePastPlan,
    buildParseMessages: buildParseMessages,
    inducePrefs: inducePrefs,
    /* 选区级文字操作(右键菜单 → V1.2 F1 对话框):polish/expand/rewrite/custom + instruction 意图 */
    buildTextMessages: buildTextMessages,
    async textOp(op, text, instruction) {
      if (op === 'custom' && !String(instruction || '').trim()) throw new Error('请先填写你的修改要求');
      return chat(buildTextMessages(op, text, instruction), { temp: 0.4 });
    },
    async polish(title, md) {
      const mem = memBlock('polish');
      return chat([{ role: 'system', content: SYS.polish(title) },
                   { role: 'user', content: mem ? '用户偏好摘要(仅供参考):\n' + mem + '\n\n' + md : md }], { temp: 0.3 });
    },
    async expand(title, md) {
      const mem = memBlock('polish');
      return chat([{ role: 'system', content: SYS.expand(title) },
                   { role: 'user', content: mem ? '用户偏好摘要(仅供参考):\n' + mem + '\n\n' + md : md }], { temp: 0.4 });
    },
    async test() {
      const c = cfg();
      if (!c.baseURL) return { ok: false, msg: '请先填写接口地址' };
      try {
        const res = await fetch(normBase(c.baseURL) + '/models', {
          headers: { 'Authorization': 'Bearer ' + c.apiKey }, signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
        });
        if (res.ok) return { ok: true, msg: '连接成功,接口可用' };
        if (res.status === 404 || res.status === 405) {          // 部分网关不支持 /models,用最小对话再试
          await chat([{ role: 'user', content: 'ping' }], { temp: 0 });
          return { ok: true, msg: '连接成功(对话接口可用)' };
        }
        return { ok: false, msg: '接口返回 ' + res.status + ',请检查地址与密钥' };
      } catch (e) {
        return { ok: false, msg: '连接失败:' + (e.message || e) };
      }
    }
  };
})();
