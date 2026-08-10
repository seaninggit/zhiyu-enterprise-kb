"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  buildLocalSemanticIndex,
  embedLocally,
  extractKnowledgeFile,
  type ExtractionProgress,
} from "../lib/client-knowledge";

if (typeof window !== "undefined") {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const role = window.localStorage.getItem("zhiyu_demo_role");
    if (role) {
      const headers = new Headers(init?.headers);
      headers.set("x-zhiyu-demo-role", role);
      init = { ...init, headers };
    }
    return originalFetch(input, init);
  };
}

type View =
  | "library"
  | "admin"
  | "platform"
  | "taxonomy"
  | "favorites"
  | "audit"
  | "accounts"
  | "settings";
type DocumentStatus =
  | "draft"
  | "review"
  | "published"
  | "rejected"
  | "archived";
type KnowledgeDocument = {
  id: number;
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string;
  status: DocumentStatus;
  securityLevel: string;
  owner: string;
  uploader: string;
  sourceName?: string | null;
  sourceKey?: string | null;
  mimeType?: string | null;
  size?: number;
  version: number;
  reviewDueAt?: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  voidedAt?: string | null;
  deletedAt?: string | null;
  lastVersionAt?: string | null;
  ingestedAt?: string | null;
  verifiedAt?: string | null;
  aiIndexedAt?: string | null;
  versions?: DocumentVersion[];
  parseStatus?: string;
  verificationStatus?: string;
  extractionMethod?: string;
  extractionDetail?: string;
  ocrStatus?: string;
  aiIndexStatus?: string;
  spaceId?: number | null;
  folderId?: number | null;
  canEdit?: boolean;
  canManage?: boolean;
  subscribed?: boolean;
  acl?: PermissionGrant[];
  spacePermissions?: PermissionGrant[];
  permissionPrincipals?: PermissionPrincipals | null;
};
type DocumentVersion = {
  id: number;
  version: number;
  changeNote: string;
  operator: string;
  createdAt: string;
};
type PermissionGrant = {
  id?: number;
  subject_type: "USER" | "DEPT" | "GROUP";
  subject_id: number;
  subject_name?: string;
  permission: "VIEW" | "EDIT";
  expires_at?: string | null;
};
type PermissionPrincipals = {
  departments: { id: number; name: string }[];
  users: { id: number; name: string }[];
  groups: { id: number; name: string }[];
};
type AuditLog = {
  id: number;
  documentId?: number | null;
  action: string;
  actor: string;
  detail: string;
  createdAt: string;
};
type GovernanceTask = {
  id: number;
  reason: string;
  detail: string;
  documentTitle: string;
  reporter: string;
  createdAt: string;
  status: string;
  sourceDocumentId?: number | null;
  assignee?: string;
};
type UploadDepartment = {
  id: number;
  code: string;
  name: string;
  parent_id?: number | null;
  approver: string;
};
type UploadMember = { id: number; dept_id: number; display_name: string };
type UploadOptions = {
  departments: UploadDepartment[];
  members: UploadMember[];
};
type TaxonomyOption = { id: number; dept_id?: number | null; name: string; code?: string; sort_order?: number };
type UploadSpace = { id:number;dept_id?:number|null;name:string;folder_id?:number|null;folder_name?:string|null;parent_id?:number|null };
type CurrentUser = {
  userId?: number;
  email: string;
  displayName: string;
  role: string;
  permissions?: string[];
  scope?: string;
  primaryDeptId: number;
  isPublicViewer?: boolean;
  demoMode?: boolean;
};
type EnterpriseAccount = {
  id: number;
  email: string;
  display_name: string;
  status: string;
  identity_provider: string;
  last_login_time?: string | null;
  role: string;
  departments: string;
  primary_dept_id: number;
};
type Notice = {
  id: number;
  title: string;
  content: string;
  document_id?: number | null;
  is_read: boolean;
  create_time: string;
};
type Metrics = {
  total: number;
  pending: number;
  parse_failed: number;
  due_soon: number;
  verified: number;
  health?: number;
};
type QueryCorrection = {
  original: string;
  corrected: string;
  reason: string;
  confidence: number;
  applied: boolean;
  changes: { from: string; to: string }[];
};

const DEFAULT_CATEGORIES = ["全部", "产品研发", "组织人事", "销售市场", "财务法务"];
const statusLabel: Record<DocumentStatus, string> = {
  draft: "草稿",
  review: "待审核",
  published: "已发布",
  rejected: "已驳回",
  archived: "已归档",
};

function normalizeDocument(row: Record<string, unknown>): KnowledgeDocument {
  const rawStatus = String(row.status ?? "DRAFT");
  const status: DocumentStatus =
    rawStatus === "PENDING_DEPT_REVIEW"
      ? "review"
      : rawStatus === "ARCHIVED_ACTIVE"
        ? "published"
        : rawStatus === "EXPIRED_VOID"
          ? "archived"
          : "draft";
  return {
    id: Number(row.id),
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    content: String(row.content ?? ""),
    category: String(row.category ?? "未分类"),
    tags: String(row.tags ?? ""),
    status,
    securityLevel: String(
      row.securityLevel ?? row.security_level ?? "INTERNAL",
    ),
    owner: String(row.owner ?? ""),
    uploader: String(row.uploader ?? row.creator_name ?? ""),
    sourceName:
      (row.sourceName as string) ?? (row.source_name as string) ?? null,
    sourceKey: (row.sourceKey as string) ?? (row.source_key as string) ?? null,
    mimeType: (row.mimeType as string) ?? (row.mime_type as string) ?? null,
    size: Number(row.size ?? 0),
    version: Number(row.version ?? 1),
    reviewDueAt:
      (row.reviewDueAt as string) ?? (row.review_due_at as string) ?? null,
    createdAt: String(row.createdAt ?? row.create_time ?? ""),
    updatedAt: String(row.updatedAt ?? row.update_time ?? ""),
    submittedAt: (row.submitted_at as string) ?? null,
    approvedAt: (row.approved_at as string) ?? null,
    rejectedAt: (row.rejected_at as string) ?? null,
    voidedAt: (row.voided_at as string) ?? null,
    deletedAt: (row.deleted_at as string) ?? null,
    lastVersionAt: (row.last_version_at as string) ?? null,
    ingestedAt: (row.ingested_at as string) ?? null,
    verifiedAt: (row.verified_at as string) ?? null,
    aiIndexedAt: (row.ai_indexed_at as string) ?? null,
    parseStatus: String(row.parse_status ?? "PENDING"),
    verificationStatus: String(row.verification_status ?? "UNVERIFIED"),
    extractionMethod: String(row.extraction_method ?? "NONE"),
    extractionDetail: String(row.extraction_detail ?? ""),
    ocrStatus: String(row.ocr_status ?? "NOT_REQUIRED"),
    aiIndexStatus: String(row.ai_index_status ?? "PENDING"),
    spaceId: row.space_id ? Number(row.space_id) : null,
    folderId: row.folder_id ? Number(row.folder_id) : null,
  };
}

function normalizeGovernanceTask(
  task: Record<string, unknown>,
): GovernanceTask {
  return {
    id: Number(task.id),
    reason: String(task.reason),
    detail: String(task.detail ?? ""),
    documentTitle: String(task.document_title ?? "未关联具体文档"),
    reporter: String(task.reporter),
    createdAt: String(task.create_time),
    status: String(task.status ?? "OPEN"),
    sourceDocumentId: task.source_document_id
      ? Number(task.source_document_id)
      : null,
    assignee: String(task.assignee ?? ""),
  };
}

function fmtSize(size = 0) {
  return size ? `${(size / 1024 / 1024).toFixed(1)} MB` : "在线文档";
}

function fmtBusinessTime(value?: string | null) {
  if (!value) return "尚未发生";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function isContextFollowUp(question: string) {
  const compact = question.replace(/[\s，。！？、,.!?：:；;]/g, "");
  return (
    /^(那|那么|这个|这些|它|其|上述|前面|刚才|还有|然后|具体|为什么|怎么办|时限|材料|步骤|流程)/.test(
      compact,
    ) || compact.length <= 6
  );
}
function parseStatusLabel(status = "PENDING") {
  return status === "COMPLETED"
    ? "已解析可检索"
    : status === "OCR_REQUIRED"
      ? "等待本地 OCR"
      : status === "OCR_FAILED"
        ? "OCR 失败，需校正"
        : status === "NEEDS_CONTENT"
          ? "需补充正文"
          : status === "FAILED"
            ? "解析失败"
            : "等待解析";
}
function AiAnswerContent({ content }: { content: string }) {
  const normalized = content
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
  return (
    <div className="answer-content">
      {normalized.split(/\n{2,}/).map((block, index) => (
        <p key={`${index}-${block.slice(0, 18)}`}>{block}</p>
      ))}
    </div>
  );
}
function downloadBlob(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const DEMO_ROLE_OPTIONS = [
  {
    code: "EMPLOYEE",
    name: "普通员工",
    description: "查看本部门知识、上传资料、收藏与 AI 问答",
  },
  {
    code: "DEPT_ADMIN",
    name: "部门管理员",
    description: "本部门审批发布、权限配置、治理与审计",
  },
  {
    code: "SUPER_ADMIN",
    name: "超级管理员",
    description: "全平台治理、成员权限、审计与系统配置",
  },
] as const;

function hasDemoRole() {
  if (typeof window === "undefined") return false;
  return (
    window.localStorage.getItem("zhiyu_demo_role") !== null ||
    document.cookie.includes("zhiyu_demo_role=")
  );
}

function selectDemoRole(role: string) {
  window.localStorage.setItem("zhiyu_demo_role", role);
  document.cookie = `zhiyu_demo_role=${role}; path=/; max-age=2592000; samesite=lax`;
  window.location.reload();
}

function exitDemoRole() {
  window.localStorage.removeItem("zhiyu_demo_role");
  document.cookie =
    "zhiyu_demo_role=; path=/; max-age=0; samesite=lax";
  window.location.reload();
}

export default function Home() {
  const [view, setView] = useState<View>("library");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [governanceTasks, setGovernanceTasks] = useState<GovernanceTask[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [tagFilter, setTagFilter] = useState("全部标签");
  const [knowledgeCategories, setKnowledgeCategories] = useState(DEFAULT_CATEGORIES);
  const [categoryOptions, setCategoryOptions] = useState<TaxonomyOption[]>(DEFAULT_CATEGORIES.filter(item=>item!=="全部").map((name,index)=>({id:-(index+1),dept_id:null,name})));
  const [tagOptions, setTagOptions] = useState<TaxonomyOption[]>([]);
  const [knowledgeSpaces,setKnowledgeSpaces]=useState<UploadSpace[]>([]);
  const [uploadConfig,setUploadConfig]=useState<Record<string,string>>({});
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({
    total: 0,
    pending: 0,
    parse_failed: 0,
    due_soon: 0,
    verified: 0,
  });
  const [notifications, setNotifications] = useState<Notice[]>([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<
    KnowledgeDocument[] | null
  >(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLogId, setSearchLogId] = useState<number | null>(null);
  const [searchCorrection, setSearchCorrection] =
    useState<QueryCorrection | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);
  const [pipelineProgress, setPipelineProgress] =
    useState<ExtractionProgress | null>(null);
  function hasPerm(perm: string) { return currentUser.scope === "global" || (currentUser.permissions?.includes(perm) ?? false); }
  const [currentUser, setCurrentUser] = useState<CurrentUser>({
    email: "",
    displayName: "正在识别账号",
    role: "EMPLOYEE",
    primaryDeptId: 1,
  });
  const [authError, setAuthError] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [demoLoginOpen, setDemoLoginOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiGuideVisible, setAiGuideVisible] = useState(true);
  const [aiUnread, setAiUnread] = useState(false);
  const [aiSessionUpdated, setAiSessionUpdated] = useState(false);
  const [documentReturnTarget, setDocumentReturnTarget] = useState<"ai" | null>(
    null,
  );
  const [workflowDialog, setWorkflowDialog] = useState<{
    id: number;
    action: "approve" | "reject" | "archive";
  } | null>(null);
  const [governanceDialog, setGovernanceDialog] =
    useState<GovernanceTask | null>(null);
  const [governanceSubmitting, setGovernanceSubmitting] = useState(false);
  const [uploadOptions, setUploadOptions] = useState<UploadOptions>({
    departments: [
      {
        id: 1,
        code: "GENERAL",
        name: "综合管理部",
        approver: "待配置部门管理员",
      },
    ],
    members: [],
  });
  const hasOpenOverlay =
    aiOpen ||
    uploadOpen ||
    feedbackOpen ||
    demoLoginOpen ||
    selected !== null ||
    workflowDialog !== null ||
    governanceDialog !== null;

  useEffect(() => {
    if (!hasOpenOverlay) return;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0)
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, [hasOpenOverlay]);
  useEffect(() => {
    const timer = window.setTimeout(() => setAiGuideVisible(false), 6500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    fetch("/api/documents", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error?.message ?? "账号加载失败");
        return payload;
      })
      .then((data) => {
        setDocuments((data.data?.documents ?? []).map(normalizeDocument));
        setLogs(
          (data.data?.logs ?? []).map((log: Record<string, unknown>) => ({
            id: Number(log.id),
            documentId: Number(log.document_id ?? 0),
            action: String(log.action),
            actor: String(log.actor),
            detail: String(log.detail),
            createdAt: String(log.create_time ?? ""),
          })),
        );
        if (data.data?.governanceTasks)
          setGovernanceTasks(
            data.data.governanceTasks.map(normalizeGovernanceTask),
          );
        if (data.data?.currentUser) {
          setCurrentUser(data.data.currentUser);
          if (
            data.data.currentUser.demoMode &&
            !hasDemoRole()
          ) {
            setDemoLoginOpen(true);
          }
        }
        if (data.data?.uploadOptions?.departments?.length)
          setUploadOptions(data.data.uploadOptions);
        if (Array.isArray(data.data?.categoryOptions)) {
          const options=data.data.categoryOptions.map((item:Record<string,unknown>)=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name),code:String(item.code??""),sort_order:Number(item.sort_order)||0}));
          setCategoryOptions(options);
          setKnowledgeCategories(["全部", ...Array.from(new Set(options.map((item:TaxonomyOption)=>item.name).filter(Boolean)))]);
        }
        if(Array.isArray(data.data?.tagOptions))setTagOptions(data.data.tagOptions.map((item:Record<string,unknown>)=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name)})));
        if(Array.isArray(data.data?.spaces))setKnowledgeSpaces(data.data.spaces.map((item:Record<string,unknown>)=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name),folder_id:item.folder_id?Number(item.folder_id):null,folder_name:item.folder_name?String(item.folder_name):null,parent_id:item.parent_id?Number(item.parent_id):null})));
        if(data.data?.uploadConfig)setUploadConfig(data.data.uploadConfig);
        setFavorites(data.data?.favorites ?? []);
        setNotifications(data.data?.notifications ?? []);
        if (data.data?.metrics) setMetrics(data.data.metrics);
      })
      .catch(async (error) => {
        setAuthError(error instanceof Error ? error.message : "账号加载失败");
      });
  }, []);
  useEffect(() => {
    const id = Number(
      new URLSearchParams(window.location.search).get("document"),
    );
    if (!id) return;
    openDocument(id).catch(() => undefined);
  }, []);

  const published = documents.filter((item) => item.status === "published");
  const searchBase = searchResults ?? published;
  const filtered = useMemo(
    () =>
      searchBase.filter((item) => {
        const text =
          `${item.title}${item.summary}${item.content}${item.tags}${item.owner}${item.uploader}`.toLowerCase();
        return (
          (category === "全部" || item.category === category) &&
          (tagFilter === "全部标签" ||
            item.tags.split(",").map((tag) => tag.trim()).includes(tagFilter)) &&
          (searchResults !== null ||
            !query.trim() ||
            text.includes(query.trim().toLowerCase()))
        );
      }),
    [searchBase, category, tagFilter, query, searchResults],
  );
  const visible =
    view === "favorites"
      ? filtered.filter((item) => favorites.includes(item.id))
      : filtered;

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2300);
  }
  async function openUpload(){
    try{
      const response=await fetch("/api/documents",{cache:"no-store"}),payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"上传配置加载失败");const data=payload.data??{};
      if(data.uploadOptions?.departments?.length)setUploadOptions(data.uploadOptions);
      if(Array.isArray(data.categoryOptions)){const options=data.categoryOptions.map((item:Record<string,unknown>)=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name),code:String(item.code??""),sort_order:Number(item.sort_order)||0}));setCategoryOptions(options);setKnowledgeCategories(["全部",...Array.from(new Set(options.map((item:TaxonomyOption)=>item.name).filter(Boolean)))]);}
      if(Array.isArray(data.tagOptions))setTagOptions(data.tagOptions.map((item:Record<string,unknown>)=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name)})));
      if(Array.isArray(data.spaces))setKnowledgeSpaces(data.spaces.map((item:Record<string,unknown>)=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name),folder_id:item.folder_id?Number(item.folder_id):null,folder_name:item.folder_name?String(item.folder_name):null,parent_id:item.parent_id?Number(item.parent_id):null})));
      if(data.uploadConfig)setUploadConfig(data.uploadConfig);setUploadOpen(true);
    }catch(error){notify(error instanceof Error?error.message:"上传配置加载失败");}
  }
  async function refreshGovernanceTasks() {
    const response = await fetch("/api/documents", { cache: "no-store" });
    const payload = await response.json();
    if (response.ok && payload.data?.governanceTasks)
      setGovernanceTasks(
        payload.data.governanceTasks.map(normalizeGovernanceTask),
      );
  }
  async function resolveGovernance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!governanceDialog || governanceSubmitting) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setGovernanceSubmitting(true);
    try {
      const response = await fetch("/api/platform", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "RESOLVE_GOVERNANCE",
          taskId: governanceDialog.id,
          resolution: values.resolution,
          targetDocumentId: Number(values.targetDocumentId) || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? "治理任务处理失败");
      setGovernanceTasks((current) =>
        current.filter((task) => task.id !== governanceDialog.id),
      );
      setGovernanceDialog(null);
      notify("治理任务已闭环，处理结果已通知反馈人并留存审计");
    } catch (error) {
      notify(error instanceof Error ? error.message : "治理任务处理失败");
    } finally {
      setGovernanceSubmitting(false);
    }
  }
  async function openDocument(documentOrId: KnowledgeDocument | number) {
    const id =
      typeof documentOrId === "number" ? documentOrId : documentOrId.id;
    const response = await fetch(`/api/documents/${id}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? "资料加载失败");
    const detail = normalizeDocument(payload.data.document);
    if (typeof documentOrId !== "number") detail.tags = documentOrId.tags;
    detail.versions = (payload.data.versions ?? []).map(
      (row: Record<string, unknown>) => ({
        id: Number(row.id),
        version: Number(row.version),
        changeNote: String(row.change_note ?? ""),
        operator: String(row.operator ?? ""),
        createdAt: String(row.create_time ?? ""),
      }),
    );
    detail.canEdit = Boolean(payload.data.capabilities?.canEdit);
    detail.canManage = Boolean(payload.data.capabilities?.canManage);
    detail.subscribed = Boolean(payload.data.subscribed);
    detail.acl = (payload.data.acl ?? []) as PermissionGrant[];
    detail.spacePermissions = (payload.data.spacePermissions ??
      []) as PermissionGrant[];
    detail.permissionPrincipals = payload.data.permissionPrincipals ?? null;
    setSelected(detail);
  }
  async function toggleFavorite(id: number) {
    const response = await fetch("/api/engagement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "FAVORITE_TOGGLE", documentId: id }),
    });
    const payload = await response.json();
    if (!response.ok) return notify(payload.error?.message ?? "收藏失败");
    setFavorites((current) =>
      payload.data.favorite
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id),
    );
  }
  async function runSearch(useOriginal = false) {
    if (!query.trim()) {
      setSearchResults(null);
      setSearchCorrection(null);
      return;
    }
    setSearchLoading(true);
    try {
      const queryEmbedding = (await embedLocally([query]).catch(() => []))[0];
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          queryEmbedding,
          useOriginal,
          filters: { category: category === "全部" ? undefined : category },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "检索失败");
      setSearchResults((payload.data.results ?? []).map(normalizeDocument));
      setSearchCorrection(payload.data.correction ?? null);
      setSearchLogId(Number(payload.data.searchLogId) || null);
      setView("library");
      if (!payload.data.results?.length)
        notify("未找到可靠结果，已记录为知识缺口");
    } catch (error) {
      notify(error instanceof Error ? error.message : "检索失败");
    } finally {
      setSearchLoading(false);
    }
  }
  async function openSearchResult(doc: KnowledgeDocument) {
    if (searchLogId)
      fetch("/api/engagement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "SEARCH_CLICK",
          searchLogId,
          documentId: doc.id,
        }),
      }).catch(() => undefined);
    await openDocument(doc);
  }
  async function markNoticesRead(id?: number) {
    await fetch("/api/engagement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "NOTIFICATION_READ", notificationId: id }),
    });
    setNotifications((current) =>
      current.map((n) => (!id || n.id === id ? { ...n, is_read: true } : n)),
    );
  }
  async function audit(documentId: number, action: string, detail: string) {
    await fetch("/api/engagement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, documentId, detail }),
    }).catch(() => undefined);
    setLogs((current) => [
      {
        id: Date.now(),
        documentId,
        action,
        actor: currentUser.displayName,
        detail,
        createdAt: new Date().toLocaleString("zh-CN"),
      },
      ...current,
    ]);
  }
  async function updateStatus(
    id: number,
    action: "submit" | "approve" | "reject" | "archive",
    providedComment = "",
  ) {
    const next: DocumentStatus =
      action === "submit"
        ? "review"
        : action === "approve"
          ? "published"
          : action === "reject"
            ? "draft"
            : "archived";
    try {
      const comment = providedComment.trim();
      if (action !== "submit" && !providedComment) {
        setWorkflowDialog({ id, action });
        return;
      }
      const response = await fetch("/api/documents", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, comment }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
      setDocuments((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, status: next, updatedAt: new Date().toISOString() }
            : item,
        ),
      );
      const refreshed = await fetch("/api/documents", {
        cache: "no-store",
      }).then((r) => r.json());
      if (refreshed.data?.documents)
        setDocuments(refreshed.data.documents.map(normalizeDocument));
      if (refreshed.data?.metrics) setMetrics(refreshed.data.metrics);
      if (refreshed.data?.notifications)
        setNotifications(refreshed.data.notifications);
      notify(
        action === "submit"
          ? "已提交部门管理员审核"
          : action === "approve"
            ? "审批通过，已进入知识目录并启动 AI 索引"
            : action === "reject"
              ? "已驳回至草稿，原因已通知上传人"
              : "已作废并退出检索范围",
      );
      setWorkflowDialog(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败");
    }
  }
  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setPipelineProgress({ stage: "READ", percent: 1, message: "正在准备资料" });
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const file = data.get("file");
      let stored: Record<string, unknown> = {};
      if (file instanceof File && file.size > 0) {
        const extraction = await extractKnowledgeFile(
          file,
          setPipelineProgress,
        );
        if (!String(data.get("content") ?? "").trim() && extraction.text.trim())
          data.set("content", extraction.text.slice(0, 500000));
        if (!String(data.get("summary") ?? "").trim() && extraction.text.trim())
          data.set(
            "summary",
            extraction.text.replace(/\s+/g, " ").trim().slice(0, 180),
          );
        data.set("extractionMethod", extraction.method);
        data.set("extractionDetail", extraction.detail);
        data.set("ocrStatus", extraction.ocrStatus);
        setPipelineProgress({
          stage: "READ",
          percent: 100,
          message: "原文解析完成，正在安全存储",
        });
        const uploadResponse = await fetch("/api/uploads", {
          method: "PUT",
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
            "x-file-size": String(file.size),
            "x-dept-id": String(
              data.get("deptId") || currentUser.primaryDeptId,
            ),
          },
          body: file,
        });
        const uploadPayload = await uploadResponse
          .json()
          .catch(() => ({ error: { message: "原文件存储失败" } }));
        if (!uploadResponse.ok)
          throw new Error(uploadPayload.error?.message ?? "原文件存储失败");
        stored = uploadPayload.data;
      }
      const metadata = Object.fromEntries(
        Array.from(data.entries()).filter(([key]) => key !== "file"),
      );
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...metadata, ...stored }),
      });
      if (!response.ok) {
        const payload = await response
          .json()
          .catch(() => ({ error: "上传失败，请稍后重试" }));
        throw new Error(payload.error?.message ?? "上传失败，请稍后重试");
      }
      const result = await response.json();
      const created = normalizeDocument(result.data.document);
      let semanticIndexed = false;
      try {
        const semantic = await buildLocalSemanticIndex(
          created.id,
          setPipelineProgress,
        );
        semanticIndexed = semantic.indexed;
      } catch {
        /* 保留关键词索引，治理中心可重建 */
      }
      setDocuments((current) => [
        created,
        ...current.filter((item) => item.id !== created.id),
      ]);
      setView("admin");
      setLoading(false);
      setPipelineProgress(null);
      setUploadOpen(false);
      form.reset();
      const refreshed = await fetch("/api/documents", { cache: "no-store" })
        .then((item) => (item.ok ? item.json() : null))
        .catch(() => null);
      if (refreshed?.data?.documents)
        setDocuments(refreshed.data.documents.map(normalizeDocument));
      if (refreshed?.data?.logs)
        setLogs(
          refreshed.data.logs.map((log: Record<string, unknown>) => ({
            id: Number(log.id),
            documentId: Number(log.document_id ?? 0),
            action: String(log.action),
            actor: String(log.actor),
            detail: String(log.detail),
            createdAt: String(log.create_time ?? ""),
          })),
        );
      notify(
        result.data.readinessWarning
          ? `资料已保存为草稿：${result.data.readinessWarning}`
          : created.status === "review"
            ? `附件已安全保存，资料已进入审核；${semanticIndexed ? "语义索引已生成" : "当前使用关键词索引"}`
            : `附件已安全保存为草稿；${semanticIndexed ? "语义索引已生成" : "当前使用关键词索引"}`,
      );
    } catch (error) {
      setLoading(false);
      setPipelineProgress(null);
      notify(error instanceof Error ? error.message : "上传失败，请稍后重试");
      return;
    }
  }
  async function engageDocument(
    document: KnowledgeDocument,
    action: "SHARE" | "SUBSCRIBE" | "UNSUBSCRIBE" | "CONTACT_OWNER",
  ) {
    try {
      if (action === "SHARE")
        await navigator.clipboard.writeText(
          `${window.location.origin}/?document=${document.id}`,
        );
      const response = await fetch("/api/engagement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, documentId: document.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "操作失败");
      if (action === "SUBSCRIBE" || action === "UNSUBSCRIBE")
        setSelected((current) =>
          current
            ? { ...current, subscribed: action === "SUBSCRIBE" }
            : current,
        );
      notify(
        action === "SHARE"
          ? "内部链接已复制，访问时仍会校验权限"
          : action === "SUBSCRIBE"
            ? "已订阅，资料更新时将收到提醒"
            : action === "UNSUBSCRIBE"
              ? "已取消订阅"
              : `已向负责人 ${document.owner} 发起联系`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败");
    }
  }

  if (authError)
    return (
      <main className="access-state">
        <span className="brand-mark">Z</span>
        <small>ENTERPRISE ACCESS</small>
        <h1>账号暂不可访问</h1>
        <p>{authError}</p>
        <div>
          <b>企业账号处理流程</b>
          <span>身份已由统一登录识别</span>
          <span>请联系知识库超级管理员分配部门与角色</span>
          <span>配置完成后刷新页面即可进入</span>
        </div>
        <a href="/signout-with-chatgpt?return_to=/">切换登录账号</a>
      </main>
    );
  function toggleSidebar() {
    setSidebarCollapsed((value) => !value);
    setAccountMenuOpen(false);
  }
  function openAi() {
    setAiOpen(true);
    setAiUnread(false);
    setAiGuideVisible(false);
    setAiSessionUpdated(false);
  }
  function closeAi() {
    setAiOpen(false);
    if (aiSessionUpdated) setAiUnread(true);
  }
  return (
    <div
      className={`enterprise-app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
    >
      <aside className="sidebar">
        <button className="brand side-brand" onClick={() => setView("library")}>
          <span className="brand-mark">Z</span>
          <span>
            知域<small>企业知识中台</small>
          </span>
        </button>
        <button
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? "展开功能栏" : "收起功能栏"}
          title={sidebarCollapsed ? "展开功能栏" : "收起功能栏"}
          onClick={toggleSidebar}
        >
          {sidebarCollapsed ? "›" : "‹"}
        </button>
        <nav className="side-nav" aria-label="功能导航">
          <span>知识服务</span>
          <button
            className={view === "library" ? "active" : ""}
            onClick={() => setView("library")}
          >
            <i>⌂</i>知识门户
          </button>
          <button
            className={view === "favorites" ? "active" : ""}
            onClick={() => setView("favorites")}
          >
            <i>☆</i>我的收藏 <em>{favorites.length}</em>
          </button>
          {hasPerm("governance:admin") && (
            <>
              <span>知识治理</span>
              <button
                className={view === "admin" ? "active" : ""}
                onClick={() => setView("admin")}
              >
                <i>▦</i>知识维护与审核
              </button>
              {hasPerm("governance:platform") && (
                <button
                  className={view === "taxonomy" ? "active" : ""}
                  onClick={() => setView("taxonomy")}
                >
                  <i>⌘</i>知识体系
                </button>
              )}
              {hasPerm("governance:platform") && (
                <button
                  className={view === "platform" ? "active" : ""}
                  onClick={() => setView("platform")}
                >
                  <i>◫</i>知识运营
                </button>
              )}
            </>
          )}
          {(hasPerm("system:accounts") || hasPerm("governance:audit")) && (
            <>
              <span>系统管理</span>
              {hasPerm("system:accounts") && (
                <button
                  className={view === "accounts" ? "active" : ""}
                  onClick={() => setView("accounts")}
                >
                  <i>♙</i>成员与权限
                </button>
              )}
              {hasPerm("system:accounts") && (
                <button
                  className={view === "settings" ? "active" : ""}
                  onClick={() => setView("settings")}
                >
                  <i>⚙</i>系统运行与自动化
                </button>
              )}
              {hasPerm("governance:audit") && (
                <button
                  className={view === "audit" ? "active" : ""}
                  onClick={() => setView("audit")}
                >
                  <i>≡</i>安全与审计
                </button>
              )}
            </>
          )}
        </nav>
        <button
          className="user-card"
          onClick={() => setAccountMenuOpen((value) => !value)}
        >
          <span>{currentUser.displayName.slice(0, 1)}</span>
          <div>
            <b>{currentUser.displayName}</b>
            <small>
              {currentUser.isPublicViewer
                ? currentUser.demoMode
                  ? currentUser.role === "SUPER_ADMIN"
                    ? "演示超级管理员"
                    : currentUser.role === "DEPT_ADMIN"
                      ? "演示部门管理员"
                      : "演示普通员工"
                  : "外部普通员工"
                : currentUser.role === "SUPER_ADMIN"
                  ? "超级管理员"
                  : currentUser.role === "DEPT_ADMIN"
                  ? "部门管理员"
                  : "普通员工"}
            </small>
          </div>
          <i>•••</i>
        </button>
        {accountMenuOpen && (
          <div className="account-menu">
            <b>{currentUser.email}</b>
            <span>{currentUser.isPublicViewer ? "身份来源：外部访问账号" : "身份来源：企业统一登录"}</span>
            {currentUser.role === "SUPER_ADMIN" && (
              <button
                onClick={() => {
                  setView("accounts");
                  setAccountMenuOpen(false);
                }}
              >
                成员与权限
              </button>
            )}
            {currentUser.demoMode && (
              <>
                <button
                  onClick={() => {
                    setDemoLoginOpen(true);
                    setAccountMenuOpen(false);
                  }}
                >
                  切换演示身份
                </button>
                <button onClick={exitDemoRole}>退出演示</button>
              </>
            )}
            {!currentUser.isPublicViewer && <a href="/signout-with-chatgpt?return_to=/">退出登录</a>}
          </div>
        )}
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="global-search">
            <span>⌕</span>
            <input
              aria-label="全局搜索"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value) {
                  setSearchResults(null);
                  setSearchCorrection(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="搜索标题、正文、标签、负责人..."
            />
            <button onClick={() => runSearch()}>
              {searchLoading ? "检索中" : "搜索"}
            </button>
          </div>
          <button
            className="header-icon"
            onClick={() => setNoticeOpen((value) => !value)}
          >
            ♢{notifications.some((n) => !n.is_read) && <i />}
          </button>
          {noticeOpen && (
            <div className="notice-panel">
              <header>
                <b>消息中心</b>
                <button onClick={() => markNoticesRead()}>全部已读</button>
              </header>
              {notifications.length ? (
                notifications.map((n) => (
                  <button
                    className={n.is_read ? "" : "unread"}
                    key={n.id}
                    onClick={() => {
                      markNoticesRead(n.id);
                      if (n.document_id) openDocument(n.document_id);
                      setNoticeOpen(false);
                    }}
                  >
                    <b>{n.title}</b>
                    <span>{n.content}</span>
                    <small>{n.create_time}</small>
                  </button>
                ))
              ) : (
                <p>暂无消息</p>
              )}
            </div>
          )}
          <button
            className="primary-action"
            onClick={openUpload}
          >
            ＋ 上传资料
          </button>
        </header>

        {view === "admin" && hasPerm("governance:admin") ? (
          <AdminView
            documents={documents}
            metrics={metrics}
            governanceTasks={governanceTasks}
            role={currentUser.role}
            onUpload={openUpload}
            onSelect={(doc) =>
              openDocument(doc).catch((error) =>
                notify(error instanceof Error ? error.message : "资料加载失败"),
              )
            }
            onStatus={updateStatus}
            onResolve={setGovernanceDialog}
            notify={notify}
            onTaskStarted={(taskId) =>
              setGovernanceTasks((current) =>
                current.map((task) =>
                  task.id === taskId
                    ? { ...task, status: "IN_PROGRESS", assignee: currentUser.displayName }
                    : task,
                ),
              )
            }
          />
        ) : view === "platform" && hasPerm("governance:platform") ? (
          <PlatformView role={currentUser.role} notify={notify} />
        ) : view === "taxonomy" && hasPerm("governance:platform") ? (
          <KnowledgeSystemView role={currentUser.role} notify={notify} onConfigurationChange={(data)=>{const categories=(data.categories??[]).map(item=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name),code:String(item.code??""),sort_order:Number(item.sort_order)||0}));setCategoryOptions(categories);setKnowledgeCategories(["全部",...Array.from(new Set(categories.map(item=>item.name).filter(Boolean)))]);setTagOptions((data.tags??[]).map(item=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name)})));}} />
        ) : view === "accounts" && hasPerm("system:accounts") ? (
          <AccountAdminView notify={notify} />
        ) : view === "settings" && hasPerm("system:accounts") ? (
          <SettingsView role={currentUser.role} notify={notify} onConfigurationChange={(data)=>{const categories=(data.categories??[]).map(item=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name),code:String(item.code??""),sort_order:Number(item.sort_order)||0}));setCategoryOptions(categories);setKnowledgeCategories(["全部",...Array.from(new Set(categories.map(item=>item.name).filter(Boolean)))]);setTagOptions((data.tags??[]).map(item=>({id:Number(item.id),dept_id:item.dept_id?Number(item.dept_id):null,name:String(item.name)})));}} />
        ) : view === "audit" && hasPerm("governance:audit") ? (
          <AuditView logs={logs} documents={documents} role={currentUser.role} notify={notify} />
        ) : (
          <LibraryView
            currentUser={currentUser}
            metrics={metrics}
            documents={visible}
            allCount={published.length}
            query={query}
            correction={searchCorrection}
            category={category}
            categories={knowledgeCategories}
            tagFilter={tagFilter}
            tags={["全部标签", ...Array.from(new Set(tagOptions.map((item) => item.name).filter(Boolean)))]}
            setCategory={setCategory}
            setTagFilter={setTagFilter}
            setQuery={setQuery}
            onSearch={runSearch}
            searchLoading={searchLoading}
            favorites={favorites}
            toggleFavorite={toggleFavorite}
            onSelect={(doc) => {
              openSearchResult(doc).catch((error) =>
                notify(error instanceof Error ? error.message : "资料加载失败"),
              );
              audit(doc.id, "VIEW", `查看《${doc.title}》`);
            }}
            favoriteMode={view === "favorites"}
          />
        )}
      </div>

      {selected && (
        <DocumentDrawer
          document={selected}
          returnToAi={documentReturnTarget === "ai"}
          canRestore={hasPerm("governance:archive")}
          favorite={favorites.includes(selected.id)}
          onClose={() => {
            setSelected(null);
            setDocumentReturnTarget(null);
          }}
          onFavorite={() => toggleFavorite(selected.id)}
          onPermissionsChanged={async () => {
            await openDocument(selected.id);
            notify("权限策略已更新并写入审计记录");
          }}
          onSaved={async () => {
            await buildLocalSemanticIndex(selected.id).catch(() => undefined);
            await openDocument(selected.id);
            const refreshed = await fetch("/api/documents", {
              cache: "no-store",
            }).then((r) => r.json());
            if (refreshed.data?.documents)
              setDocuments(refreshed.data.documents.map(normalizeDocument));
            notify("已保存为新草稿版本并更新索引，请提交审核");
          }}
          onRestore={async (version) => {
            const response = await fetch("/api/platform", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                action: "RESTORE_VERSION",
                documentId: selected.id,
                version,
              }),
            });
            const payload = await response.json();
            if (!response.ok)
              return notify(payload.error?.message ?? "恢复失败");
            await buildLocalSemanticIndex(selected.id).catch(() => undefined);
            await openDocument(selected.id);
            notify(
              `已恢复为 V${payload.data.version}.0 草稿并更新索引，需重新审核后发布`,
            );
          }}
          onFeedback={() => setFeedbackOpen(true)}
          onShare={() => engageDocument(selected, "SHARE")}
          onSubscribe={() =>
            engageDocument(
              selected,
              selected.subscribed ? "UNSUBSCRIBE" : "SUBSCRIBE",
            )
          }
          onContact={() => engageDocument(selected, "CONTACT_OWNER")}
          onExport={() => {
            downloadBlob(
              `${selected.title}.txt`,
              `${selected.title}\n\n${selected.content}\n\n负责人：${selected.owner}\n版本：V${selected.version}.0`,
              "text/plain;charset=utf-8",
            );
            audit(selected.id, "EXPORT", `导出《${selected.title}》`);
            notify("已导出文档摘要");
          }}
          onDownload={async () => {
            try {
              const response = await fetch(
                `/api/documents/${selected.id}?download=1`,
              );
              if (!response.ok) {
                const payload = await response
                  .json()
                  .catch(() => ({ error: { message: "原文件加载失败" } }));
                throw new Error(payload.error?.message ?? "原文件加载失败");
              }
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = selected.sourceName ?? selected.title;
              a.click();
              URL.revokeObjectURL(url);
              audit(selected.id, "DOWNLOAD", `下载《${selected.title}》附件`);
              notify("原文件已加载，下载任务已开始");
            } catch (error) {
              notify(error instanceof Error ? error.message : "原文件加载失败");
            }
          }}
        />
      )}

      {uploadOpen && (
        <UploadModal
          loading={loading}
          progress={pipelineProgress}
          currentUser={currentUser}
          options={uploadOptions}
          categories={categoryOptions}
          tags={tagOptions}
          spaces={knowledgeSpaces}
          config={uploadConfig}
          onSubmit={submitUpload}
          onClose={() => setUploadOpen(false)}
        />
      )}
      {feedbackOpen && selected && (
        <FeedbackModal
          onClose={() => setFeedbackOpen(false)}
          onSubmit={async (content) => {
            try {
              const response = await fetch(`/api/documents/${selected.id}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ type: "纠错", content }),
              });
              const payload = await response.json();
              if (!response.ok)
                throw new Error(payload.error?.message ?? "反馈提交失败");
              setFeedbackOpen(false);
              notify("反馈已提交给知识负责人");
            } catch (error) {
              notify(error instanceof Error ? error.message : "反馈提交失败");
            }
          }}
        />
      )}
      {workflowDialog && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setWorkflowDialog(null)}
        >
          <form
            className="feedback-modal workflow-modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const comment = String(
                new FormData(e.currentTarget).get("comment") || "",
              );
              updateStatus(workflowDialog.id, workflowDialog.action, comment);
            }}
          >
            <button type="button" onClick={() => setWorkflowDialog(null)}>
              ×
            </button>
            <span>
              {workflowDialog.action === "approve"
                ? "发布确认"
                : workflowDialog.action === "reject"
                  ? "审批驳回"
                  : "文档作废"}
            </span>
            <h2>
              {workflowDialog.action === "approve"
                ? "确认发布到知识目录？"
                : workflowDialog.action === "reject"
                  ? "请填写驳回原因"
                  : "请填写作废原因"}
            </h2>
            <p>
              {workflowDialog.action === "approve"
                ? "发布后将进入有权限用户的搜索与 AI 索引，并通知订阅者。"
                : "原因会通知上传人并永久写入审批与审计记录。"}
            </p>
            <textarea
              name="comment"
              required={workflowDialog.action !== "approve"}
              defaultValue={
                workflowDialog.action === "approve"
                  ? "内容与权限已核验，同意发布"
                  : ""
              }
              placeholder="请输入处理意见"
              rows={4}
            />
            <footer>
              <button type="button" onClick={() => setWorkflowDialog(null)}>
                取消
              </button>
              <button className="primary-action">确认执行</button>
            </footer>
          </form>
        </div>
      )}
      {governanceDialog && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setGovernanceDialog(null)}
        >
          <form
            className="feedback-modal governance-resolution"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={resolveGovernance}
          >
            <button type="button" disabled={governanceSubmitting} onClick={() => setGovernanceDialog(null)}>
              ×
            </button>
            <span>知识治理闭环</span>
            <h2>{governanceDialog.reason}</h2>
            <p>
              反馈来源：{governanceDialog.reporter} ·{" "}
              {governanceDialog.documentTitle}
              。涉及错误、缺失或过期内容时，必须先更新并发布知识，系统才允许关闭任务。
            </p>
            <label>
              关联已发布知识
              <select
                name="targetDocumentId"
                defaultValue={governanceDialog.sourceDocumentId ?? ""}
              >
                <option value="">不关联具体文档</option>
                {documents
                  .filter((doc) => doc.status === "published")
                  .map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.title} · V{doc.version}.0
                    </option>
                  ))}
              </select>
            </label>
            <label>
              处理结果
              <textarea
                name="resolution"
                required
                minLength={4}
                rows={5}
                placeholder="例如：已更新差旅制度至 V4.0 并重新发布，补充了电子发票要求。"
              />
            </label>
            <footer>
              <button type="button" disabled={governanceSubmitting} onClick={() => setGovernanceDialog(null)}>
                取消
              </button>
              <button className="primary-action is-loading" disabled={governanceSubmitting} aria-busy={governanceSubmitting}>
                {governanceSubmitting && <span className="button-spinner" />}
                {governanceSubmitting ? "正在提交..." : "提交并通知反馈人"}
              </button>
            </footer>
          </form>
        </div>
      )}
      <div className={`ai-entry${aiUnread ? " has-unread" : ""}`}>
        {aiGuideVisible && (
          <div className="ai-guide" role="status">
            <button
              aria-label="关闭智能助手提示"
              onClick={() => setAiGuideVisible(false)}
            >
              ×
            </button>
            <b>有制度或流程问题？</b>
            <span>可以问我报销、入职、研发规范等企业知识</span>
          </div>
        )}
        <button
          className="ai-fab"
          onClick={openAi}
          aria-label={aiUnread ? "问问小知，有新的回答" : "打开问问小知"}
        >
          <span className="ai-spark">✦</span>
          <span>
            <b>{aiUnread ? "回答已生成" : "问问小知"}</b>
            <small>{aiUnread ? "点击继续查看" : "回答会标注知识来源"}</small>
          </span>
          {aiUnread && (
            <i className="ai-unread" aria-label="1条未读回答">
              1
            </i>
          )}
          <em className="ai-quick">搜制度 · 查流程 · 找负责人</em>
        </button>
      </div>
      {aiOpen && (
        <AiPanel
          onClose={closeAi}
          onActivity={() => setAiSessionUpdated(true)}
          onGovernanceCreated={() =>
            refreshGovernanceTasks().catch(() => undefined)
          }
          onOpen={async (documentId) => {
            try {
              setDocumentReturnTarget("ai");
              await openDocument(documentId);
            } catch (error) {
              setDocumentReturnTarget(null);
              notify(error instanceof Error ? error.message : "资料加载失败");
            }
          }}
        />
      )}
      {demoLoginOpen && (
        <div
          className="modal-backdrop demo-login-backdrop"
          onMouseDown={() => setDemoLoginOpen(false)}
        >
          <section
            className="demo-login"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header>
              <button
                aria-label="关闭演示身份选择"
                onClick={() => setDemoLoginOpen(false)}
              >
                ×
              </button>
              <span>公开演示环境</span>
              <h2>选择演示身份登录</h2>
              <p>
                系统已为三类角色生成账号与权限，选择后按对应角色进入界面。
              </p>
            </header>
            <div className="demo-role-grid">
              {DEMO_ROLE_OPTIONS.map((role) => (
                <button
                  key={role.code}
                  className={
                    currentUser.role === role.code ? "demo-role-card active" : "demo-role-card"
                  }
                  onClick={() => selectDemoRole(role.code)}
                >
                  <b>{role.name}</b>
                  <span>{role.description}</span>
                  <i>{currentUser.role === role.code ? "当前身份" : "进入"}</i>
                </button>
              ))}
            </div>
            <footer>
              <button onClick={() => setDemoLoginOpen(false)}>
                以外部访客身份继续
              </button>
            </footer>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

function LibraryView({
  currentUser,
  metrics,
  documents,
  allCount,
  query,
  correction,
  category,
  categories,
  tagFilter,
  tags,
  setCategory,
  setTagFilter,
  setQuery,
  onSearch,
  searchLoading,
  favorites,
  toggleFavorite,
  onSelect,
  favoriteMode,
}: {
  currentUser: CurrentUser;
  metrics: Metrics;
  documents: KnowledgeDocument[];
  allCount: number;
  query: string;
  correction: QueryCorrection | null;
  category: string;
  categories: string[];
  tagFilter: string;
  tags: string[];
  setCategory: (v: string) => void;
  setTagFilter: (v: string) => void;
  setQuery: (v: string) => void;
  onSearch: (useOriginal?: boolean) => void;
  searchLoading: boolean;
  favorites: number[];
  toggleFavorite: (id: number) => void;
  onSelect: (doc: KnowledgeDocument) => void;
  favoriteMode: boolean;
}) {
  const [decisionTrees, setDecisionTrees] = useState<Array<{id:number;title:string;description:string;category:string}>>([]);
  const [decisionDialog, setDecisionDialog] = useState<{treeId:number;title:string}|null>(null);
  useEffect(()=>{fetch("/api/decisions").then(r=>r.json()).then(d=>{if(d.success)setDecisionTrees(d.data.trees)}).catch(()=>{})},[]);
  return (
    <main className="workspace">
      <section className="welcome">
        <div>
          <span className="page-kicker">KNOWLEDGE HUB</span>
          <h1>
            {favoriteMode ? "我的收藏" : `你好，${currentUser.displayName}`}
          </h1>
          <p>
            {favoriteMode
              ? "集中查看你持续关注的知识资产。"
              : `组织已沉淀 ${allCount} 份核心知识，今天从哪里开始？`}
          </p>
        </div>
        <div className="governance-chip">
          <span>知识健康度</span>
          <b>
            {metrics.health ??
              (metrics.total
                ? Math.round((metrics.verified / metrics.total) * 100)
                : 100)}
            <small>%</small>
          </b>
          <i>{metrics.due_soon} 份即将复核</i>
        </div>
      </section>
      {!favoriteMode && (
        <>
          <section className="hero-search">
            <span>⌕</span>
            <div>
              <small>混合检索：关键词 + 向量语义 + 权威度</small>
              <input
                aria-label="知识检索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSearch();
                }}
                placeholder="例如：差旅报销需要哪些材料？"
              />
            </div>
            <button onClick={() => onSearch()} disabled={searchLoading}>
              {searchLoading ? "检索中" : "搜索"}
            </button>
          </section>
          {correction?.applied &&
            correction.corrected !== correction.original && (
              <div className="search-correction" role="status">
                <span>✓</span>
                <div>
                  <b>猜你想查“{correction.corrected}”</b>
                  <small>已同时保留原词进行检索 · {correction.reason}</small>
                </div>
                <button onClick={() => onSearch(true)}>
                  仍搜索“{correction.original}”
                </button>
              </div>
            )}
        </>
      )}
      {decisionTrees.length>0&&<section style={{marginTop:24,marginBottom:24}}><div className="section-title"><div><span className="page-kicker">DECISION GUIDES</span><h2 style={{fontSize:18}}>流程指引</h2></div></div><div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>{decisionTrees.map(t=><button key={t.id} onClick={()=>setDecisionDialog({treeId:t.id,title:t.title})} style={{textAlign:"left",padding:18,border:"1px solid #dce8e4",borderRadius:11,background:"white",cursor:"pointer"}}><b style={{fontSize:12,display:"block",marginBottom:4}}>{t.title}</b><span style={{fontSize:9,color:"#8b9d98"}}>{t.description}</span><br/><small style={{display:"inline-block",marginTop:6,padding:"3px 7px",background:"#e8f4ef",borderRadius:4,fontSize:8,color:"#2b746a"}}>{t.category}</small></button>)}</div></section>}
      {decisionDialog&&<DecisionDialog treeId={decisionDialog.treeId} title={decisionDialog.title} onClose={()=>setDecisionDialog(null)}/>}
      <section className="library-section">
        <div className="section-title">
          <div>
            <span className="page-kicker">CURATED KNOWLEDGE</span>
            <h2>{favoriteMode ? "已收藏知识" : "知识目录"}</h2>
          </div>
          <div className="filter-tabs" role="tablist">
            {categories.map((item) => (
              <button
                role="tab"
                aria-selected={category === item}
                className={category === item ? "active" : ""}
                key={item}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
            {tags.length > 1 && (
              <select
                aria-label="按知识标签筛选"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
              >
                {tags.map((tag) => <option key={tag}>{tag}</option>)}
              </select>
            )}
          </div>
        </div>
        {documents.length ? (
          <div className="doc-grid">
            {documents.map((doc) => (
              <article className="doc-card" key={doc.id}>
                <div className="doc-card-head">
                  <span className={`doc-status ${doc.status}`}>
                    {statusLabel[doc.status]}
                  </span>
                  <button
                    aria-label={`${favorites.includes(doc.id) ? "取消收藏" : "收藏"}${doc.title}`}
                    onClick={() => toggleFavorite(doc.id)}
                  >
                    {favorites.includes(doc.id) ? "★" : "☆"}
                  </button>
                </div>
                <button className="doc-main" onClick={() => onSelect(doc)}>
                  <span className="file-tile">
                    {doc.mimeType?.includes("pdf")
                      ? "PDF"
                      : doc.mimeType?.includes("word")
                        ? "DOC"
                        : "DOC"}
                  </span>
                  <h3>{doc.title}</h3>
                  <p>{doc.summary}</p>
                </button>
                <div className="tag-row">
                  {doc.tags
                    .split(",")
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                </div>
                <div className="doc-foot">
                  <span className="mini-avatar">{doc.owner.slice(0, 1)}</span>
                  <div>
                    <b>{doc.owner}</b>
                    <small>
                      {doc.uploader} 上传 · V{doc.version}.0
                    </small>
                  </div>
                  <span>{doc.category}</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <b>⌕</b>
            <h3>没有匹配的知识</h3>
            <p>尝试搜索“报销”“入职”或清除筛选。</p>
            <button
              onClick={() => {
                setQuery("");
                setCategory("全部");
              }}
            >
              清除筛选
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function AdminView({
  documents,
  metrics,
  governanceTasks,
  role,
  onUpload,
  onSelect,
  onStatus,
  onResolve,
  notify,
  onTaskStarted,
}: {
  documents: KnowledgeDocument[];
  metrics: Metrics;
  governanceTasks: GovernanceTask[];
  role: string;
  onUpload: () => void;
  onSelect: (d: KnowledgeDocument) => void;
  onStatus: (
    id: number,
    action: "submit" | "approve" | "reject" | "archive",
  ) => void;
  onResolve: (task: GovernanceTask) => void;
  notify: (message: string) => void;
  onTaskStarted: (taskId: number) => void;
}) {
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [startingTaskId, setStartingTaskId] = useState<number | null>(null);
  const [timelineDocument, setTimelineDocument] = useState<KnowledgeDocument | null>(null);
  async function startGovernanceTask(task: GovernanceTask) {
    if (startingTaskId !== null) return;
    setStartingTaskId(task.id);
    try {
      const response = await fetch("/api/platform", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "START_GOVERNANCE", taskId: task.id }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? "任务认领失败");
      onTaskStarted(task.id);
      notify(
        task.sourceDocumentId
          ? "任务已由你认领，可进入关联文档核查并更新"
          : "任务已由你认领，请补充处理结果并完成闭环",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "任务认领失败");
    } finally {
      setStartingTaskId(null);
    }
  }
  const cards = [
    { label: "知识总量", value: metrics.total, hint: "权限范围内" },
    { label: "待审核", value: metrics.pending, hint: "需及时处理" },
    {
      label: "解析失败",
      value: metrics.parse_failed,
      hint: "可在治理中心重试",
    },
    { label: "即将复核", value: metrics.due_soon, hint: "未来 30 天" },
  ];
  const canApprove = role === "SUPER_ADMIN" || role === "DEPT_ADMIN";
  const shown =
    statusFilter === "ALL"
      ? documents
      : documents.filter((doc) => doc.status === statusFilter);
  return (
    <main className="workspace">
      <section className="admin-heading">
        <div>
          <span className="page-kicker">GOVERNANCE CONSOLE</span>
          <h1>知识维护与审核</h1>
          <p>管理资料入库、审核发布、用户反馈、版本与生命周期。</p>
        </div>
        <button className="primary-action" onClick={onUpload}>
          ＋ 上传新资料
        </button>
      </section>
      <div className="metric-grid">
        {cards.map((card) => (
          <div key={card.label}>
            <span>{card.label}</span>
            <b>{card.value}</b>
            <small>{card.hint}</small>
          </div>
        ))}
      </div>
      {governanceTasks.length > 0 && (
        <section className="governance-tasks">
          <div className="table-title">
            <div>
              <h2>知识反馈待治理</h2>
              <p>AI 问答“没解决”和文档纠错统一进入负责人处理闭环</p>
            </div>
            <span>{governanceTasks.length} 项处理中</span>
          </div>
          {governanceTasks.map((task) => (
            <div className="governance-task" key={task.id}>
              <span>{task.status === "IN_PROGRESS" ? "处理中" : "待办"}</span>
              <div>
                <b>
                  {task.reason} · {task.documentTitle}
                </b>
                <p>{task.detail || "用户未补充具体说明"}</p>
                <small>
                  {task.reporter} 提交
                  {task.assignee ? ` · ${task.assignee} 负责` : ""} · {task.createdAt}
                </small>
              </div>
              {task.status === "IN_PROGRESS" ? (
                task.sourceDocumentId ? (
                  <button onClick={() => onSelect({id: task.sourceDocumentId!} as KnowledgeDocument)}>编辑文档</button>
                ) : (
                  <button onClick={() => onResolve(task)}>处理</button>
                )
              ) : (
                <button
                  className={startingTaskId === task.id ? "is-loading" : undefined}
                  disabled={startingTaskId !== null}
                  aria-busy={startingTaskId === task.id}
                  onClick={() => startGovernanceTask(task)}
                >
                  {startingTaskId === task.id && <span className="button-spinner" />}
                  {startingTaskId === task.id ? "正在认领..." : "开始处理"}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <section className="table-card">
        <div className="table-title">
          <div>
            <h2>资料与审批记录</h2>
            <p>草稿提交部门审核，审批通过后自动进入知识目录</p>
          </div>
          <select
            aria-label="按状态筛选资料"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">全部状态</option>
            <option value="draft">草稿</option>
            <option value="review">待审核</option>
            <option value="published">已发布</option>
            <option value="archived">已作废</option>
          </select>
        </div>
        <div className="data-table">
          <div className="data-row table-head">
            <span>资料名称</span>
            <span>分类 / 密级</span>
            <span>上传人与负责人</span>
            <span>版本 / 关键时间</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {shown.map((doc) => (
            <div className="data-row" key={doc.id}>
              <button className="table-document" onClick={() => onSelect(doc)}>
                <span>{doc.mimeType?.includes("pdf") ? "P" : "W"}</span>
                <div>
                  <b>{doc.title}</b>
                  <small>
                    {doc.sourceName ?? "在线文档"} · {fmtSize(doc.size)}
                  </small>
                  <small>上传：{fmtBusinessTime(doc.createdAt)}</small>
                </div>
              </button>
              <span>
                <b>{doc.category}</b>
                <small>{doc.securityLevel}</small>
              </span>
              <span>
                <b>{doc.uploader}</b>
                <small>负责人：{doc.owner}</small>
              </span>
              <span>
                <b>V{doc.version}.0</b>
                <small>修改：{fmtBusinessTime(doc.updatedAt)}</small>
                <small>复核：{doc.reviewDueAt || "未设置"}</small>
              </span>
              <span>
                <i className={`doc-status ${doc.status}`}>
                  {statusLabel[doc.status]}
                </i>
                <small>
                  {doc.approvedAt
                    ? `发布：${fmtBusinessTime(doc.approvedAt)}`
                    : doc.submittedAt
                      ? `发起审批：${fmtBusinessTime(doc.submittedAt)}`
                      : "尚未发起审批"}
                </small>
              </span>
              <span className="row-actions">
                <button onClick={() => setTimelineDocument(doc)}>时间记录</button>
                {doc.status === "draft" ? (
                  <button onClick={() => onStatus(doc.id, "submit")}>
                    提交审核
                  </button>
                ) : doc.status === "review" && canApprove ? (
                  <>
                    <button onClick={() => onStatus(doc.id, "approve")}>
                      审批通过
                    </button>
                    <button onClick={() => onStatus(doc.id, "reject")}>
                      驳回
                    </button>
                  </>
                ) : doc.status === "published" && canApprove ? (
                  <>
                    <button onClick={() => onStatus(doc.id, "archive")}>
                      作废
                    </button>
                    <button onClick={() => onSelect(doc)}>查看</button>
                  </>
                ) : (
                  <button onClick={() => onSelect(doc)}>查看</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>
      {timelineDocument && (
        <div className="modal-backdrop" onMouseDown={() => setTimelineDocument(null)}>
          <section className="feedback-modal document-timeline" onMouseDown={(event) => event.stopPropagation()}>
            <button aria-label="关闭时间记录" onClick={() => setTimelineDocument(null)}>×</button>
            <span>DOCUMENT AUDIT TIMELINE</span>
            <h2>{timelineDocument.title}</h2>
            <p>时间来自文档、版本、解析任务和审批记录，未发生的节点不会生成虚假时间。</p>
            <div className="timeline-list">
              {[
                ["上传创建", timelineDocument.createdAt, "资料进入系统并生成 V1.0"],
                ["解析完成", timelineDocument.ingestedAt, "正文提取、切片与入库完成"],
                ["最近版本", timelineDocument.lastVersionAt, `当前 V${timelineDocument.version}.0`],
                ["最近修改", timelineDocument.updatedAt, "资料字段、内容或状态最后变更"],
                ["发起审批", timelineDocument.submittedAt, "同时进入部门审批人的待办，即待办接收时间"],
                ["审批驳回", timelineDocument.rejectedAt, "仅在发生驳回时记录"],
                ["审批通过并发布", timelineDocument.approvedAt, "当前流程审批通过后立即生效发布"],
                ["AI 索引完成", timelineDocument.aiIndexedAt, "资料可参与语义检索和 RAG 问答"],
                ["内容核验", timelineDocument.verifiedAt, "负责人或管理员完成有效性核验"],
                ["作废", timelineDocument.voidedAt, "归档失效或主动作废"],
                ["软删除", timelineDocument.deletedAt, "进入回收站，可按权限恢复或彻底删除"],
                ["下次复核", timelineDocument.reviewDueAt, "到期前进入知识治理待办"],
              ].map(([label, value, description]) => (
                <div className={value ? "occurred" : "pending"} key={label}>
                  <i />
                  <div>
                    <b>{label}</b>
                    <small>{description}</small>
                  </div>
                  <time>{fmtBusinessTime(value)}</time>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function PlatformView({
  role,
  notify,
}: {
  role: string;
  notify: (message: string) => void;
}) {
  type PlatformData = {
    metrics: Record<string, number>;
    searches: Record<string, number>;
    content: { action: string; count: number }[];
    quality: { question: string; count: number }[];
    jobs: Record<string, unknown>[];
    spaces: Record<string, unknown>[];
    approvals: Record<string, unknown>[];
    settings: Record<string, unknown>[];
  };
  type ScanResult = { expired:Array<Record<string,unknown>>;duplicates:Array<{docs:Array<Record<string,unknown>>;reason:string}>;parseFails:Array<Record<string,unknown>>;empty:Array<Record<string,unknown>>;pending:Array<Record<string,unknown>>;zeroSearch:Array<Record<string,unknown>> };
  const [data, setData] = useState<PlatformData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanResult, setScanResult] = useState<ScanResult|null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [agentResult, setAgentResult] = useState<{trace:Array<{tool:string;args:unknown;result:string}>;summary:string}|null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentQuestion, setAgentQuestion] = useState("");
  async function runAgentChat(question?:string) {
    const q = question || agentQuestion.trim();
    if(!q || agentLoading) return;
    setAgentLoading(true); setAgentResult(null);
    try {
      const r = await fetch("/api/ai/ask",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:q,agent:true,mode:"agent"})});
      const p = await r.json();
      if(!r.ok) throw new Error(p.error?.message??"Agent执行失败");
      setAgentResult({trace:p.data?.toolCalls||[],summary:p.data?.answer||""});
      setAgentQuestion("");
    } catch(e:any) { notify(e.message); }
    finally { setAgentLoading(false); }
  }
  async function runScan(){setScanLoading(true);setScanResult(null);setAgentResult(null);try{const r=await fetch("/api/governance/scan",{cache:"no-store"});const p=await r.json();if(!r.ok)throw new Error(p.error?.message??"巡检失败");setScanResult(p.data);notify(`巡检完成：${p.data.expired.length}过期 ${p.data.duplicates.length}重复`)}catch(e:any){notify(e.message)}finally{setScanLoading(false)}}
  async function runAgentAnalysis(){setAgentLoading(true);try{const r=await fetch("/api/governance/scan?agent=true",{cache:"no-store"});const p=await r.json();if(!r.ok)throw new Error(p.error?.message??"Agent分析失败");setAgentResult({trace:p.data.agentTrace||[],summary:p.data.agentSummary||""});notify(`Agent完成：${p.data.agentTrace?.length||0}步推理`)}catch(e:any){notify(e.message)}finally{setAgentLoading(false)}}
  async function handleScanAction(action:string,id:number,title:string=""){const labels:Record<string,string>={ARCHIVE:"作废",REPROCESS:"重新解析",MARK_DUP:"标记重复",DELETE:"删除",CREATE_GAP_TASK:"建知识缺口任务"};if(!confirm(`确认对《${title}》执行${labels[action]||action}？此操作将写入审批记录。`))return;try{let r;if(action==="ARCHIVE"){r=await fetch("/api/documents",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,action:"archive",comment:"巡检作废"})})}else if(action==="DELETE"){r=await fetch(`/api/documents/${id}`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({action:"delete"})})}else if(action==="REPROCESS"){r=await fetch("/api/platform",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"PROCESS",documentId:id})})}else if(action==="MARK_DUP"){r=await fetch("/api/enterprise",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"SAVE_TAG",name:"疑似重复",documentId:id})})}else if(action==="CREATE_GAP_TASK"){r=await fetch("/api/enterprise",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"CREATE_GAP_TASK",reason:title,detail:'搜索"{title}"无结果'})})}else{notify("不支持的操作");return}const p=await r.json();if(!r.ok)throw new Error(p.error?.message??"操作失败");notify("已执行");runScan()}catch(e:any){notify(e.message)}}
  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/platform", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? "治理数据加载失败");
      setData(payload.data);
    } catch (error) {
      notify(error instanceof Error ? error.message : "治理数据加载失败");
    } finally {
      setLoading(false);
    }
  }
  async function action(body:Record<string,unknown>){
    try{
      const response=await fetch("/api/platform",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error?.message??"操作失败");
      await load();
      notify("操作已生效，运营数据已刷新");
      return true;
    }catch(error){notify(error instanceof Error?error.message:"操作失败");return false;}
  }
  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading || !data)
    return (
      <main className="workspace">
        <div className="account-loading">正在汇总真实治理数据...</div>
      </main>
    );
  const m = data.metrics ?? {},
    s = data.searches ?? {};
  return (
    <main className="workspace">
      <section className="admin-heading">
        <div>
          <span className="page-kicker">KNOWLEDGE OPERATIONS</span>
          <h1>知识运营</h1>
          <p>知识库运行指标与智能巡检。</p>
        </div>
        <div className="member-actions">
          <button className="primary-action" onClick={()=>{runScan();runAgentAnalysis();}} disabled={scanLoading||agentLoading}>
            {scanLoading||agentLoading?"巡检中…":"🔍 智能巡检"}
          </button>
          <button className="outline-action" onClick={load}>
            刷新数据
          </button>
        </div>
      </section>
      <div className="metric-grid">
        <div>
          <span>知识健康度</span>
          <b>{m.health ?? 100}%</b>
          <small>动态计算</small>
        </div>
        <div>
          <span>30天检索</span>
          <b>{s.searches ?? 0}</b>
          <small>{s.users ?? 0} 位用户</small>
        </div>
        <div>
          <span>零结果</span>
          <b>{s.zero_results ?? 0}</b>
          <small>需补充知识</small>
        </div>
        <div>
          <span>解析失败</span>
          <b>{m.parse_failed ?? 0}</b>
          <small>支持重试</small>
        </div>
      </div>
      {scanResult&&<div className="scan-dashboard">
        <section className="platform-card wide-card">
          <header><h2>🔍 智能巡检报告</h2><span>{scanResult.expired.length}过期 {scanResult.duplicates.length}重复 {scanResult.parseFails.length}解析失败 {scanResult.empty.length}空内容</span></header>
          {agentResult&&<div className="agent-trace"><details><summary>🤖 Agent 自主规划了 {agentResult.trace.length} 步推理（点击展开链路）</summary><div className="trace-list">{agentResult.trace.map((t:any,i:number)=><div key={i} className="trace-step"><span className="trace-num">{i+1}</span><div><b>{t.tool}</b></div></div>)}</div></details></div>}
          {agentResult?.summary&&<div className="agent-summary"><b>🤖 Agent 分析结论</b><p style={{whiteSpace:"pre-wrap",maxHeight:300,overflow:"auto"}}>{agentResult.summary}</p></div>}
          {scanResult.expired.length>0&&<div className="scan-group"><h3>📌 过期文档（{scanResult.expired.length}）</h3>{scanResult.expired.map((d:any)=><div key={d.id} className="scan-item expired"><div><b>{d.title}</b><small>V{d.version}.0 · {d.dept_name} · 负责人：{d.owner} · 复核日：{d.review_due_at?.slice(0,10)}</small></div>{d.status==='EXPIRED_VOID'?<span className="scan-done">已作废</span>:<button onClick={()=>handleScanAction('ARCHIVE',d.id,d.title)}>作废</button>}</div>)}</div>}
          {scanResult.duplicates.length>0&&<div className="scan-group"><h3>🔄 疑似重复（{scanResult.duplicates.length} 组）</h3>{scanResult.duplicates.map((g:any,i:number)=><div key={i} className="scan-item duplicate"><div><b>{g.reason}</b><small>{g.docs.map((d:any)=>`《${d.title}》V${d.version}.0`).join(' vs ')}</small></div><button onClick={()=>handleScanAction('MARK_DUP',g.docs[0].id,g.docs[0].title)}>标记重复</button></div>)}</div>}
          {scanResult.parseFails.length>0&&<div className="scan-group"><h3>⚠️ 解析失败（{scanResult.parseFails.length}）</h3>{scanResult.parseFails.map((d:any)=><div key={d.id} className="scan-item fail"><div><b>{d.title}</b><small>{d.dept_name} · {d.source_name||'未知文件'} · 状态：{d.parse_status}</small></div><button onClick={()=>handleScanAction('REPROCESS',d.id,d.title)}>重新解析</button></div>)}</div>}
          {scanResult.empty.length>0&&<div className="scan-group"><h3>📝 空内容草稿（{scanResult.empty.length}）</h3>{scanResult.empty.map((d:any)=><div key={d.id} className="scan-item empty-draft"><div><b>{d.title}</b><small>V{d.version}.0 · {d.dept_name} · 负责人：{d.owner}</small></div><button onClick={()=>handleScanAction('DELETE',d.id,d.title)}>删除</button></div>)}</div>}
          {scanResult.zeroSearch.length>0&&<div className="scan-group"><h3>🔎 搜索无结果（{scanResult.zeroSearch.length} 次）</h3>{scanResult.zeroSearch.slice(0,5).map((s:any,i:number)=><div key={i} className="scan-item zero"><div><b>&ldquo;{s.query}&rdquo;</b><small>出现 {s.cnt} 次 · 最近：{s.last_time?.slice(0,10)}</small></div><button onClick={()=>handleScanAction('CREATE_GAP_TASK',0,s.query)}>补充知识</button></div>)}</div>}
        </section>
      </div>}
      <div className="platform-grid">
        <section className="platform-card">
          <header>
            <h2>解析与索引状态</h2>
            <span>{data.jobs.length} 条</span>
          </header>
          {data.jobs.map((job) => (
            <div className="platform-row" key={String(job.id)}>
              <div>
                <b>{String(job.title)}</b>
                <small>
                  V{String(job.document_version)} · {String(job.stage)} ·{" "}
                  {String(job.extracted_chars)} 字
                </small>
              </div>
              <i className={String(job.status).toLowerCase()}>
                {String(job.status)}
              </i>
              {String(job.status) === "FAILED" && (
                <button
                  onClick={() =>
                    action({ action: "PROCESS", documentId: job.document_id })
                  }
                >
                  重新解析
                </button>
              )}
            </div>
          ))}
        </section>
        <section className="platform-card">
          <header>
            <h2>零结果与知识缺口</h2>
            <span>近30天</span>
          </header>
          {data.quality.length ? (
            data.quality.map((item) => (
              <div className="platform-row" key={item.question}>
                <div>
                  <b>{item.question}</b>
                  <small>出现 {item.count} 次，建议补充或优化标签</small>
                </div>
              </div>
            ))
          ) : (
            <p className="platform-empty">当前没有未命中问答</p>
          )}
        </section>
      </div>
      <section className="platform-card wide-card">
        <header>
          <h2>审批与版本轨迹</h2>
          <span>{data.approvals.length} 条</span>
        </header>
        {data.approvals.slice(0, 12).map((row) => (
          <div className="platform-row" key={String(row.id)}>
            <div>
              <b>
                {String(row.title)} · {String(row.action)}
              </b>
              <small>
                {String(row.applicant)} → {String(row.approver ?? "待审批")} ·{" "}
                {String(row.create_time)}
              </small>
            </div>
          </div>
        ))}
      </section>
      {role === "SUPER_ADMIN" && (
        <section className="platform-card wide-card">
          <header>
            <h2>业务运行参数</h2>
            <span>检索与自动化参数请在“系统运行与自动化”中统一调整</span>
          </header>
          {data.settings.filter(setting=>!["hybrid.vector_weight","hybrid.keyword_weight","rag.top_k"].includes(String(setting.key))).map((setting) => (
            <form
              className="setting-row"
              key={String(setting.key)}
              onSubmit={(e) => {
                e.preventDefault();
                const value = String(
                  new FormData(e.currentTarget).get("value"),
                );
                action({
                  action: "UPDATE_SETTING",
                  key: setting.key,
                  value,
                  description: setting.description,
                });
              }}
            >
              <label>
                <b>{String(setting.key)}</b>
                <small>{String(setting.description)}</small>
              </label>
              <input name="value" defaultValue={String(setting.value)} />
              <button>保存</button>
            </form>
          ))}
        </section>
      )}
      <section className="platform-card wide-card" style={{marginTop:18}}>
        <header>
          <h2>智能治理助手</h2>
          <span>自动巡检知识质量并生成治理建议</span>
        </header>
        <div style={{padding:"0 18px 12px"}}>
          <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
            {["巡检知识库质量：列出过期、重复、解析失败文档并给出治理建议","扫描本月即将到期的高频文档","检测所有部门的重复内容并建治理任务"].map(q=>(
              <button key={q} onClick={()=>runAgentChat(q)} disabled={agentLoading} style={{fontSize:9,padding:"6px 12px",border:"1px solid #dce8e4",borderRadius:6,background:"white",cursor:"pointer",textAlign:"left",whiteSpace:"nowrap"}}>{q.slice(0,24)}…</button>
            ))}
          </div>
          <div style={{display:"flex",gap:8}}>
            <input value={agentQuestion} onChange={e=>setAgentQuestion(e.target.value)} placeholder="或输入自定义巡检指令…" onKeyDown={e=>{if(e.key==="Enter")runAgentChat()}} style={{flex:1,padding:"8px 12px",border:"1px solid #dce4e1",borderRadius:6,fontSize:10,outline:0}} />
            <button onClick={()=>runAgentChat()} disabled={agentLoading||!agentQuestion.trim()} style={{padding:"8px 16px",border:0,borderRadius:6,background:"#16796d",color:"white",fontSize:10,cursor:"pointer",whiteSpace:"nowrap"}}>{agentLoading?"分析中…":"执行"}</button>
          </div>
        </div>
        {agentResult&&(
          <div style={{margin:"0 18px 12px"}}>
            {agentResult.trace.length>0&&<details style={{marginBottom:8}}><summary style={{fontSize:10,color:"#1a6b5e",cursor:"pointer"}}>推理链路（{agentResult.trace.length} 步）</summary><div style={{marginTop:6,display:"grid",gap:3}}>{agentResult.trace.map((t:any,i:number)=><div key={i} style={{display:"flex",gap:6,padding:"5px 8px",background:"#f8faf9",borderRadius:4,fontSize:9}}><span style={{color:"#16796d",fontWeight:700}}>{i+1}.</span><b style={{color:"#1a5c55"}}>{t.tool}</b></div>)}</div></details>}
            <div style={{padding:10,background:"#f0f7fa",borderRadius:6,fontSize:10,color:"#4a6878",whiteSpace:"pre-wrap",maxHeight:260,overflow:"auto"}}>{agentResult.summary}</div>
          </div>
        )}
      </section>
    </main>
  );
}

function EnterprisePanels({
  role,
  notify,
  onConfigurationChange,
  section,
}: {
  role: string;
  notify: (message: string) => void;
  onConfigurationChange: (data:Record<string,Record<string,unknown>[]>)=>void;
  section: "knowledge" | "security" | "operations";
}) {
  const [evalResult, setEvalResult] = useState<{total:number;passed:number;failed:number;score:number;results:Array<{caseId:number;question:string;recall:number;keyword:number;score:number;status:string}>}|null>(null);
  const [evalRunning, setEvalRunning] = useState(false);
  const [aiStrategyTab,setAiStrategyTab]=useState<"strategy"|"versions"|"evaluation"|"monitoring">("strategy");
  const [selectedPromptId,setSelectedPromptId]=useState<number>(0);
  const [promptTest,setPromptTest]=useState<{answer:string;sources:Array<Record<string,unknown>>;assembledPrompt:string;provider:string;model:string}|null>(null);
  const [promptTesting,setPromptTesting]=useState(false);
  const [comparePromptIds,setComparePromptIds]=useState<[number,number]>([0,0]);
  useEffect(()=>{if(selectedPromptId>0)setAiStrategyTab("evaluation");},[selectedPromptId]);
  const [pendingTaxonomyDelete,setPendingTaxonomyDelete]=useState<{type:"CATEGORY"|"GROUP"|"TAG";id:number;name:string;code?:string;deptId?:number|null;references?:number;targetId?:number}|null>(null);
  const [editingCategory,setEditingCategory]=useState<Record<string,unknown>|null>(null);
  const [data, setData] = useState<Record<
    string,
    Record<string, unknown>[]
  > | null>(null);
  async function load() {
    const response = await fetch("/api/enterprise", { cache: "no-store" }),
      payload = await response.json();
    if (!response.ok)
      return notify(payload.error?.message ?? "企业治理数据加载失败");
    setData(payload.data);
    onConfigurationChange(payload.data);
    return payload.data as Record<string,Record<string,unknown>[]>;
  }
  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(body: Record<string, unknown>) {
    const response = await fetch("/api/enterprise", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      payload = await response.json();
    if (!response.ok) return notify(payload.error?.message ?? "操作失败");
    await load();
    notify(String(payload.data?.message||"操作已生效，当前页面及业务表单已同步更新"));
    return true;
  }
  if (!data)
    return (
      <section className="platform-card wide-card">
        <p className="platform-empty">企业治理能力加载中...</p>
      </section>
    );
  const categories = data.categories ?? [],
    groups=data.groups??[],
    departments=data.departments??[],
    security = data.security ?? [],
    prompts = data.prompts ?? [],
    connectors = data.connectors ?? [],
    backups = data.backups ?? [],
    cases = data.evalCases ?? [],
    webhooks = data.webhooks ?? [],
    retention = data.retention ?? [];
  const activePrompt=prompts.find(item=>item.status==="PUBLISHED");
  const selectedPrompt=prompts.find(item=>Number(item.id)===(selectedPromptId||Number(activePrompt?.id)||Number(prompts[0]?.id)));
  const aiMetrics=(data.aiMetrics as unknown as Record<string,unknown>)??{};
  const promptReleases=data.promptReleases??[];
  const releaseMinScore=Number((data.promptSettings as unknown as Record<string,unknown>)?.["prompt.release_min_score"]||85);
  return (
    <>
      {section === "knowledge" && <div className="platform-grid">
        <section className="platform-card">
          <header>
            <h2>知识分类</h2>
            <span>
              {categories.length} 个分类
            </span>
          </header>
          {categories.map((item) => (
            <div className="platform-row" key={String(item.id)}>
              <div>
                <b>{String(item.name)}</b>
                <small>
                  {String(item.code)} · {item.dept_id ? "部门级" : "全局"}
                </small>
              </div>
              {String(item.code)==="UNCLASSIFIED"?<span className="status-pill">系统兜底</span>:<><button onClick={()=>setEditingCategory(item)}>重命名</button><button onClick={()=>setPendingTaxonomyDelete({type:"CATEGORY",id:Number(item.id),name:String(item.name),code:String(item.code),deptId:item.dept_id?Number(item.dept_id):null,references:Number(item.document_count)||0})}>{Number(item.document_count)?"迁移/停用":"删除"}</button></>}
            </div>
          ))}
          <form
            className="inline-governance"
            onSubmit={async (e) => {
              e.preventDefault();
              const form=e.currentTarget;
              const saved=await act({
                action: "SAVE_CATEGORY",
                ...Object.fromEntries(new FormData(form)),
              });
              if(saved)form.reset();
            }}
          >
            <input name="name" required placeholder="分类名称" />
            <input name="code" required placeholder="分类编码" />
            <select name="deptId" defaultValue=""><option value="">全局分类</option>{departments.map(item=><option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select>
            <button>新增分类</button>
          </form>
        </section>
        <section className="platform-card">
          <header><h2>知识标签</h2><span>{(data.tags??[]).length} 个标签</span></header>
          {(data.tags??[]).map(item=><div className="platform-row" key={String(item.id)}><div><b>{String(item.name)}</b><small>{String(item.department??"全局")} · 上传资料时自动联动</small></div><button onClick={()=>setPendingTaxonomyDelete({type:"TAG",id:Number(item.id),name:String(item.name)})}>删除</button></div>)}
          {!(data.tags??[]).length&&<p className="platform-empty">尚未配置业务标签</p>}
          <form className="inline-governance" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const saved=await act({action:"SAVE_TAG",...Object.fromEntries(new FormData(form))});if(saved)form.reset();}}>
            <input name="name" required placeholder="标签名称" />
            <select name="deptId" required defaultValue={String(departments[0]?.id??"")}>{departments.map(item=><option key={String(item.id)} value={String(item.id)}>{String(item.name)}</option>)}</select>
            <button>新增标签</button>
          </form>
        </section>
      </div>}
      {section === "security" && <div className="platform-grid">
        <section className="platform-card">
          <header>
            <h2>安全事件</h2>
            <span>{security.length} 项待处理</span>
          </header>
          {security.length ? (
            security.map((item) => (
              <div className="platform-row" key={String(item.id)}>
                <div>
                  <b>
                    {String(item.type)} · {String(item.title ?? "平台事件")}
                  </b>
                  <small>
                    {String(item.severity)} · {String(item.detail)}
                  </small>
                  <small>
                    证据：{String(item.source_name || item.title || "平台操作记录")}
                    {item.scan_status ? ` · 扫描 ${String(item.scan_status)}` : ""}
                    {item.dlp_findings && String(item.dlp_findings) !== "[]" ? ` · ${String(item.dlp_findings)}` : ""}
                  </small>
                </div>
                {item.document_id && <button onClick={() => act({ action: "RESOLVE_SECURITY", id: item.id, resolution: "RESTRICT" })}>限制访问</button>}
                {item.document_id && <button onClick={() => act({ action: "RESOLVE_SECURITY", id: item.id, resolution: "QUARANTINE" })}>隔离资料</button>}
                <button onClick={() => act({ action: "RESOLVE_SECURITY", id: item.id, resolution: "ACKNOWLEDGE" })}>确认并关闭</button>
              </div>
            ))
          ) : (
            <p className="platform-empty">当前没有未处理安全事件</p>
          )}
        </section>
      </div>}
      {section === "operations" && role === "SUPER_ADMIN" && (
        <>
          <section className="platform-card wide-card ai-strategy-center">
            <header><div><h2>AI 策略与评测</h2><small>配置、评测、审核、发布与回滚全流程</small></div><span>生产版本 V{String(activePrompt?.version??"—")} · 门槛 {releaseMinScore} 分</span></header>
            <div className="ai-strategy-tabs">{([['strategy','回答策略'],['versions','版本发布'],['evaluation','测试评测'],['monitoring','运行监控']] as const).map(([key,label])=><button key={key} className={aiStrategyTab===key?'active':''} onClick={()=>setAiStrategyTab(key)}>{label}</button>)}</div>
            {aiStrategyTab==="strategy"&&<form className="ai-strategy-form" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,v=new FormData(form);const saved=await act({action:"SAVE_PROMPT",name:v.get("name"),code:"enterprise_rag",changeNote:v.get("changeNote"),instructions:v.get("instructions"),strategy:{sections:{companyEvidence:v.has("companyEvidence"),generalAdvice:v.has("generalAdvice"),pendingConfirmation:v.has("pendingConfirmation")},facts:{citationRequired:v.has("citationRequired"),noInternalGuess:v.has("noInternalGuess"),generalAdviceLabel:v.has("generalAdviceLabel")},style:v.get("style"),detail:v.get("detail"),temperature:Number(v.get("temperature")),maxCitations:Number(v.get("maxCitations")),maxTokens:Number(v.get("maxTokens"))}});if(saved)setAiStrategyTab("versions");}}>
              <div className="strategy-field-grid"><label>策略名称<input name="name" defaultValue="企业知识问答" required /></label><label>变更说明<input name="changeNote" placeholder="例如：增加通用建议分层" required /></label></div>
              <div className="strategy-config-grid">
                <fieldset><legend>回答结构</legend><label><input type="checkbox" name="companyEvidence" defaultChecked/>公司知识依据</label><label><input type="checkbox" name="generalAdvice" defaultChecked/>通用建议</label><label><input type="checkbox" name="pendingConfirmation" defaultChecked/>待确认事项</label></fieldset>
                <fieldset><legend>事实与引用</legend><label><input type="checkbox" name="citationRequired" defaultChecked/>企业事实必须有引用</label><label><input type="checkbox" name="noInternalGuess" defaultChecked/>禁止猜测内部路径</label><label><input type="checkbox" name="generalAdviceLabel" defaultChecked/>通用建议显式标识</label></fieldset>
                <fieldset><legend>回答体验</legend><label>语气<select name="style" defaultValue="PROFESSIONAL"><option value="PROFESSIONAL">专业简洁</option><option value="FRIENDLY">自然友好</option><option value="STRICT">正式严谨</option></select></label><label>详细程度<select name="detail" defaultValue="STANDARD"><option value="CONCISE">精简</option><option value="STANDARD">标准</option><option value="DETAILED">详细</option></select></label></fieldset>
                <fieldset><legend>模型与输出</legend><label>温度<input name="temperature" type="number" min="0" max="1" step="0.1" defaultValue="0.2"/></label><label>最大引用<input name="maxCitations" type="number" min="1" max="10" defaultValue="5"/></label><label>最大输出 Token<input name="maxTokens" type="number" min="300" max="4000" defaultValue="1200"/></label></fieldset>
              </div>
              <label>高级补充指令（选填）<textarea name="instructions" placeholder="仅填写业务特殊规则，系统会自动组装安全与引用约束"/></label><button className="platform-wide-action">保存为新草稿版本</button>
            </form>}
            {aiStrategyTab==="versions"&&<div className="prompt-version-list"><div className="prompt-compare-controls"><b>版本对比</b><select value={String(comparePromptIds[0]||prompts[0]?.id||"")} onChange={e=>setComparePromptIds(([_,right])=>[Number(e.target.value),right])}>{prompts.map(item=><option key={String(item.id)} value={String(item.id)}>V{String(item.version)} · {String(item.status)}</option>)}</select><span>对比</span><select value={String(comparePromptIds[1]||prompts[1]?.id||prompts[0]?.id||"")} onChange={e=>setComparePromptIds(([left])=>[left,Number(e.target.value)])}>{prompts.map(item=><option key={String(item.id)} value={String(item.id)}>V{String(item.version)} · {String(item.status)}</option>)}</select></div><div className="prompt-compare-grid">{[comparePromptIds[0]||Number(prompts[0]?.id),comparePromptIds[1]||Number(prompts[1]?.id||prompts[0]?.id)].map((id,index)=>{const item=prompts.find(p=>Number(p.id)===id);return <section key={`${id}-${index}`}><b>V{String(item?.version??"—")} · {String(item?.status??"")}</b><small>{String(item?.change_note||"暂无变更说明")}</small><pre>{String(item?.instructions||"")}</pre></section>})}</div>{prompts.map(item=><div className="prompt-version-card" key={String(item.id)}><div><b>{String(item.name)} · V{String(item.version)}</b><small>{String(item.status)} · {String(item.creator)} · 评测 {Number(item.eval_score||0)} 分</small><small>{String(item.change_note||"暂无变更说明")}</small></div><div><button onClick={()=>setSelectedPromptId(Number(item.id))}>测试</button>{["DRAFT","TESTING"].includes(String(item.status))&&<button disabled={Number(item.eval_score)<releaseMinScore} onClick={()=>act({action:"SUBMIT_PROMPT",id:item.id})}>提交审核</button>}{item.status==="PENDING_APPROVAL"&&<button onClick={()=>act({action:"PUBLISH_PROMPT",id:item.id})}>审核发布</button>}{item.status==="RETIRED"&&<button onClick={()=>act({action:"ROLLBACK_PROMPT",id:item.id})}>回滚此版</button>}{item.status==="PUBLISHED"&&<span className="status-pill">生产中</span>}</div></div>)}</div>}
            {aiStrategyTab==="evaluation"&&<div className="ai-evaluation-workbench">
              <label>待测试版本<select value={String(selectedPrompt?.id??"")} onChange={e=>setSelectedPromptId(Number(e.target.value))}>{prompts.map(item=><option key={String(item.id)} value={String(item.id)}>V{String(item.version)} · {String(item.status)} · {Number(item.eval_score||0)}分</option>)}</select></label>
              <form className="prompt-test-form" onSubmit={async e=>{e.preventDefault();const q=String(new FormData(e.currentTarget).get("question")||"");setPromptTesting(true);setPromptTest(null);try{const r=await fetch("/api/enterprise",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"TEST_PROMPT",promptId:selectedPrompt?.id,question:q})}),p=await r.json();if(!r.ok)throw new Error(p.error?.message||"测试失败");setPromptTest(p.data);}catch(error){notify(error instanceof Error?error.message:"测试失败");}finally{setPromptTesting(false);}}}><input name="question" required placeholder="输入一个真实业务问题，例如：报销在哪里提交？"/><button disabled={promptTesting}>{promptTesting?"生成中…":"在线测试"}</button></form>
              {promptTest&&<div className="prompt-test-result"><section><b>模型回答</b><p>{promptTest.answer}</p></section><section><b>检索与运行</b><small>{promptTest.provider} · {promptTest.model||"默认模型"} · {promptTest.sources.length} 条候选来源</small>{promptTest.sources.map((s,i)=><p key={i}>[{String(s.citation)}] {String(s.title)} · 匹配 {String(s.score)}</p>)}</section><details><summary>查看最终组装 Prompt</summary><pre>{promptTest.assembledPrompt}</pre></details></div>}
              <form className="inline-governance" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,v=Object.fromEntries(new FormData(form));const saved=await act({action:"SAVE_EVAL_CASE",question:v.question,expectedKeywords:String(v.keywords).split(",").map(x=>x.trim()).filter(Boolean)});if(saved)form.reset();}}><input name="question" required placeholder="新增评测问题"/><input name="keywords" required placeholder="期望关键词，逗号分隔"/><button>加入评测集</button></form>
              <button className="platform-wide-action" disabled={evalRunning||!selectedPrompt} onClick={async()=>{setEvalRunning(true);setEvalResult(null);try{const r=await fetch("/api/enterprise",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"RUN_EVAL",promptId:selectedPrompt?.id})}),p=await r.json();if(!r.ok)throw new Error(p.error?.message||"评测失败");setEvalResult(p.data);await load();}catch(error){notify(error instanceof Error?error.message:"评测失败");}finally{setEvalRunning(false);}}}>{evalRunning?"评测中…":`运行全部 ${cases.length} 条验收用例`}</button>
              {evalResult&&<div className="eval-summary"><b>综合得分 {evalResult.score} · {evalResult.score>=releaseMinScore?"达到发布门槛":"未达到发布门槛"}</b><span>通过 {evalResult.passed}/{evalResult.total}</span>{evalResult.results.map((r,i)=><small key={i}>{r.status==="PASSED"?"✓":"×"} {r.question} · {r.score}分</small>)}</div>}
            </div>}
            {aiStrategyTab==="monitoring"&&<div className="ai-monitoring"><div className="metric-grid"><div><b>{Number(aiMetrics.total||0)}</b><span>近30天问答</span></div><div><b>{Number(aiMetrics.avg_latency||0)}ms</b><span>平均响应</span></div><div><b>{Number(aiMetrics.total)?Math.round(Number(aiMetrics.cited||0)/Number(aiMetrics.total)*100):0}%</b><span>有引用回答</span></div><div><b>{Number(aiMetrics.total)?Math.round(Number(aiMetrics.no_evidence||0)/Number(aiMetrics.total)*100):0}%</b><span>无答案率</span></div></div><h3>发布与回滚记录</h3>{promptReleases.map(item=><div className="platform-row" key={String(item.id)}><div><b>{String(item.action)} · V{String(item.version)}</b><small>{String(item.actor)} · {String(item.create_time)}</small></div><span>{Number(item.eval_score||0)} 分</span></div>)}</div>}
          </section>
          <div className="platform-grid">
            <section className="platform-card">
              <header>
                <h2>数据源接入</h2>
            <span>{connectors.length} 个 · 可连接并测试</span>
              </header>
              {connectors.map((item) => (
                <div className="platform-row" key={String(item.id)}>
                  <div>
                    <b>{String(item.name)}</b>
                    <small>
                      {String(item.type)} · {String(item.status)} ·{" "}
                      {String(item.last_error || "正常")}
                    </small>
                  </div>
                  <button
                    onClick={() =>
                      act({ action: "TEST_CONNECTOR", id: item.id })
                    }
                  >
                    连通测试
                  </button>
                </div>
              ))}
              <form
                className="enterprise-form compact"
                onSubmit={(e) => {
                  e.preventDefault();
                  act({
                    action: "SAVE_CONNECTOR",
                    ...Object.fromEntries(new FormData(e.currentTarget)),
                    enabled: true,
                  });
                  e.currentTarget.reset();
                }}
              >
                <input name="name" required placeholder="名称" />
                <select name="type">
                  <option>DINGTALK_DOC</option>
                  <option>FEISHU_KB</option>
                  <option>WECOM_DRIVE</option>
                  <option>REST_API</option>
                </select>
                <input name="endpoint" placeholder="接口地址（可选）" />
                <input name="secret" type="password" placeholder="密钥（可选）" />
                <button>保存</button>
              </form>
            </section>
            <section className="platform-card">
              <header>
                <h2>数据备份与恢复</h2>
                <span>{backups.length} 份</span>
              </header>
              {backups.slice(0, 5).map((item) => (
                <div className="platform-row" key={String(item.id)}>
                  <div>
                    <b>{String(item.object_key)}</b>
                    <small>
                      {String(item.row_count)} 行 · {String(item.status)}
                    </small>
                  </div>
                  <button
                    onClick={() =>
                      act({ action: "VERIFY_BACKUP", id: item.id })
                    }
                  >
                    校验
                  </button>
                </div>
              ))}
              <button
                className="platform-wide-action"
                onClick={() => act({ action: "CREATE_BACKUP" })}
              >
                创建并校验快照
              </button>
            </section>
          </div>
          <section className="platform-card wide-card">
            <header>
              <h2>事件通知集成</h2>
            <span>{webhooks.length} 个端点 · 支持签名投递与测试</span>
            </header>
            {webhooks.map((item) => (
              <div className="platform-row" key={String(item.id)}>
                <div>
                  <b>{String(item.name)}</b>
                  <small>
                    {String(item.url)} · 最近状态{" "}
                    {String(item.last_status ?? "未测试")}
                  </small>
                </div>
                <button
                  onClick={() => act({ action: "TEST_WEBHOOK", id: item.id })}
                >
                  发送测试事件
                </button>
              </div>
            ))}
            <form
              className="enterprise-form"
              onSubmit={(e) => {
                e.preventDefault();
                act({
                  action: "SAVE_WEBHOOK",
                  ...Object.fromEntries(new FormData(e.currentTarget)),
                  events: ["DOCUMENT_PUBLISHED"],
                });
                e.currentTarget.reset();
              }}
            >
              <input name="name" required placeholder="端点名称" />
              <input name="url" type="url" required placeholder="https://..." />
              <input
                name="secret"
                type="password"
                placeholder="签名密钥（可自动生成）"
              />
              <button>保存端点</button>
            </form>
          </section>
        </>
      )}
      {section === "security" && <section className="platform-card wide-card">
        <header>
          <h2>数据保留与下载保护</h2>
          <span>{retention.length} 份资料</span>
        </header>
        {retention.slice(0, 12).map((item) => (
          <form
            className="retention-row"
            key={String(item.id)}
            onSubmit={(e) => {
              e.preventDefault();
              const v = Object.fromEntries(new FormData(e.currentTarget));
              act({ action: "SET_RETENTION", ...v, documentId: item.id });
            }}
          >
            <label>
              <b>{String(item.title)}</b>
              <small>
                扫描：{String(item.scan_status)} · DLP：
                {String(item.dlp_findings)}
              </small>
            </label>
            <input
              name="retentionUntil"
              type="date"
              defaultValue={String(item.retention_until ?? "").slice(0, 10)}
            />
            <label>
              <input
                name="legalHold"
                type="checkbox"
                defaultChecked={Boolean(item.legal_hold)}
              />{" "}
              法务留置
            </label>
            <label>
              <input
                name="watermarkEnabled"
                type="checkbox"
                defaultChecked={Boolean(item.watermark_enabled)}
              />{" "}
              下载追踪（PDF/文本写入水印）
            </label>
            <button>保存策略</button>
          </form>
        ))}
      </section>}
      {pendingTaxonomyDelete&&<div className="modal-backdrop" onMouseDown={()=>setPendingTaxonomyDelete(null)}><section className="feedback-modal workflow-modal" onMouseDown={e=>e.stopPropagation()}><button type="button" onClick={()=>setPendingTaxonomyDelete(null)}>×</button><span>{pendingTaxonomyDelete.type==="CATEGORY"&&pendingTaxonomyDelete.references?"分类迁移":"配置删除确认"}</span><h2>{pendingTaxonomyDelete.type==="CATEGORY"&&pendingTaxonomyDelete.references?`迁移“${pendingTaxonomyDelete.name}”下的资料`:`确认删除“${pendingTaxonomyDelete.name}”？`}</h2><p>{pendingTaxonomyDelete.type==="CATEGORY"?(pendingTaxonomyDelete.references?`当前关联 ${pendingTaxonomyDelete.references} 份有效资料。选择目标分类后，系统将批量迁移资料并停用原分类，全程记录审计。`:"该分类没有关联有效资料，可以直接删除。") :pendingTaxonomyDelete.type==="GROUP"?"未被权限引用的用户组将删除成员关系；已有权限引用时会安全停用，避免现有访问权限失效。":"未使用标签可直接删除；仍有关联资料时系统会阻止删除，避免历史标签静默丢失。"}</p>{pendingTaxonomyDelete.type==="CATEGORY"&&Boolean(pendingTaxonomyDelete.references)&&<label style={{display:"grid",gap:6,textAlign:"left"}}>迁移到<select value={pendingTaxonomyDelete.targetId??""} onChange={e=>setPendingTaxonomyDelete(current=>current?{...current,targetId:Number(e.target.value)}:null)}><option value="">请选择目标分类</option>{categories.filter(item=>Number(item.id)!==pendingTaxonomyDelete.id&&(!pendingTaxonomyDelete.deptId?!item.dept_id:(!item.dept_id||Number(item.dept_id)===pendingTaxonomyDelete.deptId))).map(item=><option key={String(item.id)} value={String(item.id)}>{String(item.name)}{item.dept_id?"（本部门）":"（全局）"}</option>)}</select></label>}<div><button type="button" onClick={()=>setPendingTaxonomyDelete(null)}>取消</button><button className="primary-action" disabled={pendingTaxonomyDelete.type==="CATEGORY"&&Boolean(pendingTaxonomyDelete.references)&&!pendingTaxonomyDelete.targetId} onClick={async()=>{const target=pendingTaxonomyDelete;const actionName=target.type==="CATEGORY"&&target.references?"MIGRATE_CATEGORY":target.type==="CATEGORY"?"DELETE_CATEGORY":target.type==="GROUP"?"DELETE_GROUP":"DELETE_TAG";const saved=await act({action:actionName,id:target.id,targetId:target.targetId});if(saved)setPendingTaxonomyDelete(null);}}>{pendingTaxonomyDelete.type==="CATEGORY"&&pendingTaxonomyDelete.references?"迁移并停用":"确认删除"}</button></div></section></div>}
      {editingCategory&&<div className="modal-backdrop" onMouseDown={()=>setEditingCategory(null)}><form className="feedback-modal workflow-modal" onMouseDown={e=>e.stopPropagation()} onSubmit={async e=>{e.preventDefault();const name=String(new FormData(e.currentTarget).get("name")||"");const saved=await act({action:"RENAME_CATEGORY",id:editingCategory.id,name});if(saved)setEditingCategory(null);}}><button type="button" onClick={()=>setEditingCategory(null)}>×</button><span>分类重命名</span><h2>{String(editingCategory.name)}</h2><p>名称变更会同步到该分类下所有文档、目录筛选和上传表单，并写入审计日志。</p><input name="name" required defaultValue={String(editingCategory.name)} maxLength={60}/><div><button type="button" onClick={()=>setEditingCategory(null)}>取消</button><button className="primary-action">保存新名称</button></div></form></div>}
    </>
  );
}

function SettingsView({ role, notify,onConfigurationChange }: { role: string; notify: (m: string) => void;onConfigurationChange:(data:Record<string,Record<string,unknown>[]>)=>void }) {
  const [tasks, setTasks] = useState<Array<{id:number;code:string;name:string;description:string;enabled:number;last_run_at:string|null;cron_expr:string}>>([]);
  const [aiSettings,setAiSettings]=useState<Record<string,string>>({});
  const [semanticProgress, setSemanticProgress] = useState("");
  async function loadTasks() { try { const r=await fetch("/api/admin/scheduled-tasks",{cache:"no-store"}); const p=await r.json(); if(r.ok) setTasks(p.data.tasks||[]); } catch { } }
  async function loadSettings(){try{const r=await fetch("/api/platform",{cache:"no-store"});const p=await r.json();if(r.ok)setAiSettings(Object.fromEntries((p.data.settings??[]).map((item:Record<string,unknown>)=>[String(item.key),String(item.value)])));}catch{}}
  async function toggleTask(id:number,enabled:boolean){try{const r=await fetch("/api/admin/scheduled-tasks",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,enabled})});const p=await r.json();if(!r.ok)throw new Error(p.error?.message??"失败");await loadTasks()}catch(e:any){notify(e.message)}}
  async function updateTaskSchedule(id:number,cron_expr:string){try{const r=await fetch("/api/admin/scheduled-tasks",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id,cron_expr})});const p=await r.json();if(!r.ok)throw new Error(p.error?.message??"失败");await loadTasks();notify("执行频率已更新")}catch(e:any){notify(e.message)}}
  async function rebuildSemantic() {
    if (semanticProgress) return;
    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "资料列表加载失败");
      const rows = (payload.data?.documents ?? []) as Record<string, unknown>[];
      let success = 0, skipped = 0;
      for (let index = 0; index < rows.length; index++) {
        setSemanticProgress(`正在重建 ${index + 1}/${rows.length}`);
        try { const r = await buildLocalSemanticIndex(Number(rows[index].id), (p) => setSemanticProgress(`${index + 1}/${rows.length} · ${p.message}`)); if (r.indexed) success++; else skipped++; } catch { skipped++; }
      }
      notify(`语义索引重建完成：${success} 成功，${skipped} 跳过`);
    } catch (error) { notify(error instanceof Error ? error.message : "语义索引重建失败"); }
    finally { setSemanticProgress(""); }
  }
  async function action(body: Record<string, unknown>) {
    const r = await fetch("/api/platform", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const p = await r.json();
    if (!r.ok) return notify(p.error?.message ?? "操作失败");
    await loadSettings();
    notify("已保存并同步到检索服务");
  }
  useEffect(() => { loadTasks();loadSettings(); }, []);
  return (
    <main className="workspace">
      <section className="admin-heading">
        <div>
          <span className="page-kicker">SYSTEM OPERATIONS</span>
          <h1>系统运行与自动化</h1>
          <p>统一管理知识库的自动任务、智能检索策略和语义索引运行状态。</p>
        </div>
        <div className="member-actions">
          <button className="outline-action" onClick={rebuildSemantic} disabled={Boolean(semanticProgress)}>
            {semanticProgress || "重建语义索引"}
          </button>
        </div>
      </section>
      <section className="platform-card wide-card" style={{marginBottom:18}}>
        <header><div><h2>自动化任务</h2><p>按计划执行到期检查、知识治理和系统维护；停用后对应任务将不再自动运行。</p></div></header>
        {tasks.map(t => (
          <div key={t.id} className="scan-item" style={{margin:"0 18px 8px",borderLeft:`3px solid ${t.enabled?"#16796d":"#ccc"}`}}>
            <div>
              <b style={{fontSize:10}}>{t.name}</b>
              <small style={{fontSize:8,color:"#8b9d98"}}>{t.description}</small>
              {t.last_run_at && <small style={{fontSize:7,color:"#a0b0aa"}}>上次执行：{t.last_run_at.slice(0,16).replace("T"," ")}</small>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <select value={t.cron_expr} onChange={e=>updateTaskSchedule(t.id,e.target.value)} style={{fontSize:8,padding:"3px 6px",border:"1px solid #d4dde2",borderRadius:4}}>
                {!['0 8 * * *','0 18 * * *','0 19 * * *','0 20 * * *','0 8 * * 1','0 8 1 * *'].includes(t.cron_expr)&&<option value={t.cron_expr}>自定义：{t.cron_expr}</option>}
                <option value="0 8 * * *">每天8:00</option><option value="0 18 * * *">每天18:00</option><option value="0 19 * * *">每天19:00</option><option value="0 20 * * *">每天20:00</option><option value="0 8 * * 1">每周一8:00</option><option value="0 8 1 * *">每月1日8:00</option>
              </select>
              <label style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:"#637a84",cursor:"pointer"}}>
                <input type="checkbox" checked={t.enabled===1} onChange={e=>toggleTask(t.id,e.target.checked)} style={{accentColor:"#16796d"}} />{t.enabled?"开":"关"}
              </label>
            </div>
          </div>
        ))}
      </section>
      {role === "SUPER_ADMIN" && (
        <>
          <section className="platform-card wide-card" style={{marginBottom:18}}>
            <header><div><h2>智能检索策略</h2><p>控制语义召回、关键词命中和交给模型的知识片段数量。</p></div></header>
            <form onSubmit={e=>{e.preventDefault();const fd=new FormData(e.currentTarget);action({action:"UPDATE_SETTINGS",settings:Object.fromEntries(fd)})}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,padding:12}}>
                <label style={{fontSize:9}}>语义召回权重<small>理解相近表达，建议 0.6–0.8</small><input name="hybrid.vector_weight" value={aiSettings['hybrid.vector_weight']??''} onChange={e=>setAiSettings(current=>({...current,'hybrid.vector_weight':e.target.value}))} placeholder="读取中" style={{width:"100%",padding:4,border:"1px solid #d4dde2",borderRadius:4}} /></label>
                <label style={{fontSize:9}}>关键词命中权重<small>匹配标题和正文中的准确词语</small><input name="hybrid.keyword_weight" value={aiSettings['hybrid.keyword_weight']??''} onChange={e=>setAiSettings(current=>({...current,'hybrid.keyword_weight':e.target.value}))} placeholder="读取中" style={{width:"100%",padding:4,border:"1px solid #d4dde2",borderRadius:4}} /></label>
                <label style={{fontSize:9}}>引用片段数量<small>每次最多交给模型的知识片段，建议 3–8</small><input name="rag.top_k" value={aiSettings['rag.top_k']??''} onChange={e=>setAiSettings(current=>({...current,'rag.top_k':e.target.value}))} placeholder="读取中" style={{width:"100%",padding:4,border:"1px solid #d4dde2",borderRadius:4}} /></label>
              </div>
              <button style={{margin:"0 12px 12px",padding:"6px 14px",border:0,borderRadius:6,background:"#16796d",color:"white",fontSize:9,cursor:"pointer"}}>保存</button>
            </form>
          </section>
          <EnterprisePanels role={role} notify={notify} onConfigurationChange={onConfigurationChange} section="operations" />
        </>
      )}
    </main>
  );
}

function KnowledgeSystemView({role,notify,onConfigurationChange}:{role:string;notify:(message:string)=>void;onConfigurationChange:(data:Record<string,Record<string,unknown>[]>)=>void}){
  return <main className="workspace"><section className="admin-heading"><div><span className="page-kicker">KNOWLEDGE ARCHITECTURE</span><h1>知识体系</h1><p>统一维护知识空间、目录、分类和标签，配置变化会同步到上传、筛选和资料详情。</p></div></section><KnowledgeSpacePanel role={role} notify={notify}/><EnterprisePanels role={role} notify={notify} onConfigurationChange={onConfigurationChange} section="knowledge" /></main>;
}

function KnowledgeSpacePanel({role,notify}:{role:string;notify:(message:string)=>void}){
  const [spaces,setSpaces]=useState<Record<string,unknown>[]>([]);
  async function load(){const response=await fetch("/api/platform",{cache:"no-store"}),payload=await response.json();if(!response.ok)return notify(payload.error?.message??"知识空间加载失败");setSpaces(payload.data.spaces??[]);}
  useEffect(()=>{const timer=window.setTimeout(load,0);return()=>window.clearTimeout(timer);},[]);// eslint-disable-line react-hooks/exhaustive-deps
  async function save(body:Record<string,unknown>,form:HTMLFormElement){const response=await fetch("/api/platform",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),payload=await response.json();if(!response.ok)return notify(payload.error?.message??"保存失败");form.reset();await load();notify("知识空间与目录已更新，并同步到上传表单");}
  const unique=Array.from(new Map(spaces.map(item=>[Number(item.id),item])).values());
  return <section className="platform-card wide-card" style={{marginBottom:18}}><header><div><h2>知识空间与目录</h2><p>空间用于部门或主题级隔离，目录用于空间内的层级组织。</p></div><span>{unique.length} 个空间</span></header><div className="space-grid">{spaces.map((space,index)=><div key={`${space.id}-${space.folder_id}-${index}`}><b>{String(space.name)}</b><span>{space.folder_name?String(space.folder_name):"根目录"}</span><small>{String(space.document_count??0)} 份资料</small></div>)}</div>{role==="SUPER_ADMIN"&&<form className="inline-governance" onSubmit={e=>{e.preventDefault();save({action:"CREATE_SPACE",...Object.fromEntries(new FormData(e.currentTarget))},e.currentTarget);}}><input name="name" required placeholder="新空间名称"/><input name="code" required placeholder="唯一编码"/><button>创建空间</button></form>}{Boolean(unique.length)&&<form className="inline-governance" onSubmit={e=>{e.preventDefault();save({action:"CREATE_FOLDER",...Object.fromEntries(new FormData(e.currentTarget))},e.currentTarget);}}><select name="spaceId" required defaultValue={String(unique[0]?.id??"")}>{unique.map(space=><option key={String(space.id)} value={String(space.id)}>{String(space.name)}</option>)}</select><input name="name" required placeholder="新目录名称"/><button>创建目录</button></form>}</section>;
}

function AuditView({
  logs,
  documents,
  role,
  notify,
}: {
  logs: AuditLog[];
  documents: KnowledgeDocument[];
  role: string;
  notify: (message:string)=>void;
}) {
  const action: Record<string, string> = {
    VIEW: "查看",
    DOWNLOAD: "下载",
    EXPORT: "导出",
    FEEDBACK: "提交反馈",
    UPDATE: "更新",
    UPLOAD: "上传",
    APPROVE: "审批通过",
    REJECT: "驳回",
    SUBMIT_REVIEW: "提交复核",
    ACCOUNT_CREATE: "添加成员",
    ACCOUNT_IMPORT: "批量导入成员",
    ACCOUNT_UPDATE: "变更成员权限",
  };
  return (
    <main className="workspace">
      <section className="admin-heading">
        <div>
          <span className="page-kicker">AUDIT TRAIL</span>
          <h1>安全与审计</h1>
          <p>处置知识安全风险、执行数据合规策略并追踪全部关键操作。</p>
        </div>
        <button
          className="outline-action"
          onClick={() =>
            downloadBlob(
              "知识库审计日志.csv",
              `时间,操作者,操作,详情\n${logs.map((l) => `${l.createdAt},${l.actor},${action[l.action] ?? l.action},${l.detail}`).join("\n")}`,
              "text/csv;charset=utf-8",
            )
          }
        >
          导出 CSV
        </button>
      </section>
      <EnterprisePanels role={role} notify={notify} onConfigurationChange={()=>undefined} section="security" />
      <section className="audit-card">
        {logs.map((log) => (
          <div className="audit-item" key={log.id}>
            <span className="audit-icon">
              {log.action === "DOWNLOAD"
                ? "↓"
                : log.action === "VIEW"
                  ? "◉"
                  : "✓"}
            </span>
            <div>
              <b>
                {log.actor} · {action[log.action] ?? log.action}
              </b>
              <p>
                {log.detail ||
                  documents.find((d) => d.id === log.documentId)?.title}
              </p>
            </div>
            <time>{log.createdAt}</time>
          </div>
        ))}
      </section>
    </main>
  );
}

function GroupManagementPanel({notify}:{notify:(message:string)=>void}){
  const [data,setData]=useState<{groups:Record<string,unknown>[];departments:Record<string,unknown>[];users:Record<string,unknown>[]}>({groups:[],departments:[],users:[]});
  const [editor,setEditor]=useState<Record<string,unknown>|null>(null);
  const [usage,setUsage]=useState<Record<string,unknown>|null>(null);
  const [pendingDelete,setPendingDelete]=useState<Record<string,unknown>|null>(null);
  async function load(){const response=await fetch("/api/enterprise",{cache:"no-store"}),payload=await response.json();if(!response.ok)return notify(payload.error?.message??"用户组加载失败");setData({groups:payload.data.groups??[],departments:payload.data.departments??[],users:payload.data.users??[]});}
  useEffect(()=>{const timer=window.setTimeout(load,0);return()=>window.clearTimeout(timer);},[]);// eslint-disable-line react-hooks/exhaustive-deps
  function newCode(){return `GROUP_${Date.now().toString(36).toUpperCase()}`.slice(0,30);}
  function openEditor(group?:Record<string,unknown>){setEditor(group?{...group,userIds:String(group.member_ids??"").split(",").filter(Boolean).map(Number)}:{name:"",code:newCode(),dept_id:"",description:"",userIds:[]});}
  async function saveGroup(){if(!editor)return;const response=await fetch("/api/enterprise",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"SAVE_GROUP",id:editor.id,name:editor.name,code:editor.code,deptId:editor.dept_id,description:editor.description,userIds:editor.userIds})}),payload=await response.json();if(!response.ok)return notify(payload.error?.message??"用户组保存失败");setEditor(null);await load();notify(payload.data?.message??"用户组已保存");}
  async function deleteGroup(){if(!pendingDelete)return;const response=await fetch("/api/enterprise",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"DELETE_GROUP",id:pendingDelete.id})}),payload=await response.json();if(!response.ok)return notify(payload.error?.message??"用户组停用失败");setPendingDelete(null);await load();notify(payload.data?.message??"用户组已停用");}
  const selectedDept=Number(editor?.dept_id)||null;
  const eligibleUsers=Array.from(new Map(data.users.filter(user=>!selectedDept||Number(user.dept_id)===selectedDept).map(user=>[Number(user.id),user])).values());
  return <section className="platform-card wide-card" style={{marginTop:16,marginBottom:16}}><header><div><h2>用户组与批量授权</h2><p>将项目组、管理层等人员集合授权给文档或知识空间，成员变化后权限自动继承。</p></div><button className="primary-action" onClick={()=>openEditor()}>＋ 新建用户组</button></header>{data.groups.length?data.groups.map(group=><div className="platform-row" key={String(group.id)}><div><b>{String(group.name)}</b><small>{group.dept_id?"部门组":"全局组"} · {Number(group.member_count)||0} 名成员 · {Number(group.document_permission_count)||0} 份文档 · {Number(group.space_permission_count)||0} 个空间</small>{group.description&&<small>{String(group.description)}</small>}</div><button onClick={()=>setUsage(group)}>查看权限</button><button onClick={()=>openEditor(group)}>编辑</button><button onClick={()=>setPendingDelete(group)}>停用</button></div>):<p className="platform-empty">尚未创建用户组。只有需要跨人员批量授权时才需要配置。</p>}
  {editor&&<div className="modal-backdrop" onMouseDown={()=>setEditor(null)}><section className="upload-modal" style={{width:"min(620px,94vw)",maxHeight:"86vh",overflow:"auto"}} onMouseDown={e=>e.stopPropagation()}><header><div><span className="page-kicker">ACCESS GROUP</span><h2>{editor.id?"编辑用户组":"新建用户组"}</h2><p>填写名称、适用范围和成员；系统编码已自动生成，一般无需修改。</p></div><button onClick={()=>setEditor(null)}>×</button></header><div className="form-grid"><label><span>用户组名称 *</span><input value={String(editor.name??"")} onChange={e=>setEditor({...editor,name:e.target.value})} placeholder="例如：融资项目组"/></label><label><span>系统编码 *</span><input value={String(editor.code??"")} onChange={e=>setEditor({...editor,code:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,"_")})}/><small>用于接口和审计，创建后建议保持稳定</small></label><label><span>适用范围</span><select value={String(editor.dept_id??"")} onChange={e=>setEditor({...editor,dept_id:e.target.value,userIds:[]})}><option value="">全局用户组（可选跨部门成员）</option>{data.departments.map(dept=><option key={String(dept.id)} value={String(dept.id)}>{String(dept.name)}（仅本部门）</option>)}</select></label><label><span>用途说明</span><input value={String(editor.description??"")} onChange={e=>setEditor({...editor,description:e.target.value})} placeholder="例如：融资尽调资料授权"/></label></div><div style={{marginTop:16}}><b>选择成员</b><p style={{fontSize:9,color:"#7b9089"}}>创建时即可配置，后续增减成员会自动影响用户组授权。</p><div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:8,maxHeight:250,overflow:"auto",padding:10,border:"1px solid #e1ebe7",borderRadius:8}}>{eligibleUsers.map(user=><label key={String(user.id)} style={{display:"flex",gap:7,alignItems:"center"}}><input type="checkbox" checked={(editor.userIds as number[]??[]).includes(Number(user.id))} onChange={e=>{const ids=editor.userIds as number[]??[];setEditor({...editor,userIds:e.target.checked?[...ids,Number(user.id)]:ids.filter(id=>id!==Number(user.id))})}}/>{String(user.display_name)}</label>)}</div></div><footer><button onClick={()=>setEditor(null)}>取消</button><button className="primary-action" disabled={!String(editor.name??"").trim()||!String(editor.code??"").trim()} onClick={saveGroup}>保存用户组</button></footer></section></div>}
  {usage&&<div className="modal-backdrop" onMouseDown={()=>setUsage(null)}><section className="feedback-modal workflow-modal" onMouseDown={e=>e.stopPropagation()}><button onClick={()=>setUsage(null)}>×</button><span>授权使用情况</span><h2>{String(usage.name)}</h2><p>文档授权：{Number(usage.document_permission_count)||0} 份<br/>{String(usage.document_names||"暂无")}</p><p>知识空间授权：{Number(usage.space_permission_count)||0} 个<br/>{String(usage.space_names||"暂无")}</p><div><button className="primary-action" onClick={()=>setUsage(null)}>知道了</button></div></section></div>}
  {pendingDelete&&<div className="modal-backdrop" onMouseDown={()=>setPendingDelete(null)}><section className="feedback-modal workflow-modal" onMouseDown={e=>e.stopPropagation()}><button onClick={()=>setPendingDelete(null)}>×</button><span>停用用户组</span><h2>{String(pendingDelete.name)}</h2><p>{Number(pendingDelete.document_permission_count)+Number(pendingDelete.space_permission_count)>0?`该组仍有 ${Number(pendingDelete.document_permission_count)+Number(pendingDelete.space_permission_count)} 项授权。停用后保留既有权限，避免业务访问突然中断，但不再允许新增授权。`:"该组没有权限引用，停用时会同时清理成员关系。"}</p><div><button onClick={()=>setPendingDelete(null)}>取消</button><button className="primary-action" onClick={deleteGroup}>确认停用</button></div></section></div>}
  </section>;
}

function AccountAdminView({ notify }: { notify: (message: string) => void }) {
  const [accounts, setAccounts] = useState<EnterpriseAccount[]>([]);
  const [departments, setDepartments] = useState<UploadDepartment[]>([]);
  const [allRoles, setAllRoles] = useState<Array<{id:number;code:string;name:string;scope:string;isSystem:boolean;permissions:string[]}>>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showRoleEditor, setShowRoleEditor] = useState(false);
  const [editingRole, setEditingRole] = useState<{id?:number;code:string;name:string;description:string;scope:string;permissionIds:number[];isSystem?:boolean}|null>(null);
  const [importText, setImportText] = useState("");
  const [permTree, setPermTree] = useState<Array<{id:number;code:string;name:string;parent_code:string|null;sort_order:number}>>([]);
  async function load() {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/roles", { cache: "no-store" }),
      ]);
      const [p1, p2] = await Promise.all([r1.json(), r2.json()]);
      if (!r1.ok) throw new Error(p1.error?.message ?? "账号加载失败");
      setAccounts(p1.data.users);
      setDepartments(p1.data.departments);
      if (r2.ok) setAllRoles(p2.data.roles || []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "账号加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    const payload = await response.json();
    if (!response.ok) return notify(payload.error?.message ?? "成员添加失败");
    setShowCreate(false);
    notify("成员已添加并完成授权，使用该企业邮箱登录即可");
    await load();
  }
  async function importMembers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rows = importText
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean);
    const members = rows.map((row) => {
      const [displayName, email, deptCode, role = "EMPLOYEE"] = row
        .split(",")
        .map((value) => value.trim());
      return { displayName, email, deptCode, role };
    });
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ members }),
    });
    const payload = await response.json();
    if (!response.ok) return notify(payload.error?.message ?? "批量导入失败");
    setImportText("");
    setShowImport(false);
    notify(`已导入 ${payload.data.imported} 名成员并完成部门授权`);
    await load();
  }
  async function saveAccount(
    account: EnterpriseAccount,
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: account.id, ...values }),
    });
    const payload = await response.json();
    if (!response.ok) return notify(payload.error?.message ?? "账号更新失败");
    notify(
      values.status === "OFFBOARDED"
        ? "离职权限已回收，后续请求立即失效"
        : values.status === "DISABLED"
          ? "账号已停用"
          : "账号权限已更新",
    );
    await load();
  }
  const statusLabelMap: Record<string, string> = {
    ACTIVE: "使用中",
    PENDING: "待授权",
    DISABLED: "已停用",
    OFFBOARDED: "已离职",
  };
  const roleLabel = (code: string) => allRoles.find(r => r.code === code)?.name ?? (code === "UNASSIGNED" ? "待分配" : code);
  async function loadPermTree() {
    try {
      const r = await fetch("/api/admin/roles?tree=true", { cache: "no-store" });
      const p = await r.json();
      if (r.ok) setPermTree(p.data.permissions || []);
    } catch { /* ignore */ }
  }
  async function saveRole() {
    if (!editingRole) return;
    if (!editingRole.name.trim() || !editingRole.code.trim()) { notify("角色名称和编码不能为空"); return; }
    try {
      const method = editingRole.id ? "PATCH" : "POST";
      const body: Record<string,unknown> = { id: editingRole.id, code: editingRole.code.trim(), name: editingRole.name.trim(), description: editingRole.description, scope: editingRole.scope, permissionIds: editingRole.permissionIds };
      if (!editingRole.id) delete body.id;
      const r = await fetch("/api/admin/roles", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error?.message ?? "保存失败");
      notify(editingRole.id ? "角色已更新" : "角色已创建");
      setShowRoleEditor(false);
      setEditingRole(null);
      await load();
    } catch (e: any) { notify(e.message); }
  }
  async function deleteRole(id: number, name: string) {
    if (!confirm(`确认删除角色「${name}」？系统角色不可删除。`)) return;
    try {
      const r = await fetch(`/api/admin/roles?id=${id}`, { method: "DELETE" });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error?.message ?? "删除失败");
      notify("角色已删除");
      await load();
    } catch (e: any) { notify(e.message); }
  }
  function togglePerm(pid: number) {
    if (!editingRole) return;
    const ids = editingRole.permissionIds.includes(pid)
      ? editingRole.permissionIds.filter(i => i !== pid)
      : [...editingRole.permissionIds, pid];
    setEditingRole({ ...editingRole, permissionIds: ids });
  }
  return (
    <main className="workspace">
      <section className="admin-heading">
        <div>
          <span className="page-kicker">IDENTITY & ACCESS</span>
          <h1>成员与权限</h1>
          <p>统一管理员工加入、部门授权、首次登录、停用及离职权限回收。</p>
        </div>
        <div className="member-actions">
          <button
            className="outline-action"
            onClick={() => { loadPermTree(); setEditingRole({code:"",name:"",description:"",scope:"department",permissionIds:[]}); setShowRoleEditor(true); }}
          >
            ＋ 新建角色
          </button>
          <button
            className="outline-action"
            onClick={() => setShowImport((value) => !value)}
          >
            批量导入
          </button>
          <button
            className="primary-action"
            onClick={() => setShowCreate((value) => !value)}
          >
            ＋ 添加成员
          </button>
        </div>
      </section>
      <div className="identity-metrics">
        <div>
          <span>已登录使用</span>
          <b>
            {
              accounts.filter((a) => a.status === "ACTIVE" && a.last_login_time)
                .length
            }
          </b>
        </div>
        <div>
          <span>待首次登录</span>
          <b>
            {
              accounts.filter(
                (a) => a.status === "ACTIVE" && !a.last_login_time,
              ).length
            }
          </b>
        </div>
        <div>
          <span>停用 / 离职</span>
          <b>
            {
              accounts.filter((a) =>
                ["DISABLED", "OFFBOARDED"].includes(a.status),
              ).length
            }
          </b>
        </div>
        <p>
          身份由企业统一登录确认；系统按成员目录中的部门和角色授权，不保存员工密码。
        </p>
      </div>
      <GroupManagementPanel notify={notify} />
      <section className="platform-card" style={{marginTop:16,marginBottom:16}}>
        <header><h2>角色管理</h2><span>{allRoles.length} 个角色</span></header>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,padding:12}}>
          {allRoles.map(r => (
            <div key={r.id} style={{padding:"10px 14px",border:"1px solid #dce8e4",borderRadius:8,background:r.isSystem?"#f8faf9":"white",minWidth:160}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <b style={{fontSize:10}}>{r.name}</b>
                {r.isSystem && <small style={{fontSize:7,padding:"1px 5px",background:"#e0f0ec",borderRadius:4,color:"#16796d"}}>系统</small>}
                <small style={{fontSize:7,color:"#8b9d98"}}>{r.scope==="global"?"全局":"部门"}</small>
              </div>
              <small style={{fontSize:8,color:"#829992",display:"block",marginTop:3}}>{r.permissions.length} 项权限</small>
              <div style={{marginTop:6,display:"flex",gap:4}}>
                <button style={{fontSize:7,padding:"2px 8px",border:"1px solid #d4dde2",borderRadius:4,background:"white",cursor:"pointer"}} onClick={async()=>{await loadPermTree();const pids=allRoles.find(x=>x.id===r.id)?.permissions||[];setEditingRole({id:r.id,code:r.code,name:r.name,description:"",scope:r.scope,permissionIds:pids.map(c=>permTree.find(t=>t.code===c)?.id).filter(Boolean) as number[]});setShowRoleEditor(true)}}>编辑</button>
                <button style={{fontSize:7,padding:"2px 8px",border:"1px solid #e4cece",borderRadius:4,background:"white",color:"#b55a5a",cursor:"pointer"}} onClick={()=>deleteRole(r.id,r.name)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {showRoleEditor && editingRole && (
        <div className="modal-backdrop" onMouseDown={()=>{setShowRoleEditor(false);setEditingRole(null)}}>
          <div className="upload-modal" onMouseDown={e=>e.stopPropagation()} style={{width:"min(500px,94vw)",maxHeight:"80vh",overflow:"auto"}}>
            <header><h2>{editingRole.id?"编辑角色":"新建角色"}</h2><button onClick={()=>{setShowRoleEditor(false);setEditingRole(null)}} style={{border:0,background:"transparent",fontSize:20,cursor:"pointer"}}>×</button></header>
            <label style={{display:"block",marginTop:12}}>角色名称<input value={editingRole.name} onChange={e=>setEditingRole({...editingRole,name:e.target.value})} style={{width:"100%",padding:8,border:"1px solid #d4dde2",borderRadius:6,fontSize:10}} /></label>
            <label style={{display:"block",marginTop:8}}>编码<input value={editingRole.code} onChange={e=>setEditingRole({...editingRole,code:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,"_")})} disabled={!!editingRole.id} style={{width:"100%",padding:8,border:"1px solid #d4dde2",borderRadius:6,fontSize:10,background:editingRole.id?"#f5f5f5":"white"}} /></label>
            <label style={{display:"block",marginTop:8}}>数据范围
              <select value={editingRole.scope} onChange={e=>setEditingRole({...editingRole,scope:e.target.value})} style={{width:"100%",padding:8,border:"1px solid #d4dde2",borderRadius:6,fontSize:10}}>
                <option value="department">部门范围（仅查看所属部门数据）</option>
                <option value="global">全局范围（查看所有部门数据）</option>
              </select>
            </label>
            <div style={{marginTop:12}}>
              <b style={{fontSize:10}}>功能权限</b>
              <div style={{maxHeight:260,overflow:"auto",marginTop:6,border:"1px solid #e8edef",borderRadius:6}}>
                {["knowledge","governance","system","agent"].map(cat => {
                  const items=permTree.filter(p=>p.code.startsWith(cat+":")||p.code===cat);
                  if(!items.length)return null;
                  const catName={knowledge:"知识服务",governance:"知识治理",system:"系统管理",agent:"AI Agent"}[cat]||cat;
                  return <div key={cat} style={{padding:"6px 10px",borderBottom:"1px solid #f0f4f2"}}>
                    <b style={{fontSize:9,color:"#38534c"}}>{catName}</b>
                    <div style={{display:"grid",gap:2,marginTop:3}}>
                      {items.map(p=><label key={p.id} style={{display:"flex",alignItems:"center",gap:5,fontSize:9,color:"#5a6e68",cursor:"pointer",padding:"2px 0"}}><input type="checkbox" checked={editingRole.permissionIds.includes(p.id)} onChange={()=>togglePerm(p.id)} style={{accentColor:"#16796d"}} />{p.name}</label>)}
                    </div>
                  </div>;
                })}
              </div>
            </div>
            <footer style={{marginTop:16,display:"flex",justifyContent:"flex-end",gap:8}}>
              <button onClick={()=>{setShowRoleEditor(false);setEditingRole(null)}} style={{border:"1px solid #d4dde2",borderRadius:6,background:"white",padding:"8px 16px",fontSize:10,cursor:"pointer"}}>取消</button>
              <button onClick={saveRole} disabled={!editingRole.name||!editingRole.code} style={{border:0,borderRadius:6,background:"#16796d",color:"white",padding:"8px 16px",fontSize:10,cursor:"pointer"}}>保存</button>
            </footer>
          </div>
        </div>
      )}
      {showCreate && (
        <form className="account-create" onSubmit={createAccount}>
          <label>
            企业邮箱
            <input
              name="email"
              type="email"
              required
              placeholder="name@company.com"
            />
          </label>
          <label>
            员工姓名
            <input name="displayName" required />
          </label>
          <label>
            主部门
            <select name="deptId" required>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            角色
            <select name="role" required>
              {allRoles.map(r => <option key={r.id} value={r.code}>{r.name}{r.scope==='global'?'（全局数据）':''}</option>)}
            </select>
          </label>
          <button className="primary-action">添加并授权</button>
        </form>
      )}
      {showImport && (
        <form className="member-import" onSubmit={importMembers}>
          <div>
            <b>批量导入成员</b>
            <p>
              每行格式：姓名,企业邮箱,部门编码,角色编码。当前可用角色：
              {allRoles.map(item=>item.code).join("、")}；单次最多 500 人，整批校验通过后写入。
            </p>
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            required
            placeholder={
              "张三,zhangsan@company.com,PRODUCT,EMPLOYEE\n李四,lisi@company.com,HR,DEPT_ADMIN"
            }
          />
          <footer>
            <button type="button" onClick={() => setShowImport(false)}>
              取消
            </button>
            <button className="primary-action">校验并导入</button>
          </footer>
        </form>
      )}
      <section className="account-card">
        <header>
          <div>
            <h2>企业成员目录</h2>
            <p>
              支持单个添加、批量导入和 SCIM 目录同步；未授权访问会进入待授权队列
            </p>
          </div>
          <span>{accounts.length} 名成员</span>
        </header>
        {loading ? (
          <div className="account-loading">正在同步企业成员目录...</div>
        ) : (
          accounts.map((account) => (
            <form
              className="account-row"
              key={account.id}
              onSubmit={(event) => saveAccount(account, event)}
            >
              <span className="account-avatar">
                {account.display_name.slice(0, 1)}
              </span>
              <label>
                成员
                <input name="displayName" defaultValue={account.display_name} />
                <small>{account.email}</small>
              </label>
              <label>
                主部门
                <select
                  name="deptId"
                  defaultValue={account.primary_dept_id || departments[0]?.id}
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <small>{account.departments}</small>
              </label>
              <label>
                角色
                <select
                  name="role"
                  defaultValue={
                    account.role === "UNASSIGNED" ? "EMPLOYEE" : account.role
                  }
                >
                  {allRoles.map(role=><option key={role.id} value={role.code}>{role.name}{role.scope==='global'?'（全局）':''}</option>)}
                </select>
                <small>{roleLabel(account.role)}</small>
              </label>
              <label>
                账号状态
                <select
                  name="status"
                  defaultValue={
                    account.status === "PENDING" ? "ACTIVE" : account.status
                  }
                >
                  <option value="ACTIVE">允许登录</option>
                  <option value="DISABLED">暂停访问</option>
                  <option value="OFFBOARDED">离职回收</option>
                </select>
                <small>
                  {account.status === "ACTIVE" && !account.last_login_time
                    ? "待首次登录"
                    : statusLabelMap[account.status]}
                </small>
              </label>
              <label>
                登录与来源
                <span>
                  {account.last_login_time?.slice(0, 16).replace("T", " ") ||
                    "尚未登录"}
                </span>
                <small>
                  {account.identity_provider === "DIRECTORY_IMPORT"
                    ? "批量导入"
                    : account.identity_provider === "SCIM"
                      ? "SCIM 同步"
                      : "企业统一登录"}
                </small>
              </label>
              <button>保存</button>
            </form>
          ))
        )}
      </section>
    </main>
  );
}

function DocumentDrawer({
  document: doc,
  returnToAi = false,
  canRestore,
  favorite,
  onClose,
  onFavorite,
  onPermissionsChanged,
  onSaved,
  onRestore,
  onFeedback,
  onExport,
  onDownload,
  onShare,
  onSubscribe,
  onContact,
}: {
  document: KnowledgeDocument;
  returnToAi?: boolean;
  canRestore: boolean;
  favorite: boolean;
  onClose: () => void;
  onFavorite: () => void;
  onPermissionsChanged: () => void;
  onSaved: () => void;
  onRestore: (version: number) => void;
  onFeedback: () => void;
  onExport: () => void;
  onDownload: () => void;
  onShare: () => void;
  onSubscribe: () => void;
  onContact: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [permissionError, setPermissionError] = useState("");
  const [permissionSubjectType,setPermissionSubjectType]=useState<"USER"|"DEPT"|"GROUP">("DEPT");
  const isPdf = Boolean(doc.sourceKey && doc.mimeType?.includes("pdf"));
  useEffect(() => {
    if (!isPdf) return;
    let url = "";
    let cancelled = false;
    fetch(`/api/documents/${doc.id}?download=1`)
      .then((response) => (response.ok ? response.blob() : Promise.reject()))
      .then((blob) => {
        if (!cancelled) {
          url = URL.createObjectURL(blob);
          setPreviewUrl(url);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc.id, isPdf]);
  const versions = doc.versions ?? [];
  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/documents/${doc.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = await response.json();
    if (!response.ok) return setEditError(payload.error?.message ?? "保存失败");
    setEditing(false);
    onSaved();
  }
  const principalChoices=permissionSubjectType==="USER"?(doc.permissionPrincipals?.users??[]):permissionSubjectType==="GROUP"?(doc.permissionPrincipals?.groups??[]):(doc.permissionPrincipals?.departments??[]);
  async function savePermission(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setPermissionError("");const values=Object.fromEntries(new FormData(event.currentTarget));const spaceScope=values.scope==="SPACE";if(spaceScope&&!doc.spaceId)return setPermissionError("该资料尚未归入知识空间，不能设置空间权限");
    const response=await fetch("/api/platform",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:spaceScope?"SET_SPACE_PERMISSION":"SET_ACL",documentId:doc.id,spaceId:doc.spaceId,subjectType:values.subjectType,subjectId:Number(values.subjectId),permission:values.permission,expiresAt:values.expiresAt||undefined})});const payload=await response.json();if(!response.ok)return setPermissionError(payload.error?.message??"权限保存失败");onPermissionsChanged();
  }
  async function removePermission(grant:PermissionGrant,scope:"DOCUMENT"|"SPACE"){
    setPermissionError("");const response=await fetch("/api/platform",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(scope==="DOCUMENT"?{action:"REMOVE_ACL",documentId:doc.id,id:grant.id}:{action:"REMOVE_SPACE_PERMISSION",spaceId:doc.spaceId,subjectType:grant.subject_type,subjectId:grant.subject_id,permission:grant.permission})});const payload=await response.json();if(!response.ok)return setPermissionError(payload.error?.message??"权限移除失败");onPermissionsChanged();
  }
  return (
    <div
      className={`drawer-backdrop${returnToAi ? " from-ai" : ""}`}
      onMouseDown={onClose}
    >
      <aside
        className="document-drawer"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <button
            aria-label={returnToAi ? "返回问答" : "关闭文档"}
            className={returnToAi ? "return-to-ai" : ""}
            onClick={onClose}
          >
            {returnToAi ? "← 返回问答" : "×"}
          </button>
          <div>
            <span className={`doc-status ${doc.status}`}>
              {statusLabel[doc.status]}
            </span>
            <span>{doc.securityLevel}</span>
          </div>
          <h2>{doc.title}</h2>
          <p>{doc.summary || "暂无摘要"}</p>
        </header>
        {doc.tags && (
          <div className="document-tag-strip" aria-label="知识标签">
            <span>知识标签</span>
            {doc.tags.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
              <b key={tag}>{tag}</b>
            ))}
          </div>
        )}
        <div className="drawer-actions">
          {doc.canEdit && (
            <button onClick={() => setEditing((value) => !value)}>
              ✎ {editing ? "取消编辑" : "编辑资料"}
            </button>
          )}
          <button onClick={onFavorite}>
            {favorite ? "★ 已收藏" : "☆ 收藏"}
          </button>
          <button onClick={onShare}>⎘ 内部链接</button>
          <button onClick={onSubscribe}>
            ◇ {doc.subscribed ? "取消订阅" : "订阅更新"}
          </button>
          <button onClick={onContact}>@ 联系负责人</button>
          {doc.sourceKey && <button onClick={onDownload}>↓ 下载原件</button>}
          <button onClick={onExport}>⇧ 导出摘要</button>
          <button onClick={onFeedback}>! 纠错反馈</button>
        </div>
        {editing && (
          <form className="document-edit" onSubmit={saveEdit}>
            <label>
              标题
              <input name="title" defaultValue={doc.title} required />
            </label>
            <label>
              摘要
              <textarea name="summary" defaultValue={doc.summary} rows={3} />
            </label>
            <label>
              正文
              <textarea
                name="content"
                defaultValue={doc.content}
                rows={12}
                required
              />
            </label>
            {editError && <p>{editError}</p>}
            <button className="primary-action">保存为新草稿版本</button>
          </form>
        )}
        <section className="doc-info">
          <div>
            <span>知识负责人</span>
            <b>{doc.owner}</b>
          </div>
          <div>
            <span>解析状态</span>
            <b>{parseStatusLabel(doc.parseStatus)}</b>
            <small>{doc.extractionDetail}</small>
          </div>
          <div>
            <span>语义索引</span>
            <b>
              {doc.aiIndexStatus === "INDEXED_LOCAL"
                ? "本地向量已建立"
                : doc.aiIndexStatus === "KEYWORD_READY"
                  ? "关键词可用"
                  : "等待建立"}
            </b>
          </div>
          <div>
            <span>当前版本</span>
            <b>V{doc.version}.0</b>
          </div>
        </section>
        {doc.canManage&&doc.permissionPrincipals&&<section className="permission-editor"><header><div><h3>访问权限</h3><p>部门默认权限之外，可按员工、部门或用户组授权；编辑权限自动包含查看权限。</p></div><span>后端行级隔离</span></header><form onSubmit={savePermission}><select name="scope" defaultValue="DOCUMENT"><option value="DOCUMENT">仅当前资料</option>{doc.spaceId&&<option value="SPACE">整个知识空间</option>}</select><select name="subjectType" value={permissionSubjectType} onChange={e=>setPermissionSubjectType(e.target.value as "USER"|"DEPT"|"GROUP")}><option value="USER">员工</option><option value="DEPT">部门</option><option value="GROUP">用户组</option></select><select name="subjectId" required>{principalChoices.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><select name="permission"><option value="VIEW">只读查看</option><option value="EDIT">允许编辑</option></select><input name="expiresAt" type="datetime-local" aria-label="授权到期时间"/><button disabled={!principalChoices.length}>添加授权</button></form>{permissionError&&<p className="permission-error">{permissionError}</p>}<div className="permission-list">{(doc.acl??[]).map(grant=><div key={`d-${grant.id}`}><span>资料</span><b>{grant.subject_name||`${grant.subject_type}#${grant.subject_id}`}</b><small>{grant.permission==="EDIT"?"可编辑":"只读"}{grant.expires_at?` · 至 ${grant.expires_at}`:" · 长期"}</small><button onClick={()=>removePermission(grant,"DOCUMENT")}>移除</button></div>)}{(doc.spacePermissions??[]).map(grant=><div key={`s-${grant.subject_type}-${grant.subject_id}-${grant.permission}`}><span>空间</span><b>{grant.subject_name||`${grant.subject_type}#${grant.subject_id}`}</b><small>{grant.permission==="EDIT"?"可编辑":"只读"} · 整个空间</small><button onClick={()=>removePermission(grant,"SPACE")}>移除</button></div>)}{!(doc.acl?.length||doc.spacePermissions?.length)&&<p>当前仅使用部门与共享范围默认权限。</p>}</div></section>}
        <article className="doc-content">
          <h3>{previewUrl ? "原件预览" : "文档正文"}</h3>
          {previewUrl ? (
            <iframe
              className="pdf-preview"
              title={`${doc.title} PDF预览`}
              src={previewUrl}
            />
          ) : doc.content.trim() ? (
            doc.content
              .split("\n")
              .filter(Boolean)
              .map((p, i) => <p key={i}>{p}</p>)
          ) : (
            <div className="content-empty">
              <b>{parseStatusLabel(doc.parseStatus)}</b>
              <p>
                {doc.sourceName
                  ? `原件 ${doc.sourceName} 已保存；请补充正文或重新执行本地解析后建立索引。`
                  : "当前资料尚未填写正文。"}
              </p>
              {doc.sourceKey && (
                <button onClick={onDownload}>下载原件查看</button>
              )}
            </div>
          )}
        </article>
        <section className="version-list">
          <h3>版本记录</h3>
          {versions.length ? (
            versions.map((item, index) => (
              <div key={item.id}>
                <span>V{item.version}.0</span>
                <p>
                  <b>{index === 0 ? "当前版本" : "历史版本"}</b>
                  <small>
                    {item.operator} ·{" "}
                    {item.changeNote ||
                      (item.version === 1 ? "首次上传" : "内容更新")}{" "}
                    · {item.createdAt.slice(0, 10)}
                  </small>
                </p>
                {canRestore && index > 0 && (
                  <button onClick={() => onRestore(item.version)}>
                    恢复为新草稿
                  </button>
                )}
              </div>
            ))
          ) : (
            <div>
              <span>V{doc.version}.0</span>
              <p>
                <b>首次上传版本</b>
                <small>
                  {doc.uploader} · 首次上传 · {doc.updatedAt.slice(0, 10)}
                </small>
              </p>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function UploadModal({
  loading,
  progress,
  currentUser,
  options,
  categories,
  tags,
  spaces,
  config,
  onSubmit,
  onClose,
}: {
  loading: boolean;
  progress: ExtractionProgress | null;
  currentUser: { displayName: string; role: string; primaryDeptId: number };
  options: UploadOptions;
  categories: TaxonomyOption[];
  tags: TaxonomyOption[];
  spaces: UploadSpace[];
  config: Record<string,string>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [deptId, setDeptId] = useState(currentUser.primaryDeptId);
  const [spaceId,setSpaceId]=useState(0);
  const [reviewDate] = useState(() =>
    new Date(Date.now() + Math.max(1,Number(config['governance.review_days']||180)) * 86400000).toISOString().slice(0, 10),
  );
  const department =
    options.departments.find((item) => item.id === deptId) ??
    options.departments[0];
  const departmentMembers = options.members.filter(
    (item) => item.dept_id === deptId,
  );
  const availableCategories=categories.filter(item=>!item.dept_id||item.dept_id===deptId);
  const availableTags=tags.filter(item=>!item.dept_id||item.dept_id===deptId);
  const availableSpaces=spaces.filter(item=>!item.dept_id||item.dept_id===deptId);
  const uniqueSpaces=Array.from(new Map(availableSpaces.map(item=>[item.id,item])).values());
  const activeSpaceId=uniqueSpaces.some(item=>item.id===spaceId)?spaceId:(uniqueSpaces[0]?.id??0);
  const availableFolders=availableSpaces.filter(item=>item.id===activeSpaceId&&item.folder_id);
  const defaultCategory = (availableCategories.find(item=>item.dept_id===deptId)??availableCategories[0])?.name??"未分类";
  const defaultOwner =
    departmentMembers.find(
      (item) => item.display_name === currentUser.displayName,
    )?.display_name ??
    departmentMembers[0]?.display_name ??
    currentUser.displayName;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="upload-modal"
        onSubmit={onSubmit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <span className="page-kicker">KNOWLEDGE INGESTION</span>
            <h2>上传企业资料</h2>
            <p>身份与组织信息已按权限自动联动，文件将直接写入企业对象存储。</p>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </header>
        <label className={`file-drop ${fileName ? "has-file" : ""}`}>
          <input
            name="file"
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setFileName(file?.name ?? "");
              if (file && !title) setTitle(file.name.replace(/\.[^.]+$/, ""));
            }}
          />
          <span>{fileName ? "✓" : "⇧"}</span>
          <b>{fileName || "点击选择或拖入文件"}</b>
          <small>
            {fileName
              ? "文件已选择，标题已由文件名自动生成"
              : "支持企业常用文件格式；应用层不设置文件大小限制"}
          </small>
        </label>
        <div className="form-grid">
          <label>
            <span>资料标题 *</span>
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="选择文件后自动生成，可修改"
            />
          </label>
          <label>
            <span>知识分类 *</span>
            <select
              key={`${deptId}-${defaultCategory}`}
              name="category"
              required
              defaultValue={defaultCategory}
            >
              {availableCategories.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>归属部门</span>
            <select
              name="deptId"
              value={deptId}
              onChange={(e) => setDeptId(Number(e.target.value))}
              disabled={currentUser.role !== "SUPER_ADMIN"}
            >
              {options.departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            {currentUser.role !== "SUPER_ADMIN" && (
              <input type="hidden" name="deptId" value={deptId} />
            )}
          </label>
          <label>
            <span>知识负责人 *</span>
            <select
              key={`${deptId}-${defaultOwner}`}
              name="owner"
              required
              defaultValue={defaultOwner}
            >
              {departmentMembers.length ? (
                departmentMembers.map((member) => (
                  <option key={member.id}>{member.display_name}</option>
                ))
              ) : (
                <option>{currentUser.displayName}</option>
              )}
            </select>
          </label>
          <label>
            <span>知识空间</span>
            <select name="spaceId" value={activeSpaceId||""} onChange={e=>setSpaceId(Number(e.target.value))}>
              {!uniqueSpaces.length&&<option value="">暂无可用空间</option>}
              {uniqueSpaces.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            <span>目录</span>
            <select key={activeSpaceId} name="folderId" defaultValue={String(availableFolders[0]?.folder_id??"")}>
              <option value="">空间根目录</option>
              {availableFolders.map(item=><option key={item.folder_id} value={String(item.folder_id)}>{item.folder_name}</option>)}
            </select>
          </label>
          <label>
            <span>上传人（系统带出）</span>
            <input value={currentUser.displayName} readOnly />
          </label>
          <label>
            <span>审核人（部门权限联动）</span>
            <input
              value={department?.approver ?? "待配置部门管理员"}
              readOnly
            />
          </label>
          <label>
            <span>安全密级</span>
            <select name="securityLevel" defaultValue="INTERNAL">
              <option value="INTERNAL">内部公开</option>
              <option value="DEPT">部门可见</option>
              <option value="SENSITIVE">敏感</option>
              <option value="CONFIDENTIAL">核心机密</option>
            </select>
          </label>
          <label>
            <span>共享范围</span>
            <select
              name="shareScope"
              disabled={currentUser.role === "EMPLOYEE"}
            >
              <option value="DEPT">仅本部门</option>
              <option value="CROSS_DEPT">跨部门共享</option>
            </select>
            {currentUser.role === "EMPLOYEE" && (
              <input type="hidden" name="shareScope" value="DEPT" />
            )}
          </label>
          <label>
            <span>标签</span>
            <input name="tags" list="knowledge-tag-options" placeholder="可选已有标签，也可逗号分隔新增" />
            <datalist id="knowledge-tag-options">{availableTags.map(item=><option key={item.id} value={item.name}/>)}</datalist>
          </label>
          <label>
            <span>下次复核日</span>
            <input name="reviewDueAt" type="date" defaultValue={reviewDate} />
          </label>
          <label className="wide">
            <span>摘要</span>
            <textarea
              name="summary"
              rows={2}
              placeholder="帮助员工快速判断内容是否相关"
            />
          </label>
          <label className="wide">
            <span>正文 / 解析补充</span>
            <textarea
              name="content"
              rows={4}
              placeholder="可粘贴核心内容，上传后仍可继续编辑"
            />
          </label>
        </div>
        <div className="publish-choice">
          <label>
            <input type="radio" name="status" value="draft" defaultChecked />{" "}
            保存草稿
          </label>
          <label>
            <input type="radio" name="status" value="review" /> 提交部门审核
          </label>
        </div>
        {loading && progress && (
          <div className="ingestion-progress">
            <div>
              <span style={{ width: `${Math.max(4, progress.percent)}%` }} />
            </div>
            <b>{progress.message}</b>
            <small>
              {progress.stage === "OCR"
                ? "图片文字仅在本机识别，不上传第三方 OCR 服务"
                : progress.stage === "EMBED"
                  ? "正在使用本地中文模型建立语义索引"
                  : "原始文件将保留在企业文件存储中"}
            </small>
          </div>
        )}
        <footer>
          <button type="button" onClick={onClose} disabled={loading}>
            取消
          </button>
          <button className="primary-action" disabled={loading}>
            {loading
              ? progress?.message || "正在写入文件并生成记录..."
              : "上传并生成记录"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function FeedbackModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (v: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="modal-backdrop nested-modal" onMouseDown={onClose}>
      <div className="feedback-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>提交纠错反馈</h2>
        <p>反馈将自动关联当前文档与版本，并通知知识负责人。</p>
        <textarea
          aria-label="反馈内容"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={5}
          placeholder="请描述错误、过期内容或补充建议..."
        />
        <div>
          <button onClick={onClose}>取消</button>
          <button
            className="primary-action"
            disabled={!value.trim()}
            onClick={() => onSubmit(value)}
          >
            提交反馈
          </button>
        </div>
      </div>
    </div>
  );
}

function AiPanel({
  onClose,
  onOpen,
  onGovernanceCreated,
  onActivity,
}: {
  onClose: () => void;
  onOpen: (documentId: number) => void | Promise<void>;
  onGovernanceCreated: () => void;
  onActivity: () => void;
}) {
  type AiSource = {
    citation: number;
    documentId: number;
    title: string;
    version: number;
    department: string;
    excerpt: string;
    score: number;
  };
  type Conversation = {
    id: number;
    title: string;
    updateTime: string;
    lastMessage: string;
  };
  type Message = {
    id: number;
    role: "user" | "assistant";
    content: string;
    mode?: string;
    model?: string;
    sources: AiSource[];
    correction?: QueryCorrection;
    queryLogId?: number;
    helpful?: boolean | null;
    reason?: string;
  };
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checklistGenerated, setChecklistGenerated] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [feedbackTarget, setFeedbackTarget] = useState<number | null>(null);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [feedbackDetail, setFeedbackDetail] = useState("");
  const conversationScrollRef = useRef<HTMLElement | null>(null);
  const keepAtBottomRef = useRef(true);
  useEffect(() => {
    if (!keepAtBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const node = conversationScrollRef.current;
      if (node)
        node.scrollTo({
          top: node.scrollHeight,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, loading, feedbackTarget]);
  async function loadConversations(selectLatest = false) {
    const response = await fetch("/api/ai/conversations", {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload.error?.message ?? "历史会话加载失败");
    const rows: Conversation[] = (payload.data.conversations ?? []).map(
      (row: Record<string, unknown>) => ({
        id: Number(row.id),
        title: String(row.title),
        updateTime: String(row.update_time),
        lastMessage: String(row.last_message ?? ""),
      }),
    );
    setConversations(rows);
    if (selectLatest && rows[0]) await loadConversation(rows[0].id);
  }
  async function loadConversation(id: number) {
    keepAtBottomRef.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/ai/conversations?id=${id}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? "会话加载失败");
      setConversationId(id);
      setMessages(
        (payload.data.messages ?? []).map((row: Record<string, unknown>) => {
          let sources: AiSource[] = [];
          let correction: QueryCorrection | undefined;
          try {
            sources = JSON.parse(String(row.source_payload ?? "[]"));
            correction = JSON.parse(String(row.correction_payload ?? "{}"));
            if (!correction?.original) correction = undefined;
          } catch {
            /* ignore malformed history */
          }
          return {
            id: Number(row.id),
            role: String(row.role) as "user" | "assistant",
            content: String(row.content),
            mode: row.mode ? String(row.mode) : undefined,
            sources,
            correction,
            queryLogId: row.query_log_id ? Number(row.query_log_id) : undefined,
            helpful:
              row.helpful === null || row.helpful === undefined
                ? null
                : Boolean(row.helpful),
            reason: String(row.reason ?? ""),
          };
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "会话加载失败");
    } finally {
      setLoading(false);
    }
  }
  // Initial server-backed session restore runs once when the workbench opens.
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        loadConversations(true).catch((caught) =>
          setError(
            caught instanceof Error ? caught.message : "历史会话加载失败",
          ),
        ),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function newConversation() {
    keepAtBottomRef.current = true;
    setConversationId(null);
    setMessages([]);
    setQuestion("");
    setError("");
  }
  async function deleteConversation(id: number) {
    if (!window.confirm("删除该历史会话？此操作不会删除原始知识文档。")) return;
    const response = await fetch(`/api/ai/conversations?id=${id}`, {
      method: "DELETE",
    });
    if (!response.ok) return setError("会话删除失败");
    if (conversationId === id) newConversation();
    await loadConversations(false);
  }
  async function ask(nextQuestion = question) {
    if (!nextQuestion.trim() || loading) return;
    keepAtBottomRef.current = true;
    const userText = nextQuestion.trim();
    // 追踪办理清单：如果用户输入了新的追问（非清单模板），允许再次生成
    if(!userText.includes("生成结构化办理清单")) setChecklistGenerated(false);
    const optimisticId = -Date.now();
    setMessages((current) => [
      ...current,
      { id: optimisticId, role: "user", content: userText, sources: [] },
    ]);
    setQuestion("");
    setLoading(true);
    setError("");
    try {
      const previousUser = [...messages]
        .reverse()
        .find((item) => item.role === "user");
      const embeddingText =
        isContextFollowUp(userText) && previousUser
          ? `${previousUser.content}\n${userText}`
          : userText;
      const queryEmbedding = (
        await embedLocally([embeddingText]).catch(() => [])
      )[0];
      const response = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: userText,
          conversationId,
          queryEmbedding,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? "知识问答暂不可用");
      const nextId = Number(payload.data.conversationId);
      setConversationId(nextId || null);
      setMessages((current) => [
        ...current.map((item) =>
          item.id === optimisticId ? { ...item, id: optimisticId - 1 } : item,
        ),
        {
          id: Number(payload.data.messageId),
          role: "assistant",
          content: payload.data.answer,
          sources: payload.data.sources,
          correction: payload.data.correction,
          mode: payload.data.mode,
          model: payload.data.model,
          queryLogId: Number(payload.data.queryLogId),
          helpful: null,
        },
      ]);
      onActivity();
      await loadConversations(false);
    } catch (caught) {
      setMessages((current) =>
        current.filter((item) => item.id !== optimisticId),
      );
      setError(caught instanceof Error ? caught.message : "知识问答暂不可用");
    } finally {
      setLoading(false);
    }
  }
  async function submitHelpful(
    message: Message,
    helpful: boolean,
    reason = "",
    detail = "",
  ) {
    if (!message.queryLogId) return;
    const response = await fetch("/api/engagement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "AI_HELPFUL",
        queryLogId: message.queryLogId,
        messageId: message.id,
        helpful,
        reason,
        detail,
      }),
    });
    const payload = await response.json();
    if (!response.ok) return setError(payload.error?.message ?? "评价提交失败");
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id ? { ...item, helpful, reason } : item,
      ),
    );
    setFeedbackTarget(null);
    setFeedbackReason("");
    setFeedbackDetail("");
    if (!helpful) onGovernanceCreated();
  }
  const hasMessages = messages.length > 0;
  return (
    <div className="modal-backdrop ai-backdrop" onMouseDown={onClose}>
      <section
        className="ai-panel enterprise-ai"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          className="close-button"
          aria-label="关闭智能问答"
          onClick={onClose}
        >
          ×
        </button>
        <aside className="ai-intro ai-history">
          <div className="ai-brand">
            <span className="ai-orb">✦</span>
            <div>
              <small>ZHIYU INTELLIGENCE</small>
              <b>问问小知</b>
            </div>
          </div>
          <button className="new-chat" onClick={newConversation}>
            ＋ 新建会话
          </button>
          <div className="history-title">
            <span>历史会话</span>
            <div>
              <small>{conversations.length}</small>
              {conversations.length>0&&<button style={{marginLeft:10,border:"1px solid rgba(255,255,255,.2)",borderRadius:5,background:"transparent",color:"#d99e8e",fontSize:8,padding:"3px 7px",cursor:"pointer"}} onClick={async()=>{if(!confirm("确定清空全部历史会话？此操作不可恢复。"))return;await fetch("/api/ai/conversations?all=true",{method:"DELETE"});newConversation();await loadConversations(false);}}>清空全部</button>}
            </div>
          </div>
          <div className="conversation-list">
            {conversations.map((item) => (
              <div
                className={conversationId === item.id ? "active" : ""}
                key={item.id}
              >
                <button onClick={() => loadConversation(item.id)}>
                  <b>{item.title}</b>
                  <small>{item.lastMessage || "等待首次提问"}</small>
                </button>
                <button
                  aria-label={`删除会话${item.title}`}
                  onClick={() => deleteConversation(item.id)}
                >
                  ×
                </button>
              </div>
            ))}
            {!conversations.length && (
              <p>暂无历史会话，开始第一次企业知识问答吧。</p>
            )}
          </div>
          <div className="ai-trust">
            <span>●</span> 会话已按账号安全保存
          </div>
        </aside>
        <main className="ai-workspace">
          <header>
            <div>
              <span className="pulse-dot" />
              <div>
                <b>知识问答工作台</b>
                <small>
                  {conversationId
                    ? "上下文已连接 · 自动保存"
                    : "新会话 · 首次提问后保存"}
                </small>
              </div>
            </div>
            <div className="ai-status">
              <span>✓ 账号权限上下文已生效</span>
              <span>{messages.flatMap((m) => m.sources).length} 条引用</span>
              <span>
                {conversationId
                  ? `${messages.length} 条上下文已恢复`
                  : "等待建立会话"}
              </span>
            </div>
          </header>
          <section
            ref={conversationScrollRef}
            className="ai-conversation"
            onScroll={(event) => {
              const node = event.currentTarget;
              keepAtBottomRef.current =
                node.scrollHeight - node.scrollTop - node.clientHeight < 96;
            }}
          >
            {hasMessages ? (
              <div className="message-stream">
                {messages.map((message) =>
                  message.role === "user" ? (
                    <div className="user-message" key={message.id}>
                      <span>你</span>
                      <p>{message.content}</p>
                    </div>
                  ) : (
                    <div className="ai-answer" key={message.id}>
                      <div className="answer-meta">
                        <span>AI</span>
                        <small>
                          {message.mode?.startsWith("assistant_redirect")
                            ? ""
                            : message.mode?.startsWith("assistant_")
                              ? "平台助手 · 无需知识检索"
                            : message.mode?.startsWith("rag")
                              ? message.mode.includes("local_vector")
                                ? "已检索企业知识 · 语义匹配"
                                : message.mode.includes("keyword_fallback")
                                  ? "已检索企业知识 · 关键词匹配"
                                  : "已检索企业知识 · AI 整理"
                              : message.mode?.includes("retrieval")
                                ? message.mode.includes("keyword_fallback")
                                  ? "已核验企业知识 · 引用摘要"
                                  : "已核验企业知识 · 语义摘要"
                                : "暂未找到相关内容"}
                        </small>
                      </div>
                      {message.correction?.applied &&
                        message.correction.corrected !==
                          message.correction.original && (
                          <div className="answer-correction">
                            <b>猜你想问“{message.correction.corrected}”</b>
                            <small>我已按这个意思查找，并保留了原始输入</small>
                          </div>
                        )}
                      <AiAnswerContent content={message.content} />
                      {message.sources.length > 0 && (
                        <div className="source-label">
                          引用来源 · {message.sources.length}
                        </div>
                      )}
                      {message.sources.map((source) => (
                        <button
                          key={`${message.id}-${source.documentId}-${source.citation}`}
                          onClick={() => onOpen(source.documentId)}
                        >
                          <b>引用 {source.citation}</b>
                          <span>
                            {source.title} · V{source.version}.0 ·{" "}
                            {source.department} →
                          </span>
                          <small>{source.excerpt}</small>
                        </button>
                      ))}
                      {message.queryLogId &&
                        !message.mode?.startsWith("assistant_") && (
                          <div className="ai-followups">
                            {message.sources.length > 0 && !checklistGenerated ? <button
                                onClick={() => {
                                  ask("请根据当前问题和以上引用，生成结构化办理清单，包含步骤、所需材料、责任角色和注意事项");
                                  setChecklistGenerated(true);
                                }}
                              >
                                生成办理清单
                              </button> : null}
                            {message.sources.length > 0 && (
                              <button
                                className={
                                  message.helpful === true ? "selected" : ""
                                }
                                disabled={
                                  message.helpful !== null &&
                                  message.helpful !== undefined
                                }
                                onClick={() => submitHelpful(message, true)}
                              >
                                {message.helpful === true
                                  ? "✓ 已评价有帮助"
                                  : "有帮助"}
                              </button>
                            )}
                            <button
                              className={
                                message.helpful === false
                                  ? "selected negative"
                                  : ""
                              }
                              disabled={
                                message.helpful !== null &&
                                message.helpful !== undefined
                              }
                              onClick={() => setFeedbackTarget(message.id)}
                            >
                              {message.helpful === false
                                ? "✓ 已提交改进"
                                : "没解决"}
                            </button>
                          </div>
                        )}
                      {feedbackTarget === message.id && (
                        <div className="unresolved-form">
                          <b>哪里没有解决？</b>
                          <div>
                            {[
                              "答案不准确",
                              "没有找到资料",
                              "引用不相关",
                              "内容已过期",
                            ].map((reason) => (
                              <button
                                className={
                                  feedbackReason === reason ? "active" : ""
                                }
                                key={reason}
                                onClick={() => setFeedbackReason(reason)}
                              >
                                {reason}
                              </button>
                            ))}
                          </div>
                          <textarea
                            value={feedbackDetail}
                            onChange={(e) => setFeedbackDetail(e.target.value)}
                            placeholder="可补充具体问题，提交后会进入知识治理待办"
                            rows={2}
                          />
                          <footer>
                            <button onClick={() => setFeedbackTarget(null)}>
                              取消
                            </button>
                            <button
                              disabled={!feedbackReason}
                              onClick={() =>
                                submitHelpful(
                                  message,
                                  false,
                                  feedbackReason,
                                  feedbackDetail,
                                )
                              }
                            >
                              提交改进
                            </button>
                          </footer>
                        </div>
                      )}
                    </div>
                  ),
                )}
              </div>
            ) : (
              <div className="ai-empty">
                <span>✦</span>
                <h3>今天想了解什么？</h3>
                <p>我会从你有权限查看的企业知识中寻找答案，并标注每条依据。</p>
                <div className="suggestions">
                  <button onClick={() => setQuestion("差旅报销需要哪些材料？")}>
                    <i>制度查询</i>
                    <b>差旅报销需要哪些材料？</b>
                    <span>→</span>
                  </button>
                  <button onClick={() => setQuestion("新员工第一周需要完成什么？")}>
                    <i>入职指南</i>
                    <b>新员工第一周需要完成什么？</b>
                    <span>→</span>
                  </button>
                  <button onClick={() => setQuestion("生产环境发布需要哪些审批？")}
                  >
                    <i>研发规范</i>
                    <b>生产环境发布需要哪些审批？</b>
                    <span>→</span>
                  </button>
                </div>
              </div>
            )}
            {loading && (
              <div className="thinking">
                <span />
                <span />
                <span /> 正在识别意图并检索权限范围内知识
              </div>
            )}
            {error && <p className="ai-error">{error}</p>}
            <div className="chat-scroll-anchor" aria-hidden="true" />
          </section>
          <footer className="ai-compose">
            <div className="ai-input">
              <span>✦</span>
              <input
                aria-label="向企业知识库提问"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={
                  hasMessages
                    ? "继续追问当前会话..."
                    : "输入你的问题，Enter 发送..."
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") ask();
                }}
              />
              <button
                onClick={() => ask()}
                disabled={!question.trim() || loading}
              >
                {loading ? "处理中" : "发送"}
              </button>
            </div>
            <small>意图识别 · 权限检索 · DeepSeek 生成 · 会话自动保存</small>
          </footer>
        </main>
      </section>
    </div>
  );
}


function DecisionDialog({treeId,title,onClose}:{treeId:number;title:string;onClose:()=>void}){
  const [nodes,setNodes]=useState<Array<{id:number;question:string;options:string;result:string;parent_id:number|null}>>([]);
  const [currentId,setCurrentId]=useState<number|null>(null);
  const [history,setHistory]=useState<number[]>([]);
  const [error,setError]=useState("");
  type NodeType={id:number;question:string;options:string;result:string;parent_id:number|null};
  useEffect(()=>{fetch('/api/decisions?id='+treeId).then(r=>r.json()).then(d=>{if(d.success){const all=d.data.allNodes as NodeType[];setNodes(all);const roots=all.filter((n:NodeType)=>!n.parent_id);if(roots.length)setCurrentId(roots[0].id);else setError("该决策树没有根节点")}else{setError(d.error?.message||"加载失败")}}).catch(()=>setError("加载决策树失败"))},[treeId]);
  const node=nodes.find(n=>n.id===currentId);
  const opts: Array<{label:string;next:number}> = node ? JSON.parse(node.options||'[]') : [];
  const isEnd=!opts.length;
  function goBack(){if(history.length>0){const prev=[...history];const lastId=prev[prev.length-1];prev.length=prev.length-1;setCurrentId(lastId);setHistory(prev)}}
  function navigateTo(nextId:number){const cur=currentId;if(cur!=null){setHistory([...history,cur]);setCurrentId(nextId)}}
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="upload-modal decision-dialog" onMouseDown={e=>e.stopPropagation()} style={{width:'min(520px,94vw)',maxHeight:'80vh',overflow:'auto'}}><header style={{display:'flex',justifyContent:'space-between',alignItems:'start'}}><div><span className="page-kicker">DECISION GUIDE</span><h2 style={{fontFamily:"Georgia,'Songti SC',serif",fontSize:21,margin:'6px 0 4px'}}>{title}</h2></div><button onClick={onClose} style={{border:0,background:'transparent',fontSize:22,color:'#778580'}}>×</button></header>
  {error?<p style={{color:'#c75b5b',fontSize:10,padding:20}}>{error}</p>
  :node?<div style={{marginTop:20}}><div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>{history.length>0&&<button onClick={goBack} style={{border:'1px solid #dce4e1',borderRadius:6,background:'white',padding:'5px 10px',fontSize:9,cursor:'pointer'}}>← 返回</button>}<span style={{fontSize:9,color:'#8b9d98'}}>步骤 {history.length+1}</span></div><h3 style={{fontSize:15,margin:'0 0 16px',color:'#1c2926'}}>{node.question}</h3>
  {isEnd?<div style={{padding:16,background:'#f5faf7',border:'1px solid #d0e8dd',borderRadius:9}}><b style={{fontSize:11,color:'#1a6b5e',display:'block',marginBottom:8}}>指引结果</b><p style={{fontSize:10,color:'#38534c',lineHeight:1.7,whiteSpace:'pre-wrap',margin:0}}>{node.result||'暂无详细指引，请参考相关制度文档'}</p></div>
  :<div style={{display:'grid',gap:8}}>{opts.map((opt)=><button key={opt.label} onClick={()=>navigateTo(opt.next)} style={{textAlign:'left',padding:'12px 16px',border:'1px solid #dce8e4',borderRadius:9,background:'white',fontSize:11,color:'#38534c',cursor:'pointer'}}>{opt.label} →</button>)}</div>}</div>
  :<p style={{color:'#8b9d98',fontSize:10,padding:20}}>加载中...</p>}</div></div>;
}
