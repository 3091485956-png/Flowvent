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

  /* ── 档案注入(「越用越懂用户」):仅供参考的追加段,无档案时 prompt 与既往逐字节一致 ── */
  function memBlock(kind) {
    try { return (EP.profile && EP.profile.summarize(EP.profile.load(), kind)) || ''; }
    catch (e) { return ''; }
  }

  function buildPlanMessages(form) {
    const user = '活动信息如下:\n' + formBrief(form);
    const mem = memBlock('plan');
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
    const base = { model: c.model, messages: buildPlanMessages(form), temperature: 0.5, stream: true };
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
    const mem = memBlock('section');   // regen 可调整组织方式,保留结构向偏好;polish/expand 用 polish 变体
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
    rewrite: '你是企业文书专家。请换一种更专业、更有表现力的写法重写下面这段文字,保持原意与长度相当。直接输出重写后的文字,不要解释或引号。'
  };

  /* ── 过往方案解析(docs/14/15):文本 → 结构化并分类的偏好(严格 JSON 契约) ── */
  const SYS_PARSE = '你是企业活动策划分析师。分析下面这份过往活动策划方案,提取其中明确体现的组织事实与策划偏好,并归入四个记忆模块之一。只输出 JSON 对象(不要解释、不要代码块包裹):{"facts":[{"kind":"company|venue|audience|department","value":"组织名/场地名/人群/部门信息(如:行政部:活动负责人王五)"}],"preferences":[{"kind":"rule|style","cat":"company|department|style|misc","value":"偏好内容"}]}。cat 为记忆模块:company=公司级事实(组织/场地/人群/预算习惯),department=与某部门相关的信息,style=策划案排版与文风特征,misc=其他用户偏好。要求:1.只提取文中明确体现的,不得推测;2.facts 至多 4 条,preferences 至多 8 条;3.value 为简短中文短语。';
  async function parsePastPlan(text) {
    const raw = await chat([{ role: 'system', content: SYS_PARSE },
      { role: 'user', content: String(text || '').slice(0, 8000) }], { temp: 0.2, timeout: 120000 });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI 返回的内容无法解析为结构化偏好,请重试');
    let j;
    try { j = JSON.parse(m[0]); } catch (e) { throw new Error('AI 返回的 JSON 格式异常,请重试'); }
    return {
      facts: (j.facts || []).filter(function (x) { return x && x.value; }).slice(0, 4),
      preferences: (j.preferences || []).filter(function (x) { return x && x.value; }).slice(0, 8)
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
    inducePrefs: inducePrefs,
    /* 选区级文字操作(右键菜单):polish / expand / rewrite,输入输出均为纯文本 */
    async textOp(op, text) {
      return chat([{ role: 'system', content: SYS_TEXT[op] },
                   { role: 'user', content: text }], { temp: 0.4 });
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
