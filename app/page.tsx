"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type View = "library" | "admin" | "favorites" | "audit" | "accounts";
type DocumentStatus = "draft" | "review" | "published" | "rejected" | "archived";
type KnowledgeDocument = {
  id: number; title: string; summary: string; content: string; category: string; tags: string;
  status: DocumentStatus; securityLevel: string; owner: string; uploader: string;
  sourceName?: string | null; sourceKey?: string | null; mimeType?: string | null; size?: number; version: number;
  reviewDueAt?: string | null; createdAt: string; updatedAt: string; versions?: DocumentVersion[];
};
type DocumentVersion = { id: number; version: number; changeNote: string; operator: string; createdAt: string };
type AuditLog = { id: number; documentId?: number | null; action: string; actor: string; detail: string; createdAt: string };
type GovernanceTask = { id: number; reason: string; detail: string; documentTitle: string; reporter: string; createdAt: string };
type UploadDepartment = { id: number; code: string; name: string; parent_id?: number | null; approver: string };
type UploadMember = { id: number; dept_id: number; display_name: string };
type UploadOptions = { departments: UploadDepartment[]; members: UploadMember[] };
type CurrentUser = { userId?: number; email: string; displayName: string; role: string; primaryDeptId: number };
type EnterpriseAccount = { id:number; email:string; display_name:string; status:string; identity_provider:string; last_login_time?:string|null; role:string; departments:string; primary_dept_id:number };

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
    sourceName: row.sourceName as string ?? row.source_name as string ?? null, sourceKey: row.sourceKey as string ?? row.source_key as string ?? null, mimeType: row.mimeType as string ?? row.mime_type as string ?? null, size: Number(row.size ?? 0), version: Number(row.version ?? 1),
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
  const [governanceTasks, setGovernanceTasks] = useState<GovernanceTask[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser>({ email: "", displayName: "正在识别账号", role: "EMPLOYEE", primaryDeptId: 1 });
  const [authError, setAuthError] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [uploadOptions, setUploadOptions] = useState<UploadOptions>({ departments: [{ id: 1, code: "GENERAL", name: "综合管理部", approver: "待配置部门管理员" }], members: [] });
  const hasOpenOverlay = aiOpen || uploadOpen || feedbackOpen || selected !== null;

  useEffect(() => {
    if (!hasOpenOverlay) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [hasOpenOverlay]);

  useEffect(() => {
    fetch("/api/documents", { cache: "no-store" }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "账号加载失败"); return payload; }).then((data) => {
      if (data.data?.documents?.length) setDocuments(data.data.documents.map(normalizeDocument));
      if (data.data?.logs?.length) setLogs(data.data.logs.map((log: Record<string, unknown>) => ({ id: Number(log.id), documentId: Number(log.document_id ?? 0), action: String(log.action), actor: String(log.actor), detail: String(log.detail), createdAt: String(log.create_time ?? "") })));
      if (data.data?.governanceTasks) setGovernanceTasks(data.data.governanceTasks.map((task: Record<string, unknown>) => ({ id: Number(task.id), reason: String(task.reason), detail: String(task.detail ?? ""), documentTitle: String(task.document_title ?? "未关联具体文档"), reporter: String(task.reporter), createdAt: String(task.create_time) })));
      if (data.data?.currentUser) setCurrentUser(data.data.currentUser);
      if (data.data?.uploadOptions?.departments?.length) setUploadOptions(data.data.uploadOptions);
    }).catch(async (error) => { setAuthError(error instanceof Error ? error.message : "账号加载失败"); });
  }, []);
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("document")); if (!id) return;
    openDocument(id).catch(() => undefined);
  }, []);

  const published = documents.filter((item) => item.status === "published");
  const filtered = useMemo(() => published.filter((item) => {
    const text = `${item.title}${item.summary}${item.content}${item.tags}${item.owner}${item.uploader}`.toLowerCase();
    return (category === "全部" || item.category === category) && (!query.trim() || text.includes(query.trim().toLowerCase()));
  }), [published, category, query]);
  const visible = view === "favorites" ? filtered.filter((item) => favorites.includes(item.id)) : filtered;

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2300); }
  async function refreshGovernanceTasks() { const response = await fetch("/api/documents", { cache: "no-store" }); const payload = await response.json(); if (response.ok && payload.data?.governanceTasks) setGovernanceTasks(payload.data.governanceTasks.map((task: Record<string, unknown>) => ({ id: Number(task.id), reason: String(task.reason), detail: String(task.detail ?? ""), documentTitle: String(task.document_title ?? "未关联具体文档"), reporter: String(task.reporter), createdAt: String(task.create_time) }))); }
  async function openDocument(documentOrId: KnowledgeDocument | number) {
    const id = typeof documentOrId === "number" ? documentOrId : documentOrId.id;
    const response = await fetch(`/api/documents/${id}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "资料加载失败");
    const detail = normalizeDocument(payload.data.document);
    if (typeof documentOrId !== "number") detail.tags = documentOrId.tags;
    detail.versions = (payload.data.versions ?? []).map((row: Record<string, unknown>) => ({ id: Number(row.id), version: Number(row.version), changeNote: String(row.change_note ?? ""), operator: String(row.operator ?? ""), createdAt: String(row.create_time ?? "") }));
    setSelected(detail);
  }
  function toggleFavorite(id: number) { setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  async function audit(documentId: number, action: string, detail: string) {
    setLogs((current) => [{ id: Date.now(), documentId, action, actor: currentUser.displayName, detail, createdAt: new Date().toLocaleString("zh-CN") }, ...current]);
  }
  async function updateStatus(id: number, action: "submit" | "approve" | "reject" | "archive") {
    const next: DocumentStatus = action === "submit" ? "review" : action === "approve" ? "published" : action === "reject" ? "draft" : "archived";
    try {
      const response = await fetch("/api/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
      setDocuments((current) => current.map((item) => item.id === id ? { ...item, status: next, updatedAt: new Date().toISOString() } : item));
      await audit(id, action.toUpperCase(), `文档状态更新为${statusLabel[next]}`); notify(action === "submit" ? "已提交部门管理员审核" : action === "approve" ? "审批通过，已进入知识目录" : action === "reject" ? "已驳回至草稿" : "已归档作废");
    } catch (error) { notify(error instanceof Error ? error.message : "操作失败"); }
  }
  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true);
    const form = event.currentTarget; const data = new FormData(form);
    try {
      const file = data.get("file");
      let stored: Record<string, unknown> = {};
      if (file instanceof File && file.size > 0) {
        const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
        const textLike = file.type.startsWith("text/") || ["txt", "md", "csv", "json", "xml", "yaml", "yml", "log"].includes(extension);
        if (textLike && !String(data.get("content") ?? "").trim()) {
          const extracted = await file.text();
          data.set("content", extracted.slice(0, 50000));
          if (!String(data.get("summary") ?? "").trim()) data.set("summary", extracted.replace(/\s+/g, " ").trim().slice(0, 180));
        }
        const uploadResponse = await fetch("/api/uploads", { method: "PUT", headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name), "x-dept-id": String(data.get("deptId") || currentUser.primaryDeptId) }, body: file });
        const uploadPayload = await uploadResponse.json().catch(() => ({ error: { message: "原文件存储失败" } }));
        if (!uploadResponse.ok) throw new Error(uploadPayload.error?.message ?? "原文件存储失败");
        stored = uploadPayload.data;
      }
      const metadata = Object.fromEntries(Array.from(data.entries()).filter(([key]) => key !== "file"));
      const response = await fetch("/api/documents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...metadata, ...stored }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "上传失败，请稍后重试" }));
        throw new Error(payload.error?.message ?? "上传失败，请稍后重试");
      }
      const result = await response.json();
      const created = normalizeDocument(result.data.document);
      setDocuments((current) => [created, ...current.filter(item => item.id !== created.id)]);
      setView("admin"); setLoading(false); setUploadOpen(false); form.reset();
      const refreshed = await fetch("/api/documents", { cache: "no-store" }).then(item => item.ok ? item.json() : null).catch(() => null);
      if (refreshed?.data?.documents) setDocuments(refreshed.data.documents.map(normalizeDocument));
      if (refreshed?.data?.logs) setLogs(refreshed.data.logs.map((log: Record<string, unknown>) => ({ id: Number(log.id), documentId: Number(log.document_id ?? 0), action: String(log.action), actor: String(log.actor), detail: String(log.detail), createdAt: String(log.create_time ?? "") })));
      notify(created.status === "review" ? "资料已进入维护工作台，部门审核通过后进入知识目录" : "草稿已进入维护工作台，提交并审核通过后进入知识目录");
    } catch (error) {
      setLoading(false);
      notify(error instanceof Error ? error.message : "上传失败，请稍后重试");
      return;
    }
  }
  async function engageDocument(document: KnowledgeDocument, action: "SHARE" | "SUBSCRIBE" | "CONTACT_OWNER") {
    try {
      if (action === "SHARE") await navigator.clipboard.writeText(`${window.location.origin}/?document=${document.id}`);
      const response = await fetch("/api/engagement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, documentId: document.id }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
      notify(action === "SHARE" ? "内部链接已复制，访问时仍会校验权限" : action === "SUBSCRIBE" ? "已订阅，资料更新时将收到提醒" : `已向负责人 ${document.owner} 发起联系`);
    } catch (error) { notify(error instanceof Error ? error.message : "操作失败"); }
  }

  if (authError) return <main className="access-state"><span className="brand-mark">Z</span><small>ENTERPRISE ACCESS</small><h1>账号暂不可访问</h1><p>{authError}</p><div><b>企业账号处理流程</b><span>身份已由统一登录识别</span><span>请联系知识库超级管理员分配部门与角色</span><span>配置完成后刷新页面即可进入</span></div><a href="/signout-with-chatgpt?return_to=/">切换登录账号</a></main>;
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
        {currentUser.role === "SUPER_ADMIN" && <button className={view === "accounts" ? "active" : ""} onClick={() => setView("accounts")}><i>♙</i>账号与权限</button>}
      </nav>
      <button className="user-card" onClick={() => setAccountMenuOpen(value => !value)}><span>{currentUser.displayName.slice(0, 1)}</span><div><b>{currentUser.displayName}</b><small>{currentUser.role === "SUPER_ADMIN" ? "超级管理员" : currentUser.role === "DEPT_ADMIN" ? "部门管理员" : "普通员工"}</small></div><i>•••</i></button>
      {accountMenuOpen && <div className="account-menu"><b>{currentUser.email}</b><span>身份来源：企业统一登录</span>{currentUser.role === "SUPER_ADMIN" && <button onClick={() => { setView("accounts"); setAccountMenuOpen(false); }}>账号与权限</button>}<a href="/signout-with-chatgpt?return_to=/">退出登录</a></div>}
    </aside>

    <div className="app-main">
      <header className="app-header">
        <div className="global-search"><span>⌕</span><input aria-label="全局搜索" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索标题、正文、标签、负责人..." /><kbd>⌘ K</kbd></div>
        <button className="header-icon" onClick={() => notify("3 条待办：1 条审核、2 条即将到期")}>♢<i /></button>
        <button className="primary-action" onClick={() => setUploadOpen(true)}>＋ 上传资料</button>
      </header>

      {view === "admin" ? <AdminView documents={documents} governanceTasks={governanceTasks} role={currentUser.role} onUpload={() => setUploadOpen(true)} onSelect={(doc) => openDocument(doc).catch(error => notify(error instanceof Error ? error.message : "资料加载失败"))} onStatus={updateStatus} />
      : view === "accounts" && currentUser.role === "SUPER_ADMIN" ? <AccountAdminView notify={notify} />
      : view === "audit" ? <AuditView logs={logs} documents={documents} />
      : <LibraryView currentUser={currentUser} documents={visible} allCount={published.length} query={query} category={category} setCategory={setCategory} setQuery={setQuery} favorites={favorites} toggleFavorite={toggleFavorite} onSelect={(doc) => { openDocument(doc).catch(error => notify(error instanceof Error ? error.message : "资料加载失败")); audit(doc.id, "VIEW", `查看《${doc.title}》`); }} favoriteMode={view === "favorites"} />}
    </div>

    {selected && <DocumentDrawer document={selected} favorite={favorites.includes(selected.id)} onClose={() => setSelected(null)} onFavorite={() => toggleFavorite(selected.id)} onFeedback={() => setFeedbackOpen(true)} onShare={() => engageDocument(selected, "SHARE")} onSubscribe={() => engageDocument(selected, "SUBSCRIBE")} onContact={() => engageDocument(selected, "CONTACT_OWNER")} onExport={() => { downloadBlob(`${selected.title}.txt`, `${selected.title}\n\n${selected.content}\n\n负责人：${selected.owner}\n版本：V${selected.version}.0`, "text/plain;charset=utf-8"); audit(selected.id, "EXPORT", `导出《${selected.title}》`); notify("已导出文档摘要"); }} onDownload={async () => { try { const response = await fetch(`/api/documents/${selected.id}?download=1`); if (!response.ok) { const payload = await response.json().catch(() => ({ error: { message: "原文件加载失败" } })); throw new Error(payload.error?.message ?? "原文件加载失败"); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = selected.sourceName ?? selected.title; a.click(); URL.revokeObjectURL(url); audit(selected.id, "DOWNLOAD", `下载《${selected.title}》附件`); notify("原文件已加载，下载任务已开始"); } catch (error) { notify(error instanceof Error ? error.message : "原文件加载失败"); } }} />}

    {uploadOpen && <UploadModal loading={loading} currentUser={currentUser} options={uploadOptions} onSubmit={submitUpload} onClose={() => setUploadOpen(false)} />}
    {feedbackOpen && selected && <FeedbackModal onClose={() => setFeedbackOpen(false)} onSubmit={async (content) => { try { await fetch(`/api/documents/${selected.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "纠错", content }) }); } catch { /* demo fallback */ } audit(selected.id, "FEEDBACK", content); setFeedbackOpen(false); notify("反馈已提交给知识负责人"); }} />}
    <button className="ai-fab" onClick={() => setAiOpen(true)}><span>✦</span><span><b>问问小知</b><small>回答会标注知识来源</small></span></button>
    {aiOpen && <AiPanel onClose={() => setAiOpen(false)} onGovernanceCreated={() => refreshGovernanceTasks().catch(() => undefined)} onOpen={async (documentId) => { try { await openDocument(documentId); setAiOpen(false); } catch (error) { notify(error instanceof Error ? error.message : "资料加载失败"); } }} />}
    {toast && <div className="toast" role="status">✓ {toast}</div>}
  </div>;
}

function LibraryView({ currentUser, documents, allCount, query, category, setCategory, setQuery, favorites, toggleFavorite, onSelect, favoriteMode }: { currentUser:CurrentUser; documents: KnowledgeDocument[]; allCount: number; query: string; category: string; setCategory: (v: string) => void; setQuery: (v: string) => void; favorites: number[]; toggleFavorite: (id: number) => void; onSelect: (doc: KnowledgeDocument) => void; favoriteMode: boolean }) {
  return <main className="workspace">
    <section className="welcome"><div><span className="page-kicker">KNOWLEDGE HUB</span><h1>{favoriteMode ? "我的收藏" : `你好，${currentUser.displayName}`}</h1><p>{favoriteMode ? "集中查看你持续关注的知识资产。" : `组织已沉淀 ${allCount} 份核心知识，今天从哪里开始？`}</p></div><div className="governance-chip"><span>知识健康度</span><b>92<small>%</small></b><i>较上月 +3.2%</i></div></section>
    {!favoriteMode && <section className="hero-search"><span>⌕</span><div><small>在企业知识中寻找答案</small><input aria-label="知识检索" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：差旅报销需要哪些材料？" /></div><button>搜索</button></section>}
    <section className="library-section"><div className="section-title"><div><span className="page-kicker">CURATED KNOWLEDGE</span><h2>{favoriteMode ? "已收藏知识" : "知识目录"}</h2></div><div className="filter-tabs" role="tablist">{categories.map((item) => <button role="tab" aria-selected={category === item} className={category === item ? "active" : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
      {documents.length ? <div className="doc-grid">{documents.map((doc) => <article className="doc-card" key={doc.id}><div className="doc-card-head"><span className={`doc-status ${doc.status}`}>{statusLabel[doc.status]}</span><button aria-label={`${favorites.includes(doc.id) ? "取消收藏" : "收藏"}${doc.title}`} onClick={() => toggleFavorite(doc.id)}>{favorites.includes(doc.id) ? "★" : "☆"}</button></div><button className="doc-main" onClick={() => onSelect(doc)}><span className="file-tile">{doc.mimeType?.includes("pdf") ? "PDF" : doc.mimeType?.includes("word") ? "DOC" : "DOC"}</span><h3>{doc.title}</h3><p>{doc.summary}</p></button><div className="tag-row">{doc.tags.split(",").filter(Boolean).slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="doc-foot"><span className="mini-avatar">{doc.owner.slice(0, 1)}</span><div><b>{doc.owner}</b><small>{doc.uploader} 上传 · V{doc.version}.0</small></div><span>{doc.category}</span></div></article>)}</div>
      : <div className="empty-state"><b>⌕</b><h3>没有匹配的知识</h3><p>尝试搜索“报销”“入职”或清除筛选。</p><button onClick={() => { setQuery(""); setCategory("全部"); }}>清除筛选</button></div>}</section>
  </main>;
}

function AdminView({ documents, governanceTasks, role, onUpload, onSelect, onStatus }: { documents: KnowledgeDocument[]; governanceTasks: GovernanceTask[]; role: string; onUpload: () => void; onSelect: (d: KnowledgeDocument) => void; onStatus: (id: number, action: "submit" | "approve" | "reject" | "archive") => void }) {
  const cards = [{ label: "知识总量", value: documents.length, hint: "权限范围内" }, { label: "待审核", value: documents.filter(d => d.status === "review").length, hint: "需及时处理" }, { label: "AI 待治理", value: governanceTasks.length, hint: "来自未解决问答" }, { label: "即将复核", value: 7, hint: "未来 30 天" }];
  const canApprove = role === "SUPER_ADMIN" || role === "DEPT_ADMIN";
  return <main className="workspace"><section className="admin-heading"><div><span className="page-kicker">GOVERNANCE CONSOLE</span><h1>知识维护工作台</h1><p>管理资料入库、审核发布、AI反馈、版本与生命周期。</p></div><button className="primary-action" onClick={onUpload}>＋ 上传新资料</button></section><div className="metric-grid">{cards.map(card => <div key={card.label}><span>{card.label}</span><b>{card.value}</b><small>{card.hint}</small></div>)}</div>{governanceTasks.length > 0 && <section className="governance-tasks"><div className="table-title"><div><h2>AI 问答待治理</h2><p>用户“没解决”的问答已关联部门与引用知识</p></div><span>{governanceTasks.length} 项待处理</span></div>{governanceTasks.map(task => <div className="governance-task" key={task.id}><span>AI</span><div><b>{task.reason} · {task.documentTitle}</b><p>{task.detail || "用户未补充具体说明"}</p><small>{task.reporter} 提交 · {task.createdAt}</small></div><i>待处理</i></div>)}</section>}<section className="table-card"><div className="table-title"><div><h2>资料与审批记录</h2><p>草稿提交部门审核，审批通过后自动进入知识目录</p></div><button>筛选 ▾</button></div><div className="data-table"><div className="data-row table-head"><span>资料名称</span><span>分类 / 密级</span><span>上传人与负责人</span><span>版本 / 复核日</span><span>状态</span><span>操作</span></div>{documents.map(doc => <div className="data-row" key={doc.id}><button className="table-document" onClick={() => onSelect(doc)}><span>{doc.mimeType?.includes("pdf") ? "P" : "W"}</span><div><b>{doc.title}</b><small>{doc.sourceName ?? "在线文档"} · {fmtSize(doc.size)}</small></div></button><span><b>{doc.category}</b><small>{doc.securityLevel}</small></span><span><b>{doc.uploader}</b><small>负责人：{doc.owner}</small></span><span><b>V{doc.version}.0</b><small>{doc.reviewDueAt || "未设置"}</small></span><span><i className={`doc-status ${doc.status}`}>{statusLabel[doc.status]}</i></span><span className="row-actions">{doc.status === "draft" ? <button onClick={() => onStatus(doc.id, "submit")}>提交审核</button> : doc.status === "review" && canApprove ? <><button onClick={() => onStatus(doc.id, "approve")}>审批通过</button><button onClick={() => onStatus(doc.id, "reject")}>驳回</button></> : doc.status === "published" && canApprove ? <><button onClick={() => onStatus(doc.id, "archive")}>作废</button><button onClick={() => onSelect(doc)}>查看</button></> : <button onClick={() => onSelect(doc)}>查看</button>}</span></div>)}</div></section></main>;
}

function AuditView({ logs, documents }: { logs: AuditLog[]; documents: KnowledgeDocument[] }) { const action: Record<string, string> = { VIEW: "查看", DOWNLOAD: "下载", EXPORT: "导出", FEEDBACK: "提交反馈", UPDATE: "更新", UPLOAD: "上传", APPROVE: "审批通过", REJECT: "驳回", SUBMIT_REVIEW: "提交复核", ACCOUNT_CREATE:"开通账号", ACCOUNT_UPDATE:"变更账号权限" }; return <main className="workspace"><section className="admin-heading"><div><span className="page-kicker">AUDIT TRAIL</span><h1>审计日志</h1><p>追踪资料、账号与权限的全部关键操作。</p></div><button className="outline-action" onClick={() => downloadBlob("知识库审计日志.csv", `时间,操作者,操作,详情\n${logs.map(l => `${l.createdAt},${l.actor},${action[l.action] ?? l.action},${l.detail}`).join("\n")}`, "text/csv;charset=utf-8")}>导出 CSV</button></section><section className="audit-card">{logs.map(log => <div className="audit-item" key={log.id}><span className="audit-icon">{log.action === "DOWNLOAD" ? "↓" : log.action === "VIEW" ? "◉" : "✓"}</span><div><b>{log.actor} · {action[log.action] ?? log.action}</b><p>{log.detail || documents.find(d => d.id === log.documentId)?.title}</p></div><time>{log.createdAt}</time></div>)}</section></main>; }

function AccountAdminView({ notify }: { notify:(message:string)=>void }) {
  const [accounts,setAccounts]=useState<EnterpriseAccount[]>([]); const [departments,setDepartments]=useState<UploadDepartment[]>([]); const [loading,setLoading]=useState(true); const [showCreate,setShowCreate]=useState(false);
  async function load() { setLoading(true); try { const response=await fetch("/api/admin/users",{cache:"no-store"}); const payload=await response.json(); if(!response.ok) throw new Error(payload.error?.message ?? "账号加载失败"); setAccounts(payload.data.users); setDepartments(payload.data.departments); } catch(error) { notify(error instanceof Error ? error.message : "账号加载失败"); } finally { setLoading(false); } }
  useEffect(()=>{ const timer=window.setTimeout(()=>load(),0); return ()=>window.clearTimeout(timer); },[]); // eslint-disable-line react-hooks/exhaustive-deps
  async function createAccount(event:FormEvent<HTMLFormElement>) { event.preventDefault(); const form=new FormData(event.currentTarget); const response=await fetch("/api/admin/users",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(form))}); const payload=await response.json(); if(!response.ok) return notify(payload.error?.message ?? "账号开通失败"); setShowCreate(false); notify("账号已预开通，员工使用对应企业邮箱登录即可"); await load(); }
  async function saveAccount(account:EnterpriseAccount,event:FormEvent<HTMLFormElement>) { event.preventDefault(); const values=Object.fromEntries(new FormData(event.currentTarget)); const response=await fetch("/api/admin/users",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:account.id,...values})}); const payload=await response.json(); if(!response.ok) return notify(payload.error?.message ?? "账号更新失败"); notify(values.status === "OFFBOARDED" ? "离职权限已回收，后续请求立即失效" : values.status === "DISABLED" ? "账号已停用" : "账号权限已更新"); await load(); }
  const statusLabelMap:Record<string,string>={ACTIVE:"使用中",PENDING:"待配置",DISABLED:"已停用",OFFBOARDED:"已离职"}; const roleLabel:Record<string,string>={SUPER_ADMIN:"超级管理员",DEPT_ADMIN:"部门管理员",EMPLOYEE:"普通员工",UNASSIGNED:"待分配"};
  return <main className="workspace"><section className="admin-heading"><div><span className="page-kicker">IDENTITY & ACCESS</span><h1>账号与权限</h1><p>统一管理员工准入、部门角色、停用及离职权限回收。</p></div><button className="primary-action" onClick={()=>setShowCreate(value=>!value)}>＋ 预开通账号</button></section><div className="identity-metrics"><div><span>使用中</span><b>{accounts.filter(a=>a.status==="ACTIVE").length}</b></div><div><span>待配置</span><b>{accounts.filter(a=>a.status==="PENDING").length}</b></div><div><span>停用 / 离职</span><b>{accounts.filter(a=>["DISABLED","OFFBOARDED"].includes(a.status)).length}</b></div><p>登录只负责确认“是谁”，部门和角色必须由企业管理员显式授权。</p></div>{showCreate&&<form className="account-create" onSubmit={createAccount}><label>企业邮箱<input name="email" type="email" required placeholder="name@company.com"/></label><label>员工姓名<input name="displayName" required/></label><label>主部门<select name="deptId" required>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>角色<select name="role"><option value="EMPLOYEE">普通员工</option><option value="DEPT_ADMIN">部门管理员</option><option value="SUPER_ADMIN">超级管理员</option></select></label><button className="primary-action">确认开通</button></form>}<section className="account-card"><header><div><h2>企业账号目录</h2><p>首次访问但尚未授权的员工会进入“待配置”队列</p></div><span>{accounts.length} 个账号</span></header>{loading?<div className="account-loading">正在同步企业账号...</div>:accounts.map(account=><form className="account-row" key={account.id} onSubmit={event=>saveAccount(account,event)}><span className="account-avatar">{account.display_name.slice(0,1)}</span><label>员工<input name="displayName" defaultValue={account.display_name}/><small>{account.email}</small></label><label>主部门<select name="deptId" defaultValue={account.primary_dept_id||departments[0]?.id}>{departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select><small>{account.departments}</small></label><label>角色<select name="role" defaultValue={account.role==="UNASSIGNED"?"EMPLOYEE":account.role}><option value="EMPLOYEE">普通员工</option><option value="DEPT_ADMIN">部门管理员</option><option value="SUPER_ADMIN">超级管理员</option></select><small>{roleLabel[account.role]}</small></label><label>账号状态<select name="status" defaultValue={account.status==="PENDING"?"ACTIVE":account.status}><option value="ACTIVE">使用中</option><option value="DISABLED">停用</option><option value="OFFBOARDED">离职回收</option></select><small>{statusLabelMap[account.status]}</small></label><label>最近登录<span>{account.last_login_time?.slice(0,16).replace("T"," ")||"尚未登录"}</span><small>{account.identity_provider}</small></label><button>保存</button></form>)}</section></main>;
}

function DocumentDrawer({ document: doc, favorite, onClose, onFavorite, onFeedback, onExport, onDownload, onShare, onSubscribe, onContact }: { document: KnowledgeDocument; favorite: boolean; onClose: () => void; onFavorite: () => void; onFeedback: () => void; onExport: () => void; onDownload: () => void; onShare: () => void; onSubscribe: () => void; onContact: () => void }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const isPdf = Boolean(doc.sourceKey && doc.mimeType?.includes("pdf"));
  useEffect(() => {
    if (!isPdf) return;
    let url = ""; let cancelled = false;
    fetch(`/api/documents/${doc.id}?download=1`).then(response => response.ok ? response.blob() : Promise.reject()).then(blob => { if (!cancelled) { url = URL.createObjectURL(blob); setPreviewUrl(url); } }).catch(() => undefined);
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [doc.id, isPdf]);
  const versions = doc.versions ?? [];
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="document-drawer" onMouseDown={e => e.stopPropagation()}><header><button onClick={onClose}>×</button><div><span className={`doc-status ${doc.status}`}>{statusLabel[doc.status]}</span><span>{doc.securityLevel}</span></div><h2>{doc.title}</h2><p>{doc.summary || "暂无摘要"}</p></header><div className="drawer-actions"><button onClick={onFavorite}>{favorite ? "★ 已收藏" : "☆ 收藏"}</button><button onClick={onShare}>⎘ 内部链接</button><button onClick={onSubscribe}>◇ 订阅更新</button><button onClick={onContact}>@ 联系负责人</button>{doc.sourceKey && <button onClick={onDownload}>↓ 下载原件</button>}<button onClick={onExport}>⇧ 导出摘要</button><button onClick={onFeedback}>! 纠错反馈</button></div><section className="doc-info"><div><span>知识负责人</span><b>{doc.owner}</b></div><div><span>上传人</span><b>{doc.uploader}</b></div><div><span>当前版本</span><b>V{doc.version}.0</b></div><div><span>下次复核</span><b>{doc.reviewDueAt || "未设置"}</b></div></section><article className="doc-content"><h3>{previewUrl ? "原件预览" : "文档正文"}</h3>{previewUrl ? <iframe className="pdf-preview" title={`${doc.title} PDF预览`} src={previewUrl} /> : doc.content.trim() ? doc.content.split("\n").filter(Boolean).map((p, i) => <p key={i}>{p}</p>) : <div className="content-empty"><b>附件已安全保存</b><p>{doc.sourceName ? `当前文件为 ${doc.sourceName}，正文尚未解析为可检索文本。` : "当前资料尚未填写正文。"}</p>{doc.sourceKey && <button onClick={onDownload}>下载原件查看</button>}</div>}</article><section className="version-list"><h3>版本记录</h3>{versions.length ? versions.map((item, index) => <div key={item.id}><span>V{item.version}.0</span><p><b>{index === 0 ? "当前版本" : "历史版本"}</b><small>{item.operator} · {item.changeNote || (item.version === 1 ? "首次上传" : "内容更新")} · {item.createdAt.slice(0, 10)}</small></p></div>) : <div><span>V{doc.version}.0</span><p><b>当前版本</b><small>{doc.uploader} · {doc.version === 1 ? "首次上传" : "内容更新"} · {doc.updatedAt.slice(0, 10)}</small></p></div>}</section></aside></div>;
}

function UploadModal({ loading, currentUser, options, onSubmit, onClose }: { loading: boolean; currentUser: { displayName: string; role: string; primaryDeptId: number }; options: UploadOptions; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [deptId, setDeptId] = useState(currentUser.primaryDeptId);
  const [reviewDate] = useState(() => new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10));
  const department = options.departments.find(item => item.id === deptId) ?? options.departments[0];
  const departmentMembers = options.members.filter(item => item.dept_id === deptId);
  const categoryByDepartment: Record<string, string> = { PRODUCT: "产品研发", HR: "组织人事", SALES: "销售市场", FINANCE: "财务法务", GENERAL: "组织人事" };
  const defaultCategory = categoryByDepartment[department?.code ?? "GENERAL"] ?? "组织人事";
  const defaultOwner = departmentMembers.find(item => item.display_name === currentUser.displayName)?.display_name ?? departmentMembers[0]?.display_name ?? currentUser.displayName;
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="upload-modal" onSubmit={onSubmit} onMouseDown={e => e.stopPropagation()}><header><div><span className="page-kicker">KNOWLEDGE INGESTION</span><h2>上传企业资料</h2><p>身份与组织信息已按权限自动联动，文件将直接写入企业对象存储。</p></div><button type="button" onClick={onClose}>×</button></header>
    <label className={`file-drop ${fileName ? "has-file" : ""}`}><input name="file" type="file" onChange={e => { const file = e.target.files?.[0]; setFileName(file?.name ?? ""); if (file && !title) setTitle(file.name.replace(/\.[^.]+$/, "")); }}/><span>{fileName ? "✓" : "⇧"}</span><b>{fileName || "点击选择或拖入文件"}</b><small>{fileName ? "文件已选择，标题已由文件名自动生成" : "支持企业常用文件格式；应用层不设置文件大小限制"}</small></label>
    <div className="form-grid">
      <label><span>资料标题 *</span><input name="title" value={title} onChange={e => setTitle(e.target.value)} required placeholder="选择文件后自动生成，可修改" /></label>
      <label><span>知识分类 *</span><select key={`${deptId}-${defaultCategory}`} name="category" required defaultValue={defaultCategory}>{categories.slice(1).map(c => <option key={c}>{c}</option>)}</select></label>
      <label><span>归属部门</span><select name="deptId" value={deptId} onChange={e => setDeptId(Number(e.target.value))} disabled={currentUser.role !== "SUPER_ADMIN"}>{options.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{currentUser.role !== "SUPER_ADMIN" && <input type="hidden" name="deptId" value={deptId}/>}</label>
      <label><span>知识负责人 *</span><select key={`${deptId}-${defaultOwner}`} name="owner" required defaultValue={defaultOwner}>{departmentMembers.length ? departmentMembers.map(member => <option key={member.id}>{member.display_name}</option>) : <option>{currentUser.displayName}</option>}</select></label>
      <label><span>上传人（系统带出）</span><input value={currentUser.displayName} readOnly /></label>
      <label><span>审核人（部门权限联动）</span><input value={department?.approver ?? "待配置部门管理员"} readOnly /></label>
      <label><span>安全密级</span><select name="securityLevel" defaultValue="INTERNAL"><option value="INTERNAL">内部公开</option><option value="DEPT">部门可见</option><option value="SENSITIVE">敏感</option><option value="CONFIDENTIAL">核心机密</option></select></label>
      <label><span>共享范围</span><select name="shareScope" disabled={currentUser.role === "EMPLOYEE"}><option value="DEPT">仅本部门</option><option value="CROSS_DEPT">跨部门共享</option></select>{currentUser.role === "EMPLOYEE" && <input type="hidden" name="shareScope" value="DEPT" />}</label>
      <label><span>标签</span><input name="tags" placeholder="逗号分隔，如：差旅,报销" /></label>
      <label><span>下次复核日</span><input name="reviewDueAt" type="date" defaultValue={reviewDate} /></label>
      <label className="wide"><span>摘要</span><textarea name="summary" rows={2} placeholder="帮助员工快速判断内容是否相关" /></label>
      <label className="wide"><span>正文 / 解析补充</span><textarea name="content" rows={4} placeholder="可粘贴核心内容，上传后仍可继续编辑" /></label>
    </div><div className="publish-choice"><label><input type="radio" name="status" value="draft" defaultChecked/> 保存草稿</label><label><input type="radio" name="status" value="review"/> 提交部门审核</label></div><footer><button type="button" onClick={onClose}>取消</button><button className="primary-action" disabled={loading}>{loading ? "正在写入文件并生成记录..." : "上传并生成记录"}</button></footer></form></div>;
}

function FeedbackModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (v: string) => void }) { const [value, setValue] = useState(""); return <div className="modal-backdrop" onMouseDown={onClose}><div className="feedback-modal" onMouseDown={e => e.stopPropagation()}><h2>提交纠错反馈</h2><p>反馈将自动关联当前文档与版本，并通知知识负责人。</p><textarea aria-label="反馈内容" value={value} onChange={e => setValue(e.target.value)} rows={5} placeholder="请描述错误、过期内容或补充建议..."/><div><button onClick={onClose}>取消</button><button className="primary-action" disabled={!value.trim()} onClick={() => onSubmit(value)}>提交反馈</button></div></div></div>; }

function AiPanel({ onClose, onOpen, onGovernanceCreated }: { onClose: () => void; onOpen: (documentId: number) => void | Promise<void>; onGovernanceCreated: () => void }) {
  type AiSource = { citation: number; documentId: number; title: string; version: number; department: string; excerpt: string; score: number };
  type Conversation = { id: number; title: string; updateTime: string; lastMessage: string };
  type Message = { id: number; role: "user" | "assistant"; content: string; mode?: string; sources: AiSource[]; queryLogId?: number; helpful?: boolean | null; reason?: string };
  const [question, setQuestion] = useState(""); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [conversations, setConversations] = useState<Conversation[]>([]); const [conversationId, setConversationId] = useState<number | null>(null); const [messages, setMessages] = useState<Message[]>([]); const [feedbackTarget, setFeedbackTarget] = useState<number | null>(null); const [feedbackReason, setFeedbackReason] = useState(""); const [feedbackDetail, setFeedbackDetail] = useState("");
  async function loadConversations(selectLatest = false) { const response = await fetch("/api/ai/conversations", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "历史会话加载失败"); const rows: Conversation[] = (payload.data.conversations ?? []).map((row: Record<string, unknown>) => ({ id: Number(row.id), title: String(row.title), updateTime: String(row.update_time), lastMessage: String(row.last_message ?? "") })); setConversations(rows); if (selectLatest && rows[0]) await loadConversation(rows[0].id); }
  async function loadConversation(id: number) { setLoading(true); setError(""); try { const response = await fetch(`/api/ai/conversations?id=${id}`, { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "会话加载失败"); setConversationId(id); setMessages((payload.data.messages ?? []).map((row: Record<string, unknown>) => { let sources: AiSource[] = []; try { sources = JSON.parse(String(row.source_payload ?? "[]")); } catch { /* ignore malformed history */ } return { id: Number(row.id), role: String(row.role) as "user" | "assistant", content: String(row.content), mode: row.mode ? String(row.mode) : undefined, sources, queryLogId: row.query_log_id ? Number(row.query_log_id) : undefined, helpful: row.helpful === null || row.helpful === undefined ? null : Boolean(row.helpful), reason: String(row.reason ?? "") }; })); } catch (caught) { setError(caught instanceof Error ? caught.message : "会话加载失败"); } finally { setLoading(false); } }
  // Initial server-backed session restore runs once when the workbench opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = window.setTimeout(() => loadConversations(true).catch(caught => setError(caught instanceof Error ? caught.message : "历史会话加载失败")), 0); return () => window.clearTimeout(timer); }, []);
  function newConversation() { setConversationId(null); setMessages([]); setQuestion(""); setError(""); }
  async function deleteConversation(id: number) { if (!window.confirm("删除该历史会话？此操作不会删除原始知识文档。")) return; const response = await fetch(`/api/ai/conversations?id=${id}`, { method: "DELETE" }); if (!response.ok) return setError("会话删除失败"); if (conversationId === id) newConversation(); await loadConversations(false); }
  async function ask(nextQuestion = question) { if (!nextQuestion.trim() || loading) return; const userText = nextQuestion.trim(); const optimisticId = -Date.now(); setMessages(current => [...current, { id: optimisticId, role: "user", content: userText, sources: [] }]); setQuestion(""); setLoading(true); setError(""); try { const response = await fetch("/api/ai/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: userText, conversationId }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "知识问答暂不可用"); const nextId = Number(payload.data.conversationId); setConversationId(nextId); setMessages(current => [...current.map(item => item.id === optimisticId ? { ...item, id: optimisticId - 1 } : item), { id: Number(payload.data.messageId), role: "assistant", content: payload.data.answer, sources: payload.data.sources, mode: payload.data.mode, queryLogId: Number(payload.data.queryLogId), helpful: null }]); await loadConversations(false); } catch (caught) { setMessages(current => current.filter(item => item.id !== optimisticId)); setError(caught instanceof Error ? caught.message : "知识问答暂不可用"); } finally { setLoading(false); } }
  async function submitHelpful(message: Message, helpful: boolean, reason = "", detail = "") { if (!message.queryLogId) return; const response = await fetch("/api/engagement", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "AI_HELPFUL", queryLogId: message.queryLogId, messageId: message.id, helpful, reason, detail }) }); const payload = await response.json(); if (!response.ok) return setError(payload.error?.message ?? "评价提交失败"); setMessages(current => current.map(item => item.id === message.id ? { ...item, helpful, reason } : item)); setFeedbackTarget(null); setFeedbackReason(""); setFeedbackDetail(""); if (!helpful) onGovernanceCreated(); }
  const hasMessages = messages.length > 0;
  return <div className="modal-backdrop ai-backdrop" onMouseDown={onClose}><section className="ai-panel enterprise-ai" onMouseDown={e => e.stopPropagation()}><button className="close-button" aria-label="关闭智能问答" onClick={onClose}>×</button>
    <aside className="ai-intro ai-history"><div className="ai-brand"><span className="ai-orb">✦</span><div><small>ZHIYU INTELLIGENCE</small><b>问问小知</b></div></div><button className="new-chat" onClick={newConversation}>＋ 新建会话</button><div className="history-title"><span>历史会话</span><small>{conversations.length}</small></div><div className="conversation-list">{conversations.map(item => <div className={conversationId === item.id ? "active" : ""} key={item.id}><button onClick={() => loadConversation(item.id)}><b>{item.title}</b><small>{item.lastMessage || "等待首次提问"}</small></button><button aria-label={`删除会话${item.title}`} onClick={() => deleteConversation(item.id)}>×</button></div>)}{!conversations.length && <p>暂无历史会话，开始第一次企业知识问答吧。</p>}</div><div className="ai-trust"><span>●</span> 会话已按账号安全保存</div></aside>
    <main className="ai-workspace"><header><div><span className="pulse-dot"/><div><b>知识问答工作台</b><small>{conversationId ? "上下文已连接 · 自动保存" : "新会话 · 首次提问后保存"}</small></div></div><div className="ai-status"><span>权限校验</span><span>引用溯源</span><span>历史恢复</span></div></header><section className="ai-conversation">{hasMessages ? <div className="message-stream">{messages.map(message => message.role === "user" ? <div className="user-message" key={message.id}><span>你</span><p>{message.content}</p></div> : <div className="ai-answer" key={message.id}><div className="answer-meta"><span>AI</span><small>{message.mode === "rag" ? "RAG 生成回答" : message.mode === "retrieval_only" ? "安全检索模式" : "未找到可靠依据"}</small></div><p>{message.content}</p>{message.sources.length > 0 && <div className="source-label">引用来源 · {message.sources.length}</div>}{message.sources.map(source => <button key={`${message.id}-${source.documentId}-${source.citation}`} onClick={() => onOpen(source.documentId)}><b>引用 {source.citation}</b><span>{source.title} · V{source.version}.0 · {source.department} →</span><small>{source.excerpt}</small></button>)}{message.queryLogId && <div className="ai-followups"><button onClick={() => ask("请根据当前问题和以上引用，生成结构化办理清单，包含步骤、所需材料、责任角色和注意事项")}>生成办理清单</button><button className={message.helpful === true ? "selected" : ""} disabled={message.helpful !== null && message.helpful !== undefined} onClick={() => submitHelpful(message, true)}>{message.helpful === true ? "✓ 已评价有帮助" : "有帮助"}</button><button className={message.helpful === false ? "selected negative" : ""} disabled={message.helpful !== null && message.helpful !== undefined} onClick={() => setFeedbackTarget(message.id)}>{message.helpful === false ? "✓ 已提交改进" : "没解决"}</button></div>}{feedbackTarget === message.id && <div className="unresolved-form"><b>哪里没有解决？</b><div>{["答案不准确","没有找到资料","引用不相关","内容已过期"].map(reason => <button className={feedbackReason === reason ? "active" : ""} key={reason} onClick={() => setFeedbackReason(reason)}>{reason}</button>)}</div><textarea value={feedbackDetail} onChange={e => setFeedbackDetail(e.target.value)} placeholder="可补充具体问题，提交后会进入知识治理待办" rows={2}/><footer><button onClick={() => setFeedbackTarget(null)}>取消</button><button disabled={!feedbackReason} onClick={() => submitHelpful(message, false, feedbackReason, feedbackDetail)}>提交改进</button></footer></div>}</div>)}</div> : <div className="ai-empty"><span>✦</span><h3>今天想了解什么？</h3><p>我会从你有权限查看的企业知识中寻找答案，并标注每条依据。</p><div className="suggestions"><button onClick={() => setQuestion("差旅报销需要哪些材料？")}><i>制度查询</i><b>差旅报销需要哪些材料？</b><span>→</span></button><button onClick={() => setQuestion("新员工第一周需要完成什么？")}><i>入职指南</i><b>新员工第一周需要完成什么？</b><span>→</span></button><button onClick={() => setQuestion("生产环境发布需要哪些审批？")}><i>研发规范</i><b>生产环境发布需要哪些审批？</b><span>→</span></button></div></div>}{loading && <div className="thinking"><span/><span/><span/> 正在检索已授权知识</div>}{error && <p className="ai-error">{error}</p>}</section><footer className="ai-compose"><div className="ai-input"><span>✦</span><input aria-label="向企业知识库提问" value={question} onChange={e => setQuestion(e.target.value)} placeholder={hasMessages ? "继续追问当前会话..." : "输入你的问题，Enter 发送..."} onKeyDown={e => { if (e.key === "Enter") ask(); }}/><button onClick={() => ask()} disabled={!question.trim() || loading}>{loading ? "检索中" : "发送"}</button></div><small>会话自动保存；回答请以引用的最新生效原文为准</small></footer></main>
  </section></div>;
}
