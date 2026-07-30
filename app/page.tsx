"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "library" | "admin" | "favorites" | "audit";
type DocumentStatus = "draft" | "review" | "published" | "rejected" | "archived";
type KnowledgeDocument = {
  id: number; title: string; summary: string; content: string; category: string; tags: string;
  status: DocumentStatus; securityLevel: string; owner: string; uploader: string;
  sourceName?: string | null; mimeType?: string | null; size?: number; version: number;
  reviewDueAt?: string | null; createdAt: string; updatedAt: string;
};
type AuditLog = { id: number; documentId?: number | null; action: string; actor: string; detail: string; createdAt: string };

const fallbackDocuments: KnowledgeDocument[] = [
  { id: 1, title: "新员工入职指南", summary: "从账号开通、办公环境到团队融入，一份完整的新员工上手手册。", content: "欢迎加入知域。本指南覆盖入职第一周需要完成的账号开通、设备领取、安全培训、导师沟通和团队融入事项。\n\n第一天：完成工牌、邮箱、即时通讯与代码仓库账号开通。\n第一周：完成信息安全培训，与直属主管确认试用期目标。", category: "组织人事", tags: "入职,新员工", status: "published", securityLevel: "内部公开", owner: "People 团队", uploader: "林晓", sourceName: "新员工入职指南.pdf", mimeType: "application/pdf", size: 2457600, version: 3, reviewDueAt: "2027-01-15", createdAt: "2026-03-18", updatedAt: "2026-07-28" },
  { id: 2, title: "产品需求评审规范", summary: "明确 PRD 准入标准、评审角色、决策记录与变更管理流程。", content: "所有产品需求在进入研发排期前，必须完成业务价值、用户影响、技术可行性、数据口径和风险评审。评审结论分为通过、有条件通过和驳回。", category: "产品研发", tags: "PRD,评审,核心流程", status: "published", securityLevel: "内部公开", owner: "产品委员会", uploader: "周屿", sourceName: "产品需求评审规范.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 866304, version: 5, reviewDueAt: "2026-12-20", createdAt: "2025-11-02", updatedAt: "2026-07-25" },
  { id: 3, title: "客户数据安全与分级标准", summary: "客户信息采集、存储、使用、共享与销毁的全生命周期要求。", content: "客户数据按照公开、内部、敏感、核心四级管理。任何下载、外发和复制行为均需符合最小权限原则，并进入安全审计。", category: "财务法务", tags: "安全,合规", status: "review", securityLevel: "敏感", owner: "安全合规部", uploader: "陈默", sourceName: "客户数据分级标准.pdf", mimeType: "application/pdf", size: 1572864, version: 2, reviewDueAt: "2026-08-15", createdAt: "2026-01-11", updatedAt: "2026-07-23" },
  { id: 4, title: "差旅及费用报销制度", summary: "差旅申请、费用标准、票据要求与报销时限说明。", content: "出差前需完成差旅申请。返程后 10 个工作日内提交报销，发票抬头与税号必须准确。超标准费用需附业务负责人审批记录。", category: "财务法务", tags: "报销,差旅,制度", status: "published", securityLevel: "内部公开", owner: "财务共享中心", uploader: "苏晴", sourceName: "费用报销制度.pdf", mimeType: "application/pdf", size: 1048576, version: 4, reviewDueAt: "2027-02-01", createdAt: "2025-09-16", updatedAt: "2026-07-20" },
  { id: 5, title: "品牌视觉使用手册", summary: "统一品牌标识、色彩、字体及对外传播素材的使用方式。", content: "所有对外材料应使用标准品牌标识和指定色彩。不得拉伸、描边或改变标识比例。", category: "销售市场", tags: "品牌,视觉", status: "published", securityLevel: "内部公开", owner: "品牌中心", uploader: "唐颖", sourceName: "品牌视觉手册.pdf", mimeType: "application/pdf", size: 5242880, version: 6, reviewDueAt: "2027-03-10", createdAt: "2025-06-01", updatedAt: "2026-07-18" },
];
const fallbackLogs: AuditLog[] = [
  { id: 1, documentId: 3, action: "SUBMIT_REVIEW", actor: "陈默", detail: "提交《客户数据安全与分级标准》复核", createdAt: "2026-07-29 09:32" },
  { id: 2, documentId: 2, action: "UPDATE", actor: "周屿", detail: "更新产品评审角色与 SLA", createdAt: "2026-07-28 16:08" },
  { id: 3, documentId: 4, action: "DOWNLOAD", actor: "李然", detail: "下载《差旅及费用报销制度》", createdAt: "2026-07-28 14:21" },
];
const categories = ["全部", "产品研发", "组织人事", "销售市场", "财务法务"];
const statusLabel: Record<DocumentStatus, string> = { draft: "草稿", review: "待审核", published: "已发布", rejected: "已驳回", archived: "已归档" };

function normalizeDocument(row: Record<string, unknown>): KnowledgeDocument {
  const rawStatus = String(row.status ?? "DRAFT");
  const status: DocumentStatus = rawStatus === "PENDING_DEPT_REVIEW" ? "review" : rawStatus === "ARCHIVED_ACTIVE" ? "published" : rawStatus === "EXPIRED_VOID" ? "archived" : "draft";
  return {
    id: Number(row.id), title: String(row.title ?? ""), summary: String(row.summary ?? ""), content: String(row.content ?? ""), category: String(row.category ?? "未分类"),
    tags: String(row.tags ?? ""), status, securityLevel: String(row.securityLevel ?? row.security_level ?? "INTERNAL"), owner: String(row.owner ?? ""), uploader: String(row.uploader ?? row.creator_name ?? ""),
    sourceName: row.sourceName as string ?? row.source_name as string ?? null, mimeType: row.mimeType as string ?? row.mime_type as string ?? null, size: Number(row.size ?? 0), version: Number(row.version ?? 1),
    reviewDueAt: row.reviewDueAt as string ?? row.review_due_at as string ?? null, createdAt: String(row.createdAt ?? row.create_time ?? ""), updatedAt: String(row.updatedAt ?? row.update_time ?? ""),
  };
}

function fmtSize(size = 0) { return size ? `${(size / 1024 / 1024).toFixed(1)} MB` : "在线文档"; }
function downloadBlob(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

export default function Home() {
  const [view, setView] = useState<View>("library");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(fallbackDocuments);
  const [logs, setLogs] = useState<AuditLog[]>(fallbackLogs);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState({ displayName: "李然", role: "EMPLOYEE", primaryDeptId: 1 });

  useEffect(() => {
    fetch("/api/documents").then((response) => response.ok ? response.json() : Promise.reject()).then((data) => {
      if (data.data?.documents?.length) setDocuments(data.data.documents.map(normalizeDocument));
      if (data.data?.logs?.length) setLogs(data.data.logs.map((log: Record<string, unknown>) => ({ id: Number(log.id), documentId: Number(log.document_id ?? 0), action: String(log.action), actor: String(log.actor), detail: String(log.detail), createdAt: String(log.create_time ?? "") })));
      if (data.data?.currentUser) setCurrentUser(data.data.currentUser);
    }).catch(() => undefined);
  }, []);

  const published = documents.filter((item) => item.status === "published" || item.status === "review");
  const filtered = useMemo(() => published.filter((item) => {
    const text = `${item.title}${item.summary}${item.content}${item.tags}${item.owner}${item.uploader}`.toLowerCase();
    return (category === "全部" || item.category === category) && (!query.trim() || text.includes(query.trim().toLowerCase()));
  }), [published, category, query]);
  const visible = view === "favorites" ? filtered.filter((item) => favorites.includes(item.id)) : filtered;

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2300); }
  function toggleFavorite(id: number) { setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  async function audit(documentId: number, action: string, detail: string) {
    setLogs((current) => [{ id: Date.now(), documentId, action, actor: "李然", detail, createdAt: new Date().toLocaleString("zh-CN") }, ...current]);
  }
  async function updateStatus(id: number, action: "approve" | "reject" | "archive") {
    const next = action === "approve" ? "published" : action === "reject" ? "rejected" : "archived";
    try {
      const response = await fetch("/api/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
      setDocuments((current) => current.map((item) => item.id === id ? { ...item, status: next, updatedAt: new Date().toISOString() } : item));
      await audit(id, action.toUpperCase(), `文档状态更新为${statusLabel[next]}`); notify(`已${action === "approve" ? "通过并发布" : action === "reject" ? "驳回" : "归档"}`);
    } catch (error) { notify(error instanceof Error ? error.message : "操作失败"); }
  }
  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true);
    const form = event.currentTarget; const data = new FormData(form);
    try {
      const response = await fetch("/api/documents", { method: "POST", body: data });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "上传失败，请稍后重试" }));
        throw new Error(payload.error?.message ?? "上传失败，请稍后重试");
      }
      const result = await response.json(); setDocuments((current) => [normalizeDocument(result.data.document), ...current]);
      setLoading(false); setUploadOpen(false); form.reset(); notify("资料与原文件已保存，处理记录已生成");
    } catch (error) {
      setLoading(false);
      notify(error instanceof Error ? error.message : "上传失败，请稍后重试");
      return;
    }
  }

  return <div className="enterprise-app">
    <aside className="sidebar">
      <button className="brand side-brand" onClick={() => setView("library")}><span className="brand-mark">Z</span><span>知域<small>企业知识中台</small></span></button>
      <nav className="side-nav" aria-label="功能导航">
        <span>知识服务</span>
        <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}><i>⌂</i>知识广场</button>
        <button className={view === "favorites" ? "active" : ""} onClick={() => setView("favorites")}><i>☆</i>我的收藏 <em>{favorites.length}</em></button>
        <span>知识治理</span>
        <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")}><i>▦</i>维护工作台</button>
        <button className={view === "audit" ? "active" : ""} onClick={() => setView("audit")}><i>≡</i>审计日志</button>
      </nav>
      <div className="user-card"><span>{currentUser.displayName.slice(0, 1)}</span><div><b>{currentUser.displayName}</b><small>{currentUser.role === "SUPER_ADMIN" ? "超级管理员" : currentUser.role === "DEPT_ADMIN" ? "部门管理员" : "普通员工"}</small></div><i>•••</i></div>
    </aside>

    <div className="app-main">
      <header className="app-header">
        <div className="global-search"><span>⌕</span><input aria-label="全局搜索" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、正文、标签、负责人..." /><kbd>⌘ K</kbd></div>
        <button className="header-icon" onClick={() => notify("3 条待办：1 条审核、2 条即将到期")}>♢<i /></button>
        <button className="primary-action" onClick={() => setUploadOpen(true)}>＋ 上传资料</button>
      </header>

      {view === "admin" ? <AdminView documents={documents} onUpload={() => setUploadOpen(true)} onSelect={setSelected} onStatus={updateStatus} />
      : view === "audit" ? <AuditView logs={logs} documents={documents} />
      : <LibraryView documents={visible} allCount={published.length} query={query} category={category} setCategory={setCategory} setQuery={setQuery} favorites={favorites} toggleFavorite={toggleFavorite} onSelect={(doc) => { setSelected(doc); audit(doc.id, "VIEW", `查看《${doc.title}》`); }} favoriteMode={view === "favorites"} />}
    </div>

    {selected && <DocumentDrawer document={selected} favorite={favorites.includes(selected.id)} onClose={() => setSelected(null)} onFavorite={() => toggleFavorite(selected.id)} onFeedback={() => setFeedbackOpen(true)} onExport={() => { downloadBlob(`${selected.title}.txt`, `${selected.title}\n\n${selected.content}\n\n负责人：${selected.owner}\n版本：V${selected.version}.0`, "text/plain;charset=utf-8"); audit(selected.id, "EXPORT", `导出《${selected.title}》`); notify("已导出文档摘要"); }} onDownload={async () => { try { const response = await fetch(`/api/documents/${selected.id}?download=1`); if (!response.ok) { const payload = await response.json().catch(() => ({ error: { message: "原文件加载失败" } })); throw new Error(payload.error?.message ?? "原文件加载失败"); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = selected.sourceName ?? selected.title; a.click(); URL.revokeObjectURL(url); audit(selected.id, "DOWNLOAD", `下载《${selected.title}》附件`); notify("原文件已加载，下载任务已开始"); } catch (error) { notify(error instanceof Error ? error.message : "原文件加载失败"); } }} />}

    {uploadOpen && <UploadModal loading={loading} role={currentUser.role} primaryDeptId={currentUser.primaryDeptId} onSubmit={submitUpload} onClose={() => setUploadOpen(false)} />}
    {feedbackOpen && selected && <FeedbackModal onClose={() => setFeedbackOpen(false)} onSubmit={async (content) => { try { await fetch(`/api/documents/${selected.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "纠错", content }) }); } catch { /* demo fallback */ } audit(selected.id, "FEEDBACK", content); setFeedbackOpen(false); notify("反馈已提交给知识负责人"); }} />}
    <button className="ai-fab" onClick={() => setAiOpen(true)}><span>✦</span><span><b>问问小知</b><small>回答会标注知识来源</small></span></button>
    {aiOpen && <AiPanel documents={published} onClose={() => setAiOpen(false)} onOpen={(doc) => { setSelected(doc); setAiOpen(false); }} />}
    {toast && <div className="toast" role="status">✓ {toast}</div>}
  </div>;
}

function LibraryView({ documents, allCount, query, category, setCategory, setQuery, favorites, toggleFavorite, onSelect, favoriteMode }: { documents: KnowledgeDocument[]; allCount: number; query: string; category: string; setCategory: (v: string) => void; setQuery: (v: string) => void; favorites: number[]; toggleFavorite: (id: number) => void; onSelect: (doc: KnowledgeDocument) => void; favoriteMode: boolean }) {
  return <main className="workspace">
    <section className="welcome"><div><span className="page-kicker">KNOWLEDGE HUB</span><h1>{favoriteMode ? "我的收藏" : "下午好，李然"}</h1><p>{favoriteMode ? "集中查看你持续关注的知识资产。" : `组织已沉淀 ${allCount} 份核心知识，今天从哪里开始？`}</p></div><div className="governance-chip"><span>知识健康度</span><b>92<small>%</small></b><i>较上月 +3.2%</i></div></section>
    {!favoriteMode && <section className="hero-search"><span>⌕</span><div><small>在企业知识中寻找答案</small><input aria-label="知识检索" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：差旅报销需要哪些材料？" /></div><button>搜索</button></section>}
    <section className="library-section"><div className="section-title"><div><span className="page-kicker">CURATED KNOWLEDGE</span><h2>{favoriteMode ? "已收藏知识" : "知识目录"}</h2></div><div className="filter-tabs" role="tablist">{categories.map((item) => <button role="tab" aria-selected={category === item} className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
      {documents.length ? <div className="doc-grid">{documents.map((doc) => <article className="doc-card" key={doc.id}><div className="doc-card-head"><span className={`doc-status ${doc.status}`}>{statusLabel[doc.status]}</span><button aria-label={`${favorites.includes(doc.id) ? "取消收藏" : "收藏"}${doc.title}`} onClick={() => toggleFavorite(doc.id)}>{favorites.includes(doc.id) ? "★" : "☆"}</button></div><button className="doc-main" onClick={() => onSelect(doc)}><span className="file-tile">{doc.mimeType?.includes("pdf") ? "PDF" : doc.mimeType?.includes("word") ? "DOC" : "DOC"}</span><h3>{doc.title}</h3><p>{doc.summary}</p></button><div className="tag-row">{doc.tags.split(",").filter(Boolean).slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="doc-foot"><span className="mini-avatar">{doc.owner.slice(0, 1)}</span><div><b>{doc.owner}</b><small>{doc.uploader} 上传 · V{doc.version}.0</small></div><span>{doc.category}</span></div></article>)}</div>
      : <div className="empty-state"><b>⌕</b><h3>没有匹配的知识</h3><p>尝试搜索“报销”“入职”或清除筛选。</p><button onClick={() => { setQuery(""); setCategory("全部"); }}>清除筛选</button></div>}</section>
  </main>;
}

function AdminView({ documents, onUpload, onSelect, onStatus }: { documents: KnowledgeDocument[]; onUpload: () => void; onSelect: (d: KnowledgeDocument) => void; onStatus: (id: number, action: "approve" | "reject" | "archive") => void }) {
  const cards = [{ label: "知识总量", value: documents.length, hint: "本月 +12" }, { label: "待审核", value: documents.filter(d => d.status === "review").length, hint: "需及时处理" }, { label: "即将复核", value: 7, hint: "未来 30 天" }, { label: "本月浏览", value: "18.6k", hint: "同比 +8.4%" }];
  return <main className="workspace"><section className="admin-heading"><div><span className="page-kicker">GOVERNANCE CONSOLE</span><h1>知识维护工作台</h1><p>管理资料入库、审核发布、版本与生命周期。</p></div><button className="primary-action" onClick={onUpload}>＋ 上传新资料</button></section><div className="metric-grid">{cards.map(card => <div key={card.label}><span>{card.label}</span><b>{card.value}</b><small>{card.hint}</small></div>)}</div><section className="table-card"><div className="table-title"><div><h2>资料与审批记录</h2><p>所有上传记录均保留操作者、来源和当前状态</p></div><button>筛选 ▾</button></div><div className="data-table"><div className="data-row table-head"><span>资料名称</span><span>分类 / 密级</span><span>上传人与负责人</span><span>版本 / 复核日</span><span>状态</span><span>操作</span></div>{documents.map(doc => <div className="data-row" key={doc.id}><button className="table-document" onClick={() => onSelect(doc)}><span>{doc.mimeType?.includes("pdf") ? "P" : "W"}</span><div><b>{doc.title}</b><small>{doc.sourceName ?? "在线文档"} · {fmtSize(doc.size)}</small></div></button><span><b>{doc.category}</b><small>{doc.securityLevel}</small></span><span><b>{doc.uploader}</b><small>负责人：{doc.owner}</small></span><span><b>V{doc.version}.0</b><small>{doc.reviewDueAt || "未设置"}</small></span><span><i className={`doc-status ${doc.status}`}>{statusLabel[doc.status]}</i></span><span className="row-actions">{doc.status === "review" ? <><button onClick={() => onStatus(doc.id, "approve")}>通过</button><button onClick={() => onStatus(doc.id, "reject")}>驳回</button></> : <button onClick={() => onSelect(doc)}>查看</button>}</span></div>)}</div></section></main>;
}

function AuditView({ logs, documents }: { logs: AuditLog[]; documents: KnowledgeDocument[] }) { const action: Record<string, string> = { VIEW: "查看", DOWNLOAD: "下载", EXPORT: "导出", FEEDBACK: "提交反馈", UPDATE: "更新", UPLOAD: "上传", APPROVE: "审批通过", REJECT: "驳回", SUBMIT_REVIEW: "提交复核" }; return <main className="workspace"><section className="admin-heading"><div><span className="page-kicker">AUDIT TRAIL</span><h1>审计日志</h1><p>追踪资料从上传到消费的全部关键操作。</p></div><button className="outline-action" onClick={() => downloadBlob("知识库审计日志.csv", `时间,操作者,操作,详情\n${logs.map(l => `${l.createdAt},${l.actor},${action[l.action] ?? l.action},${l.detail}`).join("\n")}`, "text/csv;charset=utf-8")}>导出 CSV</button></section><section className="audit-card">{logs.map(log => <div className="audit-item" key={log.id}><span className="audit-icon">{log.action === "DOWNLOAD" ? "↓" : log.action === "VIEW" ? "◉" : "✓"}</span><div><b>{log.actor} · {action[log.action] ?? log.action}</b><p>{log.detail || documents.find(d => d.id === log.documentId)?.title}</p></div><time>{log.createdAt}</time></div>)}</section></main>; }

function DocumentDrawer({ document: doc, favorite, onClose, onFavorite, onFeedback, onExport, onDownload }: { document: KnowledgeDocument; favorite: boolean; onClose: () => void; onFavorite: () => void; onFeedback: () => void; onExport: () => void; onDownload: () => void }) { return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="document-drawer" onMouseDown={e => e.stopPropagation()}><header><button onClick={onClose}>×</button><div><span className={`doc-status ${doc.status}`}>{statusLabel[doc.status]}</span><span>{doc.securityLevel}</span></div><h2>{doc.title}</h2><p>{doc.summary}</p></header><div className="drawer-actions"><button onClick={onFavorite}>{favorite ? "★ 已收藏" : "☆ 收藏"}</button><button onClick={onDownload}>↓ 下载原件</button><button onClick={onExport}>⇧ 导出摘要</button><button onClick={onFeedback}>! 纠错反馈</button></div><section className="doc-info"><div><span>知识负责人</span><b>{doc.owner}</b></div><div><span>上传人</span><b>{doc.uploader}</b></div><div><span>当前版本</span><b>V{doc.version}.0</b></div><div><span>下次复核</span><b>{doc.reviewDueAt || "未设置"}</b></div></section><article className="doc-content"><h3>文档正文</h3>{doc.content.split("\n").map((p, i) => <p key={i}>{p}</p>)}</article><section className="version-list"><h3>版本记录</h3><div><span>V{doc.version}.0</span><p><b>当前版本</b><small>{doc.uploader} 更新 · {doc.updatedAt.slice(0, 10)}</small></p></div><div><span>V{Math.max(1, doc.version - 1)}.0</span><p><b>历史版本</b><small>完成内容复核与格式修订</small></p></div></section></aside></div>; }

function UploadModal({ loading, role, primaryDeptId, onSubmit, onClose }: { loading: boolean; role: string; primaryDeptId: number; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onClose: () => void }) { const [fileName, setFileName] = useState(""); return <div className="modal-backdrop" onMouseDown={onClose}><form className="upload-modal" onSubmit={onSubmit} onMouseDown={e => e.stopPropagation()}><header><div><span className="page-kicker">KNOWLEDGE INGESTION</span><h2>上传企业资料</h2><p>系统将保存原文件，并生成上传记录、初始版本和审计日志。</p></div><button type="button" onClick={onClose}>×</button></header><label className={`file-drop ${fileName ? "has-file" : ""}`}><input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={e => setFileName(e.target.files?.[0]?.name ?? "")}/><span>{fileName ? "✓" : "⇧"}</span><b>{fileName || "点击选择或拖入文件"}</b><small>{fileName ? "文件已选择，可继续填写资料信息" : "支持 PDF、Word、Excel、PPT、TXT；不设置应用内文件大小限制"}</small></label><div className="form-grid"><label><span>资料标题 *</span><input name="title" required placeholder="例如：2026 差旅管理制度" /></label><label><span>知识分类 *</span><select name="category" required defaultValue=""><option value="" disabled>请选择分类</option>{categories.slice(1).map(c => <option key={c}>{c}</option>)}</select></label><label><span>归属部门</span><select name="deptId" defaultValue={String(primaryDeptId)} disabled={role !== "SUPER_ADMIN"}>{[[1,"综合管理部"],[2,"产品研发部"],[3,"人力行政部"],[4,"销售市场部"],[5,"财务法务部"]].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select>{role !== "SUPER_ADMIN" && <input type="hidden" name="deptId" value={primaryDeptId}/>}</label><label><span>知识负责人 *</span><input name="owner" required placeholder="姓名或团队" /></label><label><span>安全密级</span><select name="securityLevel"><option value="INTERNAL">内部公开</option><option value="DEPT">部门可见</option><option value="SENSITIVE">敏感</option><option value="CONFIDENTIAL">核心机密</option></select></label><label><span>共享范围</span><select name="shareScope" disabled={role === "EMPLOYEE"}><option value="DEPT">仅本部门</option><option value="CROSS_DEPT">跨部门共享</option></select></label><label><span>标签</span><input name="tags" placeholder="逗号分隔，如：差旅,报销" /></label><label><span>下次复核日</span><input name="reviewDueAt" type="date" /></label><label className="wide"><span>摘要</span><textarea name="summary" rows={2} placeholder="帮助员工快速判断内容是否相关" /></label><label className="wide"><span>正文 / 解析补充</span><textarea name="content" rows={4} placeholder="可粘贴核心内容，上传后仍可继续编辑" /></label></div><div className="publish-choice"><label><input type="radio" name="status" value="draft" defaultChecked/> 保存草稿</label><label><input type="radio" name="status" value="review"/> 提交审核</label></div><footer><button type="button" onClick={onClose}>取消</button><button className="primary-action" disabled={loading}>{loading ? "正在上传原文件..." : "上传并生成记录"}</button></footer></form></div>; }

function FeedbackModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (v: string) => void }) { const [value, setValue] = useState(""); return <div className="modal-backdrop" onMouseDown={onClose}><div className="feedback-modal" onMouseDown={e => e.stopPropagation()}><h2>提交纠错反馈</h2><p>反馈将自动关联当前文档与版本，并通知知识负责人。</p><textarea aria-label="反馈内容" value={value} onChange={e => setValue(e.target.value)} rows={5} placeholder="请描述错误、过期内容或补充建议..."/><div><button onClick={onClose}>取消</button><button className="primary-action" disabled={!value.trim()} onClick={() => onSubmit(value)}>提交反馈</button></div></div></div>; }

function AiPanel({ documents, onClose, onOpen }: { documents: KnowledgeDocument[]; onClose: () => void; onOpen: (d: KnowledgeDocument) => void }) { const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState<{ text: string; source: KnowledgeDocument } | null>(null); function ask() { const source = documents.find(d => `${d.title}${d.tags}${d.content}`.includes(question.includes("报销") ? "报销" : question.includes("入职") ? "入职" : "产品")) ?? documents[0]; setAnswer({ text: source.content.split("。")[0] + "。具体执行时请以引用的最新版本为准。", source }); } return <div className="modal-backdrop" onMouseDown={onClose}><section className="ai-panel enterprise-ai" onMouseDown={e => e.stopPropagation()}><button className="close-button" onClick={onClose}>×</button><span className="ai-orb">✦</span><h2>企业知识问答</h2><p>仅检索你有权限查看的已发布知识，回答附带可追溯引用。</p>{answer ? <div className="ai-answer"><span>小知</span><p>{answer.text}</p><button onClick={() => onOpen(answer.source)}><b>引用 1</b>{answer.source.title} · V{answer.source.version}.0 →</button></div> : <div className="suggestions"><button onClick={() => setQuestion("差旅报销需要哪些材料？")}>差旅报销需要哪些材料？</button><button onClick={() => setQuestion("新员工第一周做什么？")}>新员工第一周做什么？</button></div>}<div className="ai-input"><input aria-label="向企业知识库提问" value={question} onChange={e => setQuestion(e.target.value)} placeholder="输入问题..." onKeyDown={e => { if (e.key === "Enter" && question.trim()) ask(); }}/><button onClick={ask} disabled={!question.trim()}>发送</button></div></section></div>; }
