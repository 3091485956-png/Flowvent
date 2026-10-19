# 16 · 记忆库 Wiki 化重构(V1.1)

> 2026-10-19 · 依据 [nashsu/LLM-Wiki](https://github.com/nashsu/llm_wiki)(对 Karpathy LLM-wiki 设计模式的完整实现)重构记忆系统
> 范式借鉴、零代码复制(该库 GPL-3.0,本项目不引入其任何代码,无许可传染)
> 核心理念:**「知识被一次编译、持续维护,而不是每次查询重新推导」**——取代 V1.0 的「计数器 + 时间衰减、每次注入时重新计算」统计档案

---

## 一、为什么重构

V1.0 记忆系统(`profile.js`,docs/12~15)的形态是**统计档案**:五类事件 → 确定性计数 → 每次生成时 `summarize()` 现算 280 字摘要。它可靠、可解释、零网络依赖,但有三个天花板:

1. **记不住叙事**:「我们年会传统是领导开场表演」这类事实,计数器表达不了
2. **无交叉关联**:公司与部门、偏好与场地之间没有链接,图谱只是档案的平面投影
3. **无矛盾感知**:新事件与既有认知冲突时,统计档案只会双双计数,不会浮出水面让人裁决

llm_wiki 的解法是三层结构(Raw Sources / Wiki / Schema)+ 三操作(Ingest / Query / Lint):
知识被**编译**成持久化、互链、可溯源的页面,增量维护,矛盾进入 Review 队列由人裁决。

## 二、三层映射(范式 → 秒策)

| llm_wiki 概念 | 秒策 V1.1 实现 | 载体 |
| --- | --- | --- |
| Raw Sources(不可变原始层) | 带全量 payload 的原始事件日志,seq 单调递增,字段深截断 400 字,环形缓冲 200 条 | `ep_profile.rawLog`(profile.js 追加,`record()` 单一入口不变) |
| Wiki(编译页面) | 记忆页面:实体页(公司/部门/场地/人群/时长)+ 偏好页(文风/规则),`links` 互链、`sources` 溯源到 seq、两级 level | `ep_wiki.pages`(新键,新模块 wiki.js) |
| Schema(规则) | 页面类型/cat 四模块契约 + 编译 prompt 铁律(不编造/只记观察/confirmed 需事件支撑) | wiki.js 常量 + ai.js `SYS_WIKI_ANALYZE` / `SYS_WIKI_WRITE` |
| index.md / log.md | 页面集合 + 编译日志(面板状态行可见:页数/四模块分布/上次编译时间与模式) | `ep_wiki.compileLog`(上限 20 条) |
| purpose.md | 以 Schema 常量承载(防漂移铁律文本),暂不做用户可编辑 | — |

页面模型:`{ key(kind:hash), title≤40, kind: entity|preference, cat: company|department|style|misc, sub, body≤240(观察句), links[], sources[](seq), level: confirmed|inductive, confidence, hits, det, createdAt, updatedAt }`,上限 80 页(逐出规则:非 confirmed 优先 → 低置信 → 旧页;confirmed 永不自动逐出)。

## 三、三操作

### Ingest · compile(两步 CoT + 确定性兜底)
- **触发**:整案生成完成后(静默、失败自动回落本地)、记忆面板打开时积压 ≥6 条(静默)、面板「编译记忆」按钮(手动,force:失败如实报错)
- **AI 路径**(`ai.js compileWiki`):第一步分析(实体/偏好/**与现有页面的矛盾**/更新计划,JSON)→ 第二步依分析产出页面补丁(upsert/delete + reviews),温度 0.2、超时 120s
- **本地路径**(`wiki.js localCompile`):档案统计确定性映射为页面(`det:true` 标记,AI 页面保留合入);无 AI 配置时行为等价 V1.0
- **补丁校验**(`applyPatch`):tombstone 页拒绝复活;`confirmed` 级必须有 `preference_confirmed` 事件支撑(命中标题),否则降级 inductive;links 二段解析,悬空丢弃;reviews 同题去重;水位线推进到批次末 seq(失败不推进,下次重试)
- **增量**:单批 ≤40 条事件,`watermark` 之后才算新事件

### Query · assemble(注入组装)
- `ai.js memBlock(kind)` 切换为 `EP.wiki.assemble(kind)`;**wiki 无页面时逐字节回退 `profile.summarize`**(零回归,测试 [16] 断言注入结构不变)
- plan 级:确认页(严格遵守,最近优先 top3)→ 热区警示 → 可注入实体(公司/人群/时长,hits≥2)→ 归纳页(参考,top3)
- section/polish 级:style 页(观察句)+ 确认页;polish 跳过结构向页面(`structOnly`,P2-1 口径延续)
- 沿用 280 字「;」边界截断;**venue/budget/department 仍只收集不注入**(P1-1 / I-5 铁律不变)

### Lint · lint + Review
- **确定性**(常驻可用):过时(>180 天未更新且非 confirmed)、孤页(仅 AI 编译页;det 种子页是统计事实天然无链,不判孤岛)、同名重复
- **矛盾**(AI 编译第一步产出):进入 `reviews[]`,面板黄色「待确认」卡片,三个预置动作:标记已处理 / 忽略 / 删除页面(llm_wiki Review 的防幻觉预设动作思想)

## 四、防复活与级联清理

- 删除页面 → `tombstones`(上限 200)记录 key,确定性/AI 编译均拒绝重建同 key 页面
- 级联:删除页面时清理其他页面指向它的 links;关闭其 open review
- 「清除档案」:profile 与 wiki(含 tombstone)一并清除,全部重学

## 五、迁移与零回归

- `EP.wiki.init()`(app 启动 + 面板打开时幂等调用):无 `ep_wiki` 且档案非空 → 确定性播种种子页面,水位线对齐当前 `profile.seq`(已消费事件不重编)
- 14 个 `EP.profile.record()` 调用点**签名零改动**;`ep_profile` 仅增 `seq`/`rawLog` 两字段,旧数据 norm 兼容
- 存量 68 项测试全绿不改动;新增 19 项(rawLog 4 + wiki 10 + AI 契约 5),合计 **87 通过 / 0 失败**
- E2E(本地服务器 + 受控浏览器):页面加载零报错 → 老档案自动迁移(4 事件 → 6 页,水位线对齐)→ 面板渲染(编译按钮/状态行/Review 卡/互链图谱 canvas)→ 删除页面后编译不复活 → 注入摘要两级正确且场地不注入

## 六、范围守卫(本版明确不做 → backlog)

- MD 笔记库(`ep_memory`)并入 wiki 编译源 → V1.2 候选(统一 Raw Sources 的终局形态)
- 向量语义检索、Louvain 社区发现、多轮会话持久化(llm_wiki 的重设施,与零后端架构冲突)
- purpose.md 用户可编辑、页面级手编 UI

## 七、改动清单

| 文件 | 改动 |
| --- | --- |
| `app/assets/js/wiki.js` | **新增**(EP.wiki):页面模型 / 确定性编译 / applyPatch 校验 / compile / assemble / lint / tombstone / wikiGraph / init 迁移 |
| `app/assets/js/ai.js` | 新增 SYS_WIKI_ANALYZE / SYS_WIKI_WRITE、四个纯函数与 `compileWiki()`;`memBlock` 切 `wiki.assemble` |
| `app/assets/js/profile.js` | `record()` 追加 rawLog(seq / 深截断 / 环形缓冲 200);`empty`/`norm` 兼容 |
| `app/assets/js/app.js` | init 调 `wiki.init()`;finishGen 静默触发编译 |
| `app/assets/js/memory.js` | `graphOf(withProfile)` 优先呈现编译页面 |
| `app/assets/js/memoryview.js` | Wiki 节点类型/样式/tab;编译状态行;编译按钮 doCompile;Review 卡片;页面详情(观察句/两级/溯源/删除);清除档案联动 |
| `app/index.html` | 引入 wiki.js;记忆面板加编译按钮与 Review 区;抽屉 V1.1 标识 |
| `app/assets/styles.css` | Review 卡片 / 页面详情样式 |
| `test/run.js` | loader 加 wiki;新增 [15][16][17] 三组 19 项断言 |

---

## 八、V1.1.1 增补(界面整理 + llm_wiki 二次移植)

**界面**(用户反馈驱动):
- 分类 tab 删除,分类下沉图谱本体:节点按 cat 着色(公司=蓝 / 各部门=紫 / 风格=琥珀 / 其他=绿),确认级深色描边;图内图例(左下,半透明不挡交互)
- 滚轮穿透修复:捕获阶段守卫,普通滚轮 = 页面滚动,Ctrl+滚轮/触控板捏合 = 图谱缩放
- 「图谱 / 洞察」双视图:洞察页集中承载 Review 卡、lint 检查、图谱洞察、编译记录(llm_wiki 的 log.md 可视化);分段按钮带待办徽标
- 顶栏保持「主次分离」成果:分段控制 + 编译记忆 + 状态行 + 搜索/布局

**llm_wiki 二次移植的功能**:
| llm_wiki 机制 | 移植实现 |
| --- | --- |
| Graph Insights(枢纽/桥接/知识缺口) | `wiki.insights()`:入度 ≥2 = 枢纽页;链接跨 cat = 桥接页;模块空/全孤立 = 缺口 → 洞察页展示 |
| 4-Signal 相关性检索 | `wiki.assemble(kind, {form})`:页面与活动信息的标题/正文关键词重合度优先(简化信号),零重合退回新近→频次序 |
| Obsidian 兼容导出(wiki 即 vault) | `wiki.toMarkdown()`:索引 + 每页一节 + `[[wikilink]]` + 元信息行,「⋯」菜单一键导出 |
| log.md 编译历史 | compileLog 时间线进洞察页(最近 8 次:时间 · AI/本地 · 事件数 → 页数) |

测试 87 → **90**(新增:相关性注入 / 图谱洞察 / toMarkdown 结构)。
