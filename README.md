<div align="center">

# Flowvent · 秒策

**面向企业雇主品牌岗位的 AI 原生活动策划工作台**

填一页表单 → AI 深度思考、一次性生成整份 Word 式策划案 → 所见即所得编辑 + AI 对话改稿 → 记忆库越用越懂你的公司 → 一键导出真 Word / PDF / Markdown

![pure-frontend](https://img.shields.io/badge/architecture-pure%20frontend-blue) ![zero-build](https://img.shields.io/badge/build-zero%20config-green) ![zero-backend](https://img.shields.io/badge/backend-none-localhost%20only-orange) ![tests](https://img.shields.io/badge/tests-68%20passed-brightgreen)

</div>

---

## ✨ 核心能力

### 1. AI 整案生成
一页表单（必填校验 + 条件字段）→ 一次对话产出**完整策划文档**：8~12 个 AI 自拟章节，涵盖概述 / 时间表 / 环节 / 分工 / 物料 / 预算 / 文案 / 主持词 / 安全 / 复盘。未提供的信息诚实写「待定」，绝不编造；生成失败表单内容自动保留可重试。

### 2. AI 深度思考流
生成不再是假进度动画：SSE 流式逐 token 上屏，模型的 `reasoning_content` 实时滚动显示在深色终端风思考面板；阶段进度由**真实事件驱动**（请求发出=理解中 → 首个思考 token=规划中 → 首个正文 token=撰写中），秒表只报真实耗时。思考力度三档可选（low/medium/high），接口不认参数时自动去参重试，非流式网关自动回落。

### 3. AI 对话编辑
Word 式文档编辑（独立标签页）：整篇连续文档直接改文字，工具栏加粗/小节标题/列表/撤销；章节标题固定防误删。右侧 **AI 编辑对话面板**——用自然语言下指令（"把流程整体提前半小时"），AI 直接改写文档对应章节，动作卡可一键撤销；对话历史进入记忆管道，AI 判定的长期偏好可「设为默认」。选中文本右键仍有 AI 润色/扩写/重写。

### 4. 记忆库 · 越用越懂用户
四大模块：**公司 / 各大部门 / 策划案风格 / 其他偏好**。全部被动学习、零交互负担：

- 每次生成、每次修改、每条对话指令都会沉淀为公司事实与文风偏好
- 支持导入**过往活动方案 .docx**，AI 从历史成果中学习排版与风格
- 偏好确认弹窗可解释、可编辑、可一键清除——档案是用户数据，只存本机
- 记忆图谱可视化（中心企业 + 部门 + 偏好节点），按模块 tab 过滤

### 5. 同源三导出
真 **Word 文档**（.docx，零依赖纯前端生成，标题层级/表格着色与预览一致）/ **所见即所得 PDF**（块感知分页，与网页预览完全一致）/ **Markdown** 单文件——全部由同一份 sections 数据渲染，结构一致。

## 🖼️ 界面预览

| 欢迎首页 | 创建表单 |
| :---: | :---: |
| ![欢迎首页](体验测试/evidence/01-欢迎首页.png) | ![创建表单](体验测试/evidence/02-创建表单.png) |

| 方案生成结果 | 记忆库图谱 |
| :---: | :---: |
| ![方案生成结果](体验测试/evidence/05-方案1生成结果页.png) | ![记忆库图谱](体验测试/evidence/06-企业档案记忆图谱-已学7项偏好.png) |

## 🚀 快速开始

**方式一（推荐）：** 直接双击 `app/index.html` 即可在浏览器中使用——纯前端、零依赖、零构建，已有方案的查看/编辑/导出全程离线可用。

**方式二（本地服务器）：**

```bash
cd app
node .serve.js 8137        # 或任意静态服务器
# 打开 http://localhost:8137
```

> 首次生成方案前，请先在「设置」配置任意 OpenAI 兼容 AI 接口（智谱 / 通义 / OpenAI / Ollama 私有网关均可）。**API Key 仅存本机浏览器 localStorage，不上传任何服务器。**

## 🧱 项目架构

**总体形态**：零后端、零构建、零外部请求（除用户自配 AI 接口）的 vanilla JS 单页应用。所有模块挂载于 `window.EP` 命名空间，15 个经典 `<script>` 顺序加载；数据与 AI Key 仅存 localStorage，`file://` 双击即用；编辑页走 hash 路由 `#edit=<planId>`。

### 模块清单（`app/assets/js/`）

| 模块 | 职责 |
| --- | --- |
| `bg.js` | Aurora 动态背景（ogl 1.0 移植，canvas rAF） |
| `icons.js` | 内嵌图标体系：Lucide 26 + IconPark 8，全部 SVG 内嵌、离线零请求 |
| `md.js` | 极简 Markdown 渲染器（服务文档预览/编辑往返） |
| `struct.js` | 文档结构契约层：类型表 / `parseDoc` AI 输出容错解析 / 旧数据迁移 / `metaRows` 单一事实源 |
| `profile.js` | 企业/用户档案（「越用越懂用户」）：事件→档案纯函数 + prompt 偏好摘要 |
| `ai.js` | AI 生成层：整案流式生成 / 章节重写 / 润色扩写 / 对话编辑（严格 JSON 契约）/ SSE 解析 |
| `storage.js` | localStorage 持久化 + 旧结构自动迁移 |
| `memory.js` | 记忆库图谱数据层（公司/部门/风格/其他偏好，`cat` 分类契约） |
| `intake.js` | 过往活动方案导入：.docx 内嵌 ZIP 解压 + XML 解析，让 AI 从历史成果学习 |
| `memoryview.js` | 记忆库面板 UI：图谱渲染 + 四模块 tab 过滤 + 分类计数 |
| `exporter.js` | Markdown 导出 + 打印组装 |
| `word.js` | 真 .docx 生成器：CRC32 + STORE ZIP + 最小 OOXML，零第三方库 |
| `pdf.js` | 所见即所得 PDF：jsPDF + html2canvas 块感知分页（已本地化打包） |
| `doceditor.js` | 文档编辑标签页：WYSIWYG + 右键 AI 菜单 + AI 对话面板 + 自动保存 |
| `app.js` | 总装配：视图路由 / 创建流程 / 面板与弹窗 / 生成管线 |

### 关键设计决策

- **AI 是唯一生成来源**：不内置任何内容模板。prompt 契约约束输出为「## 章节」式 Markdown（禁 `#`/`###`，时间表/分工/物料/预算必须表格，未给信息写「待定」不编造）；`struct.parseDoc` 做容错解析（剥代码围栏/寒暄、剥模型自带序号、深层标题降级）。
- **思考流真实驱动**：阶段切换绑定真实 token 事件，非流式网关诚实降级为普通进度，不假装思考；30 秒无 token 判死、总上限 4 分钟。
- **记忆防漂移铁律**：档案只影响风格与背景事实，不改变「待定不编造」契约；注入摘要限长，防止档案膨胀污染上下文；与活动信息冲突时以活动信息为准。
- **编辑往返**：contenteditable → `htmlToMd` 逆变换写回，浏览器撤销栈完整保留；章节标题固定防误删。
- **同源三导出**：网页预览、PDF、Word 由同一份 sections Markdown 渲染，结构天然一致。

## 📁 目录结构

```
Flowvent/
├── README.md                     ← 本文件
├── 交接文档.md                    ← v2 系统性审查报告（四维框架）与交接基线
├── 体验报告-秒策全真模拟.md        ← 第一轮全真模拟体验报告
├── 体验报告-秒策全真模拟第二轮.md  ← 第二轮体验报告（9 项缺陷 → 已修复 7 项）
├── docs/                         ← Vibe_helper 固定工作流全过程文档（01~15 + backlog）
├── app/                          ← 产品本体（纯前端静态应用）
│   ├── index.html
│   ├── .serve.js                      临时静态服务器（本地测试用）
│   └── assets/
│       ├── styles.css                 设计令牌 + 三视图 + 打印样式
│       └── js/                        15 个模块（见上表）
├── test/
│   └── run.js                    零依赖测试基线（node test/run.js，68 断言）
├── tools/
│   ├── gen-icons.js              图标资产生成器（CDN 拉取 + 品牌双色注入）
│   └── gen-aurora.js             Aurora 背景资产生成器
└── 体验测试/                      全真模拟的证据截图与产物
    ├── evidence/                      6 张关键界面截图
    ├── plans-100.md · probe-results.jsonl
    └── 第二轮/                       29 份 AI 生成方案样本
```

## 📚 文档导航（`docs/`）

| # | 文档 | 内容 |
| --- | --- | --- |
| 01 | 问卷与需求澄清 | 目标用户 / 场景 / 痛点 |
| 02 | brief | 项目一句话定位（含提示词优化记录） |
| 03 | 竞品分析 | 竞品格局与差异化 |
| 04 | 用户声音 | 用户原声与诉求归纳 |
| 05 | 需求分层 | MoSCoW + 验收标准 |
| 06 | 产品框架 | 信息架构与核心闭环 |
| 07 | 技术框架 | 技术选型与模块划分 |
| 08 | 交付验收 | 验收对照表 + 三轮缺陷修复记录 |
| 09 | 个性化与记忆方案 | 「越用越懂用户」初版方案 |
| 10 | 无声助理改造方案 | 被动捕获 / 不加交互负担的原则 |
| 11 | AI 整案生成重构 | v2 重构：删模板、AI 唯一生成源、决策依据 |
| 12 | 越用越懂用户·框架设计 | 五事件捕获 → 档案 → 注入的完整链路 |
| 13 | Memory 记忆库方案 | 图谱数据模型与可审计性 |
| 14 | 品味学习方向 | 从历史方案 .docx 学习风格的方案 |
| 15 | 深度思考 / AI 对话编辑 / 记忆库四模块 | 第三轮大改框架与实现记录 |
| — | backlog | 范围守卫：新想法先落这里 |

## 🧪 测试

```bash
node test/run.js    # 68 断言全绿，零依赖
```

覆盖：结构契约解析 / 存储与迁移 / docx 生成（另经 `unzip -t` + XML 良构验证）/ SSE 思考流解析 / 对话编辑 JSON 容错 / 记忆库四模块分类与迁移 / 档案事件纯函数。关键交互另经本地服务器 + 桩 fetch 的浏览器 E2E 全链验证。

## 🔒 隐私与数据

- 数据与 AI Key **均只存本机 localStorage**，零后端、零上传、零埋点
- 记忆档案是用户数据：可查看、可编辑、可一键清除
- 清空浏览器数据会丢失方案——请及时导出 .docx / Markdown 归档

## ⚠️ 已知限制

- 生成 / 重新生成 / 对话编辑需配置 AI 接口；未配置时引导前往设置，已有方案的查看/编辑/导出不受影响
- .docx 中的列表为字面项目符号（非 Word 原生自动编号），如需编号列表可在 Word 中一键转换
- 跨标签页同时编辑同一方案为整方案级最后写入优先（已知 backlog 项）

## 📄 许可与致谢

- 功能图标 [Lucide](https://lucide.dev)（ISC 许可）· 类型标识 [IconPark](https://iconpark.oceanengine.com)（MIT 许可）
- 编辑体验参考 Ranuts Document 的产品形态，按本产品轻量本地架构等效实现，未引入其代码
- PDF 导出内置 [jsPDF](https://github.com/parallax/jsPDF) + [html2canvas](https://github.com/niklasvh/html2canvas)，已本地化打包、离线可用

---

<div align="center">

## 🌐 快捷访问入口

### [🚀 立即在线使用 Flowvent](https://3091485956-png.github.io/Flowvent/)

**https://3091485956-png.github.io/Flowvent/**

在线版与本地版完全同源，由 GitHub Pages 自动部署 `app/` 目录 · 首次生成前请先在「设置」中配置 AI 接口

也可以随时本地使用：双击仓库中的 `app/index.html` 即可

</div>
