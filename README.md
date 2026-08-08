# 知域 · 企业知识中台

> 一名业务产品经理向 AI 产品经理转型的实战作品。从 0 到 1 独立完成：需求拆解 → 架构设计 → Agent 工作流编排 → LLM 瓶颈治理 → 部署上线。
>
> **Not just talking about AI — I built one, shipping real features on a real LLM.**

[在线演示](https://zhiyu-kb.xyz) · [51 commits](https://github.com/seaninggit/zhiyu-enterprise-kb/commits/main) · 全栈独立开发 · Vibe Coding 实操

---

## 项目背景与求职初衷

我过去 5 年做业务产品经理（企业 SaaS / B 端工具方向），擅长需求分析、流程设计和跨部门落地。2025 年起，我决定系统性地向 **AI 产品经理** 转型。

市面上 AI PM 很多停留在"给研发提 prompt 需求"，缺少对 **LLM 底层机制、Agent 行为边界、上下文工程和 Token 成本模型**的体感。我认为 AI PM 的核心竞争力不在"会用 ChatGPT"，而在于：

1. **知道 LLM 在什么条件下会失败**（幻觉、上下文溢出、工具调用循环失控）
2. **能把产品需求翻译成 Agent 可执行的工作流**（tool definition、system prompt、错误降级）
3. **能在 LLM 限制下做出产品权衡**（精度 vs 成本、实时性 vs 上下文完整性）

这个项目就是我的答卷：**从产品需求文档开始，到一套可演示的企业级 AI Agent 知识管理系统，全部独立 Coding 落地。**

技术实现由 **VS Code + Codex Computer Use + DeepSeek-v4-pro** 驱动（Vibe Coding 模式），我的角色是产品架构师 + 质量把控者 + 迭代决策者。

---

## 技术栈

| 层级 | 选型 | 产品决策考量 |
|------|------|-------------|
| 前端 | React 19 + Next.js 16 + TypeScript | 响应式企业后台，SEO 友好的 SSR |
| 边缘计算 | Cloudflare Workers | 全球低延迟、免费额度适合 MVP 验证 |
| 数据库 | Cloudflare D1 (SQLite) | 边缘 SQL、与 Workers 零延迟、无运维 |
| ORM | Drizzle ORM | 类型安全、迁移可审计、比 Prisma 轻量 |
| 文件存储 | Cloudflare R2 | S3 兼容、零出站费用 |
| LLM 推理 | DeepSeek-v4-pro / DeepSeek-v4-flash | 中文理解强、上下文窗口足够、成本可控 |
| Embedding | DashScope qwen3.7-text-embedding (1024d) | 中文语义匹配精度高、按量付费 |
| 本地 AI | Xenova/paraphrase-multilingual-MiniLM-L12-v2 | 浏览器端向量化，零 API 成本 |
| OCR | Tesseract.js (WASM) | 浏览器本地 OCR，不上传图片到云端 |
| 邮件 | Resend API | 轻量事务邮件、免费额度 |
| 部署 | Wrangler CLI + Cloudflare Workers/Sites | 边缘部署、自动扩缩 |

> **产品决策原则**：能用浏览器本地能力的不用云 API（OCR、向量化），能用边缘免费的不用服务器（D1、R2、Workers），必须云化的选性价比最优（DeepSeek 而非 GPT-4）。

---

## 产品需求拆解

### 用户角色矩阵

```
超级管理员 ─── 全局治理、组织架构、审计
    │
部门管理员 ─── 本部门知识审核、权限配置、巡检
    │
普通员工 ───── 创建/编辑知识、AI 问答、反馈
    │
外部访客 ───── 只读访问、独立会话、有限功能
```

### 核心业务流程

```
业务人员上传资料 → 解析/OCR/安全检查 → 正文切片与语义索引
    → 提交部门审核 → 驳回(退回草稿) / 通过(发布生效)
    → 权限过滤后的语义检索 → AI 引用问答
    → 用户反馈(没解决→治理待办) → 修订/复核/重新发布
```

### 功能模块拆解

| 模块 | 需求来源 | 核心功能 |
|------|---------|---------|
| **知识生产** | 业务部门日常产出 | 多格式上传、自动解析、OCR、分段索引、版本管理 |
| **审核发布** | 企业治理合规 | 草稿→部门审核→发布/驳回、操作日志、版本快照 |
| **权限隔离** | 数据安全 | RBAC 三级角色、部门隔离、行级安全、ACL |
| **AI 问答** | 知识消费 | 语义检索 + LLM 生成、引用溯源、多轮会话、意图识别 |
| **知识治理** | 质量运营 | 过期检测、重复检测、解析失败重试、搜索缺口 |
| **Agent 巡检** | 自动化运维 | 定时巡检、自动作废、邮件通知、治理任务创建 |
| **决策树** | 员工自助 | 交互式流程指引（报销、合同、入职） |

---

## 系统架构

```
┌──────────────────────────────────────────────────────────┐
│                    用户浏览器                              │
│  React 19 / Next.js 16                                  │
│  ├─ 本地 OCR (Tesseract.js WASM)                        │
│  ├─ 本地向量化 (MiniLM-L12)                              │
│  └─ 知识管理 UI + AI 对话面板 + 治理仪表盘                │
└──────────────────────┬───────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼───────────────────────────────────┐
│              Cloudflare Workers / Sites                   │
│  ┌──────────────────────────────────────────────────┐   │
│  │              API Routes (Next.js)                 │   │
│  │  /api/ai/*  /api/documents/*  /api/search/*       │   │
│  │  /api/governance/*  /api/decisions/*              │   │
│  └──────────────────────┬───────────────────────────┘   │
│  ┌──────────────────────▼───────────────────────────┐   │
│  │                 Service Layer                     │   │
│  │  Agent (tool-use loop)  │  RAG (retrieval)        │   │
│  │  Intent Classifier      │  Answer Quality         │   │
│  │  Query Correction       │  Authz (RBAC)           │   │
│  │  Document Access (RLS)  │  Ingestion Pipeline     │   │
│  └──────────────────────┬───────────────────────────┘   │
│  ┌──────────────────────▼───────────────────────────┐   │
│  │              Data & External APIs                 │   │
│  │  D1 (SQLite)  │  R2 (Files)  │  DeepSeek API     │   │
│  │  DashScope Embedding  │  Resend Email            │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Cron: Scheduled Governance              │   │
│  │  每日自动: 过期作废 │ 重复检测 │ 同音学习 │ 复核提醒  │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 数据模型（核心实体）

```
documents ──< document_chunks ──< ai_query_logs
    │                                    │
    ├── document_versions                ├── ai_answer_feedback
    ├── document_attachments             └── ai_conversations
    ├── document_tags                         │
    ├── approval_records                  ai_messages
    └── knowledge_governance_tasks
                                          
users ──< user_roles >── roles             departments
  │                                         │
  ├── user_groups >── enterprise_groups     ├── knowledge_categories
  └── notifications                         └── decision_trees
                                               │
audit_logs  search_logs  search_corrections  decision_nodes
intent_embeddings  system_settings  prompt_templates
```

> 18 张业务表，19 个数据库迁移文件（786 行 SQL），完整记录数据模型演进路径。

---

## 环境配置

### 前置条件

- Node.js `>= 22.13.0`
- npm
- Cloudflare 账号（免费套餐即可）
- DeepSeek API Key（用于 AI 问答生成）
- DashScope API Key（用于语义意图识别，可选）
- Resend API Key（用于邮件通知，可选）

### 本地启动

```bash
git clone https://github.com/seaninggit/zhiyu-enterprise-kb.git
cd zhiyu-enterprise-kb
npm install
cp .env.example .env.local
```

编辑 `.env.local`：

```dotenv
# LLM 推理（必填：AI 问答功能依赖此项）
AI_PROVIDER=deepseek
AI_BASE_URL=https://api.deepseek.com
AI_CHAT_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=sk-your-key-here

# 语义意图分类（可选：不填则降级为正则匹配）
DASHSCOPE_API_KEY=sk-your-key-here

# 邮件通知（可选：不填则仅站内通知）
RESEND_API_KEY=re_your-key-here
```

```bash
npm run dev        # 启动本地开发环境
npm run lint       # 静态检查
npm test           # 构建 + 集成测试
npm run build      # 生产构建
```

> 未配置 API Key 时，**权限过滤、关键词检索、向量检索和全文搜索仍完全可用**。本地 OCR 和向量模型在浏览器侧运行，首次使用自动下载缓存。

---

## 遇到的 LLM 瓶颈与全套解决方案

> 这些是在实战中遇到的真实问题——每一个都代表了从"能跑"到"生产可用"的产品差距。

### 1. 上下文窗口溢出：检索结果 + 历史消息撑爆 Token 上限

**现象**：多轮对话 5 轮后，DeepSeek API 返回 `context_length_exceeded` 错误。

**根因分析**：
- 每次请求携带全部历史消息 + 检索切片（5-10 条 × 800 字）+ system prompt（~1200 tokens）
- 用户追问时检索范围被上一轮引用文档限制（`contextDocumentIds`），但历史消息仍在膨胀
- DeepSeek-v4-flash 上下文窗口 128K，但消息体中的中文 + JSON 结构会快速消耗

**解决方案**：
- **滑动窗口裁剪**：最终总结（summary）阶段只发送最近 15 条消息
- **引用过滤**：AI 追问回答生成后，回溯实际引用的文档编号（正则提取 `[N]`），过滤掉未引用切片，避免后续轮次携带无用的 context
- **追问检测**：识别"那"、"这个"、"根据以上"等指代词，判定为追问后缩小检索范围到当前会话关联文档
- **分层裁剪策略**：检索 → 过滤 → 裁剪（先保证召回，再裁上下文）

**产品启示**：上下文管理不是技术问题，是产品设计问题。每一轮要传递多少历史、如何压缩、何时重置，都需要产品定义。

---

### 2. Chat/Completions vs. OpenAI Responses API：接口语义的差异

**问题**：Agent 模式下，LLM 返回 `tool_calls` 后需要将执行结果以 `tool` 角色回传。DeepSeek 的 chat/completions 接口完全兼容 OpenAI 格式，但有几个坑：

**踩坑记录**：
- **tool_call_id 必须严格对应**：每次回传 tool result 时需要原始的 `tool_call_id`，乱序或遗漏会导致 LLM 忽略结果直接重复调用
- **role: "tool" 消息不能单独出现**：必须跟随在 assistant（含 tool_calls）消息之后，否则 API 拒绝
- **max_iterations 保护**：没有循环上限时 Agent 可能反复调用工具（实测最多一次调了 9 个工具后仍未给出终答），设置 `MAX_ITERATIONS = 5` 强制截断
- **温度参数两阶段策略**：tool-use 阶段 temperature = 0.2（精确调用），总结阶段 temperature = 0.5（自然表述）

**产品启示**：Agent 不是"把工具列表丢给 LLM 就行"。你需要设计 tool-use loop 的**终止条件、错误处理、结果格式校验和降级策略**。

---

### 3. Token 溢出与成本模型

**问题**：每次 AI 问答实际消耗的 Token 远超预期——单次对话可能消耗 3000-8000 tokens（含 system prompt + 检索结果 + 历史 + 生成）。

**成本优化措施**：

| 优化项 | 手段 | 效果 |
|--------|------|------|
| 意图前置识别 | 短输入先走本地意图分类，命中寒暄/感谢/告别等直接返回模板 | 减少 30% 无效 LLM 调用 |
| 检索二次验证 | 检索结果回来后先做关键词命中判断，不相关直接拒答 | 避免 LLM 收到无关 context 后"努力编造" |
| 双模型策略 | Agent 分析用 flash（便宜），复杂推理用 pro | 成本降低 40% |
| Source 过滤 | 生成后正则提取实际引用，裁剪未引用的 context | 后续轮次 context 减半 |
| 审核前置 | 公共访客的提问先做内容安全判断 | 避免为违规请求浪费 Token |

**产品启示**：AI PM 必须建立 **Token 成本心智模型**——每个产品决策都有对应的 Token 消耗和延迟代价。

---

### 4. 幻觉治理：当 LLM 收到无关检索结果时

**问题**：检索系统返回了与问题无关的文档（语义匹配假阳性），LLM 仍然"努力"基于这些文档编造答案。

**解决方案**：
- **来源相关性校验**（`areSourcesRelevant`）：中文二分词 + 停用词过滤 + 关键词命中计数。如果最佳引用的命中数 < 2 且标题不匹配任一关键词 → 直接拒答
- **上下文追问豁免**：用户追问"还有呢"时，前一轮的检索范围是对的，跳过相关性检查
- **答案后校验**：如果 source 数和 mode 判定矛盾（有 source 但 mode 是 no_evidence），清空 source 避免 UI 展示误导

**产品启示**：**检索质量 ≠ 答案质量**。RAG 系统中，检索后的过滤和校验比检索本身更影响最终体验。

---

### 5. Agent 行为边界：何时不该调用工具

**问题**：Agent 模式下，LLM 倾向于"过度使用工具"。用户问"你好"，Agent 仍然调用 `search_knowledge` 然后再回复。

**解决方案**：
- **意图前置分类**：7 类非知识意图（身份、能力、寒暄、告别、感谢、确认、账号）+ 闲聊/辱骂识别，命中后直接返回模板答案，不进入检索/Agent 流程
- **语义分类替代硬编码正则**：DashScope embedding + 余弦相似度 + 64 条意图模板 → 覆盖率从 60% 提升到 92%
- **Agent 模式权限控制**：普通员工无法进入 Agent 模式（角色前置判断），避免越权操作
- **输入长度门控**：长于 15 字 + 含业务关键词 → 跳过意图分类直接进入检索（避免误判）

**产品启示**：Agent 的行为边界不应该只依赖 system prompt，**代码层的护栏（guardrails）**才是可靠的。

---

### 6. 会话压缩与多轮对话一致性

**问题**：用户来回切换话题后，LLM 的上下文被污染——前一个话题的检索结果混入后一个话题。

**解决方案**：
- **追问检测**：正则识别指代词（"那"、"这个"、"根据以上"），判定为追问才复用上一轮的上下文文档范围
- 非追问的新问题**清空上下文过滤**，重新全量检索
- **会话边界**：用户发送纯确认（"好的"、"需要"、"不用"）时识别为对上一轮 AI 追问的回应，不重新检索
- **历史 cap**：每个会话最多保留最近 20 轮，超出自动裁剪

---

### 7. 搜索结果的假阳性与排序

**问题**：企业知识搜索中，关键词匹配的假阳性率很高——"报销"命中所有含"报销"二字的文档，但用户想找的是差旅报销标准而非招待报销。

**改进措施**：
- **标题加权**：标题命中多个关键词时累加 boost（`TITLE_BOOST_BASE + hits × TITLE_BOOST_PER_HIT`）
- **短语匹配加权**：纠错后的完整短语命中 corpus 时加分
- **双路混合排序**：关键词匹配 + 向量语义匹配，动态权重（`KEYWORD_W_SEMANTIC = 0.28, SEMANTIC_WEIGHT = 0.42`）
- **同音自学习**：搜索 0 结果 → 用户换词后找到 → 自动建立同音纠错映射存入 `search_corrections`

**产品启示**：搜索排序参数的每一个权重比例，都来自对用户行为的观察——这不是调参，是产品决策。

---

## MVP 功能清单

### ✅ 已交付（51 commits）

| 模块 | 功能 | 状态 |
|------|------|------|
| **知识生产** | 多格式上传（TXT/MD/PDF/DOCX/XLSX/PPTX/图片） | ✅ |
| | 浏览器端 OCR（Tesseract.js 中英文） | ✅ |
| | 自动分段切片 + 语义索引 | ✅ |
| | 版本管理（编辑生成新版本，首版不伪造历史） | ✅ |
| **审核发布** | 草稿 → 部门审核 → 发布/驳回 | ✅ |
| | 驳回原因记录 + 修改后重新提审 | ✅ |
| | 发布版本快照（已发布内容不受草稿修改影响） | ✅ |
| **权限体系** | RBAC 三级角色（超级管理员/部门管理员/员工） | ✅ |
| | 部门隔离 + 用户组 ACL + 敏感级别 | ✅ |
| | 服务端行级权限校验（前端仅展示控制） | ✅ |
| **AI 问答** | 语义检索 + LLM 生成 + 引用溯源 | ✅ |
| | 上下文追问 + 多轮会话 + 办理清单生成 | ✅ |
| | 引用原文一键打开 | ✅ |
| | 7 类非知识意图识别（语义 + 正则双路） | ✅ |
| | 无依据拒答（不用模型常识替代企业制度） | ✅ |
| | Agent 模式（管理员专用 tool-use loop） | ✅ |
| **知识治理** | 过期/重复/解析失败/空草稿/搜索零结果检测 | ✅ |
| | 一键作废、重新解析、标记重复、建治理任务 | ✅ |
| | AI 质量反馈 → 治理待办闭环 | ✅ |
| | 定时巡检 Cron（自动作废 + 重复检测 + 复核提醒） | ✅ |
| **Agent 工具** | search_knowledge / inspect_document / list_documents | ✅ |
| | find_similar / batch_archive / create_governance_task | ✅ |
| | send_email（Resend API + 站内通知 + 审计） | ✅ |
| **决策树** | 费用报销 / 合同审批 / 新员工入职 交互式指引 | ✅ |
| **审计** | 操作日志 + 请求追踪 + 敏感操作邮件通知 | ✅ |
| **公共演示** | 外部访客模式 + 三套预置身份一键切换 | ✅ |

---

## 迭代路线

### V1.0（当前）—— 企业知识中台 MVP

已完成：知识全生命周期（生产→审核→发布→检索→AI问答→治理→审计）。

### V1.1（规划中）—— Agent 深度集成

- [ ] Agent 对话式 UI（工具调用过程可视化）
- [ ] 多 Agent 协作（检索 Agent + 治理 Agent + 通知 Agent 分工）
- [ ] Agent 决策可解释性（每一步推理展示引用证据）
- [ ] 工具调用审批流（高危操作需人工确认）

### V1.2（规划中）—— 知识图谱与推理

- [ ] 文档间引用关系图谱
- [ ] 制度冲突检测（新规与旧规的自动对比）
- [ ] 基于知识图谱的多跳推理问答

### V2.0（远期）—— 企业 AI 工作台

- [ ] 多知识库联邦检索
- [ ] 自定义 Agent 模板（部门按需配置）
- [ ] 知识质量自动评分
- [ ] 组织级知识健康度仪表盘

---

## 产品经理实战复盘

### 1. 从"提需求"到"做产品"：Vibe Coding 的实战体验

这个项目的全部代码都由 **VS Code + Codex Computer Use + DeepSeek-v4-pro** 驱动生成。我的角色不是写代码的人，而是：

- **需求翻译者**：把业务场景翻译成 Agent 能理解的 system prompt 和 tool definition
- **质量守门人**：每次代码变更后验证功能是否按预期工作、边界条件是否覆盖
- **架构决策者**：选择用浏览器本地能力还是云 API、用正则还是语义分类、用同步还是异步
- **迭代推动者**：根据测试反馈决定下一个优先级——修 bug 还是加功能

**最大收获**：AI Coding 工具让产品经理可以直接把产品直觉落地为可运行的系统。不再需要"等研发排期"——你理解了限制，就能自己做权衡。

### 2. 踩坑记录（部分）

| 坑 | 表象 | 根因 | 产品层面优化 |
|----|------|------|-------------|
| Agent 循环失控 | LLM 连续调用 9 个工具不停止 | 没有 max_iterations 上限 | 设置硬截断 + 截断时给出已有结论 |
| 上下文溢出 | 第 5 轮对话 400 错误 | 历史消息 + 检索结果超限 | 滑动窗口 + 引用过滤 + 追问检测 |
| 意图误判 | "我需要报销"被识别为寒暄 | 正则遗漏业务关键词 | 改语义分类 + 关键词前置门控 |
| 检索假阳性 | "员工福利"召回"员工手册" | 语义向量过度泛化 | 来源相关性二次校验 |
| 工具调用 ID 错乱 | LLM 忽略 tool result 重复调 | tool_call_id 回传错误 | 严格按 OpenAPI tool-use 协议映射 |
| 浏览器 Embedding 性能 | 384 维向量化 800 条需 3s+ | 全量检索每次都重新跑 | 发布时预建索引 + 增量更新 |

### 3. 为什么这个项目证明我能做 AI PM

- **我理解 LLM 的边界**：不是"AI 什么都能做"，而是精确知道上下文窗口、Token 成本、幻觉概率和工具调用协议限制在哪里
- **我做过 Agent 行为设计**：7 个工具的定义、调用协议、错误处理和终止条件都是产品层面的决策
- **我会做 AI 产品的成本模型**：意图前置识别省 30% 调用、双模型策略省 40% 成本——每个优化都有量化依据
- **我有完整的 0→1 落地能力**：从需求文档到 49 次迭代到可演示的线上系统，没有依赖研发团队
- **我懂得何时用规则、何时用模型**：意图分类用语义模型替代正则、搜索用混合排序替代纯关键词——每个选择都有 trade-off 分析

---

## 相关资源

- [在线演示](https://zhiyu-kb.xyz)（每个浏览器自动分配独立测试账号）
- [部署说明](docs/DEPLOYMENT.md)
- [权限模型](docs/PERMISSIONS.md)
- [API 契约](docs/API-CONTRACTS.md)
- [数据库 Schema](docs/SCHEMA.sql)

---

## License

本项目为个人实战作品，当前未声明开源许可证。未经授权，不得用于商业分发。

---

*Built with VS Code + Codex Computer Use + DeepSeek-v4-pro · 51 commits · 1 developer · 0 to 1*
