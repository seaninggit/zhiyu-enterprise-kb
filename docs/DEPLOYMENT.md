# 知域部署说明

本项目运行于 Cloudflare Workers/Sites，使用 D1 保存结构化数据、R2 保存原始文件，并由 Sites 提供登录与访问策略，因此不使用 Docker Compose、服务器 IP 或本地密码配置。

## 环境划分

- dev：本地开发与临时 D1/R2 资源。
- test：独立 Sites 项目、独立数据库和文件桶，用于迁移及权限测试。
- prod：生产 Sites 项目，只允许受控成员访问。

各环境必须使用独立资源，不在代码中保存账号、密码、Token、IP 或资源 ID。

## AI 与本地检索配置

- `AI_PROVIDER=deepseek`
- `AI_BASE_URL=https://api.deepseek.com`
- `AI_CHAT_MODEL=deepseek-v4-flash`
- `DEEPSEEK_API_KEY`：只以 Secret 保存，用于对检索到的企业证据生成回答。

免费检索链路不依赖额外云密钥：浏览器使用 `Xenova/paraphrase-multilingual-MiniLM-L12-v2` 生成 384 维中文语义向量，D1 保存切片、向量和版本；图片及扫描 PDF 使用 Tesseract.js 在浏览器本地执行中英文 OCR。原始文件写入 R2，OCR 图片和待检索正文不会发送给第三方 OCR 服务。

首次使用语义检索时浏览器需要联网下载本地模型，之后由浏览器缓存复用。未配置 DeepSeek 密钥时，权限过滤、关键词/向量检索、引用和审计仍可用，仅不调用大模型组织回答。

`OPENAI_API_KEY`、`OPENAI_CHAT_MODEL`、`OPENAI_EMBEDDING_MODEL` 仅为兼容旧部署的可选回退，不是当前免费组合的必需项。

## 发布

1. 安装依赖并执行 `npm test`。
2. 执行 `npm run db:generate`，人工检查迁移 SQL。
3. 保存代码版本并由 Sites 发布。
4. 发布平台自动应用 D1 迁移并绑定 R2。
5. 使用三类测试账号分别验证列表、详情、下载、编辑和审批权限。
6. 至少用文本、DOCX、文本 PDF、扫描 PDF、图片各上传一份，检查解析状态、语义索引状态、发布后检索和引用跳转。

## 备份和恢复

- 定期导出 D1 数据库并保留迁移历史。
- 对 R2 开启对象版本或定期复制到备份桶。
- 恢复时先恢复数据库，再恢复对应 `source_key` 文件对象。
- 恢复和全量导出操作必须写入审计日志。

## 自托管说明

若必须使用 Docker Compose，需要把 Workers API 迁移为常驻 Node 服务，并用 PostgreSQL、MinIO 和企业身份提供商替换 D1、R2 和 Sites 登录。这属于独立架构版本，不能把当前边缘运行包直接包装成容器。
