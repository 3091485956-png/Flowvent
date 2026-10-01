# 13 · Memory 记忆库(图谱化企业档案)— 方案与实施

> 2026-09-30 · 依据用户提供的笼统 Memory 提示词,按秒策框架对齐调整后落地方案
> 入口形态(用户点名):左抽屉新增「企业档案」按钮(与「创建活动」并列),右侧即记忆库面板

---

## 一、对原提示词的架构对齐调整(及理由)

| 原提示词要求 | 调整为 | 理由 |
| --- | --- | --- |
| 后端 Graphiti + Neo4j/FalkorDB + REST API | **零后端**:图谱数据存 localStorage(`ep_memory`),纯函数模块 `memory.js` | 秒策根基是零后端/零构建/file:// 双击可用/数据只存本机;个人 MD 库规模(数百~数千节点)远不需要图数据库;Windows 环境无 python/docker。与 Ranuts 444MB 取舍同构(docs/11):**借形态(知识图谱、双链、可视化),不引引擎** |
| Cytoscape.js 常驻 | **按需从 CDN 加载**(首次打开面板注入,unpkg→jsdelivr 双源),失败降级为列表视图 | 与 M4(pdf.js 按需加载)同一策略;图谱为低频功能,不为其付出常驻 400KB |
| Electron/Tauri 或本地后端实现本地文件访问 | **不引入**;用 `input[webkitdirectory]` / 多选 input 手动导入 | Electron 违背零依赖;"自动同步本地文件夹/静默索引"浏览器沙箱做不到,诚实降级(见权限说明) |
| AI 偏好记忆新建 API | **复用现有 `EP.profile`**(docs/12,含注入链路与门槛/衰减):图谱把 profile 可视化为 Preference 子图,可逐条删除 | 上轮刚完成实现+审查修复,另起炉孙必然漂移;图谱视图顺带兑现 P3"逐条删除" |
| 记忆库 → Graphiti group_id | 记忆库 = `ep_memory.stores[]`,图数据按 storeId 命名空间隔离 | 同上,零后端等价物 |
| 节点/边模型 | **原样采纳**(节点 7 类、边 6 类、属性字段对齐,含 valid_at/invalid_at 预留) | 与 Graphiti 模型同构,将来若真迁后端可平移 |

## 二、数据模型(localStorage 键 `ep_memory`)

```js
{
  ver: 1,
  stores: [{ id, name, desc, createdAt }],              // 记忆库(多库)
  graphs: { [storeId]: { nodes: {}, edges: [] } },       // nodes 为 id→node 映射(导入去重)
  files:  { [storeId]: [{ path, mtime, hash }] }         // 导入登记(hash 增量)
}
```
- 节点:`{ id, label, type, path, createdAt, updatedAt, props }`,type ∈ File/Folder/Note/Tag/Entity/Preference/Concept
- 边:`{ id, source, target, type, fact, validAt, invalidAt }`,type ∈ CONTAINS/LINKS_TO/HAS_TAG/MENTIONS/PREFERS/RELATES_TO
- 防溢出:单库节点上限 3000,超限中文报错并引导导出;localStorage 写失败返回 false 不静默
- **Preference 子图不落库**:每次渲染从 `ep_profile` 实时拼装(视图层),删除经 `EP.profile.remove` 回写——图谱即档案的"活视图"

## 三、API 设计(EP.memory / EP.profile 扩展)

```js
EP.memory = {
  createStore(name, desc) → store            // 新库
  deleteStore(id) / renameStore(id, name)
  importFiles(storeId, files) → {added, updated}   // files: [{path,text,mtime}] 纯数据,浏览器侧负责 FileList→数组
  graphOf(storeId, {withProfile}) → {nodes, edges} // 含 profile 拼装
  toCytoscape(graph) → {elements:{nodes:[],edges:[]}}  // 适配层(Graphiti 形态 → Cytoscape JSON)
  removeNode(storeId, nodeId)                       // 连带其边
  exportJSON(storeId) → 下载文件                    // 本地优先承诺的兑现
  parseMd(text) → {fm, headings, wikilinks, tags}   // 测试边界
}
EP.profile.remove(section, value)                  // 条目级删除(companies/venues/budgetTier/audiences/removedPhrases/hotspots/duration/venueType)
```

## 四、文件结构

```
app/assets/js/memory.js       新增 · 数据层:模型/MD 解析/图构建/增量/导出/适配(纯函数,node 可测)
app/assets/js/memoryview.js   新增 · 视图层:面板装配/Cytoscape 按需加载/搜索/布局/详情/删除
app/index.html                抽屉按钮「企业档案」+ panel-memory + script 引入
app/assets/styles.css         面板样式(复用设计令牌)
app.js                        openPanel 路由钩子
test/run.js                   [10] EP.memory 段
```
设置页原「企业档案」卡片**迁至抽屉面板**(避免双入口),设置页恢复纯 AI 配置。

## 五、本地文件权限与错误处理(原提示词点名项)

1. **浏览器无法静默访问本地文件夹**:导入必须经用户手动选择(多选/选文件夹 input),内容在本机解析,零上传
2. **点击节点不能直接打开本地文件**(沙箱):详情面板提供完整路径 + 「复制路径」;这是诚实降级而非缺陷
3. **同步策略**:导入按 path+hash 增量(未变文件跳过,变更文件重建其子图);"自动监听文件夹变化"浏览器做不到,提供手动「重新导入」达成等效
4. CDN 不可达 → 列表视图降级,数据管理功能(导入/删除/导出)不阻塞
5. localStorage 满 → 明确报错 + 引导导出;所有写失败可见不静默

## 六、分期

- **阶段 1(本轮)**:上述全部 API + 面板(图谱/搜索/三布局/详情/删除/导出)+ profile 联动 + 测试 + E2E
- **阶段 2(择期)**:文件夹一键重同步(diff 汇总)、Heading 级实体增强、布局位置记忆、图谱快照导出 PNG

## 七、验收对照(原提示词标准 → 本实现)

| 原标准 | 对应 |
| --- | --- |
| 创建记忆库 | createStore + 面板新建 |
| 导入单文件/文件夹 | input multiple / webkitdirectory |
| 图谱出现节点和边 | 解析→Note/Heading/Tag/Concept 节点 + CONTAINS/HAS_TAG/LINKS_TO/MENTIONS 边 |
| 拖拽/点击详情/搜索 | Cytoscape 内置交互 + 详情浮卡 + 搜索定位高亮 |
| 本地路径映射、点击可打开 | 路径入节点属性、详情可复制(**打开受沙箱限制,见五.2**) |
| AI 写入偏好并检索到 | 现有埋点持续写入 `EP.profile.record`;图谱实时呈现为 Preference 节点 |
| Graphiti→Cytoscape 转换 | `toCytoscape` 适配层(有专项测试) |

---

## 实现记录(阶段 1,2026-09-30 当日完成)

**改动面**:新增 `memory.js`(数据层 ~290 行,纯函数)、`memoryview.js`(视图层 ~230 行);`profile.js` 新增 `remove(section, value)` 条目级删除;`index.html` 抽屉「企业档案」按钮 + panel-memory + 脚本引入;`styles.css` 面板样式;`app.js` 路由钩子并导出 toast/confirmModal/promptModal 供视图复用。**设置页原档案卡片整体迁至抽屉面板**(单入口)。

**测试**:52 通过 / 0 失败(44→52,[10] 段 8 断言:parseMd 全语法 / 多库隔离 / 悬空 Concept 与目标后重定向 / 增量导入 / removeNode 连带清理 / toCytoscape 形状 / 节点上限 / Preference 子图与 remove 联动)。

**E2E(本地服务器)**:抽屉入口与面板 ✓;CDN 加载 Cytoscape + 11 节点 10 边渲染 ✓;Note 详情(路径/连接数/移除/复制路径)✓;偏好节点删除 → 图谱与 `ep_profile` 双删 ✓;搜索"物料"精确命中高亮 ✓;fit 后全图入视口、标签零重叠、详情卡在区内 ✓。

**实现中发现并修复的 bug**:renderGraph 二次刷新时无条件 `innerHTML=''` 清容器,把已挂载的 canvas 一并清掉(cy 实例存活但脱离 DOM,图消失);改为仅在创建实例前清一次。

**视觉评审说明**:视觉模型 API 本轮临时不可用(-401),截图直读通道亦只回传 URL;以程序化布局审查替代(节点标签两两重叠率 0、工具栏 2 行整齐、详情卡 250px 完全在图谱区内、fit 后全图包含),待通道恢复可补一轮人工视觉复核。

**已知边界(诚实声明)**:点击节点不能打开本地文件(浏览器沙箱,提供复制路径);文件夹"自动监听变化"不可实现,重复导入按 hash 增量达成等效;图谱渲染依赖 CDN(双源),离线自动降级列表视图,导入/删除/导出不受影响;阶段 2 候选:一键重同步 diff 汇总、Heading 级实体增强、布局位置记忆、PNG 导出。

## 只读审查轮(2026-09-30)与定向修复

**审查结论**:有条件通过——核心闭环成立,Graphiti/REST/Electron 偏差均属本方案显式声明;审查提出 11 项问题(M-1~M-11)。按用户裁定"只修影响体验的与损害用户的,功能在精不在多":

| 项 | 性质 | 处置 |
| --- | --- | --- |
| M-1 CDN 脚本无完整性校验 | 损害用户(供应链) | **已修**:双源加载带 SRI `integrity` + `crossOrigin`(sha384 经两源下载比对一致后固化;校验失败即拒载转下一源) |
| M-2 导入无逐文件容错(一坏全败) | 影响体验 | **已修**:per-file try/catch,坏文件跳过并在汇总 toast 中明示 |
| M-4 空态引导不可达(新用户见孤点) | 影响体验 | **已修**:空态判定改为"除档案中心外无任何节点" |
| M-8 大图 cose 同步卡顿 | 影响体验 | **已修**:节点 >800 且布局为力导向时自动降级层次布局并 toast 说明 |
| M-3 类型过滤/悬停提示/右键菜单/偏好多维检索 | 功能缺口 | **正式降级,不做**(功能在精不在多):操作集中于详情浮卡已覆盖核心路径;偏好按 kind 注入优于泛化检索。验收口径以此为准 |
| M-5 stores() 绕过 API / M-6 双时态历史 / M-7 MENTIONS 与 File/Folder/Entity 模型项 / M-9 删除单条偏好无确认(会重新学回) / M-10 props 冗余 / M-11 档案导出 | 代码卫生/架构洁癖/弱影响 | 维持择期,不修 |

**验证**:测试 52/52 仍绿;E2E 四项——SRI 下 Cytoscape 正常加载、坏文件跳过且好文件入库(汇总 toast)、空库显示引导文案(无 canvas)、813 节点自动切层次布局并提示。
