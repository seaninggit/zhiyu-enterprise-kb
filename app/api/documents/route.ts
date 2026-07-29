import { desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { auditLogs, documents, documentVersions } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

const demoDocuments = [
  { title: "新员工入职指南", summary: "账号开通、办公环境与团队融入指南。", content: "欢迎加入知域。本指南覆盖入职第一周必须完成的账号、设备、安全培训和团队融入事项。", category: "组织人事", tags: "入职,新员工", status: "published", owner: "People 团队", uploader: "林晓", securityLevel: "内部公开", reviewDueAt: "2027-01-15" },
  { title: "产品需求评审规范", summary: "PRD 准入标准、评审角色与变更管理流程。", content: "所有产品需求在进入研发排期前，必须完成业务价值、用户影响、技术可行性和数据口径评审。", category: "产品研发", tags: "PRD,评审", status: "published", owner: "产品委员会", uploader: "周屿", securityLevel: "内部公开", reviewDueAt: "2026-12-20" },
  { title: "客户数据安全与分级标准", summary: "客户信息全生命周期安全要求。", content: "客户数据按照公开、内部、敏感、核心四级管理。任何下载、外发与复制行为均需符合最小权限原则。", category: "财务法务", tags: "安全,合规", status: "review", owner: "安全合规部", uploader: "陈默", securityLevel: "敏感", reviewDueAt: "2026-08-15" },
  { title: "差旅及费用报销制度", summary: "差旅申请、费用标准、票据与报销时限说明。", content: "出差前需完成差旅申请。返程后 10 个工作日内提交报销，发票抬头与税号必须准确。", category: "财务法务", tags: "报销,差旅,制度", status: "published", owner: "财务共享中心", uploader: "苏晴", securityLevel: "内部公开", reviewDueAt: "2027-02-01" },
];

async function seedIfEmpty() {
  const db = getDb();
  const existing = await db.select({ id: documents.id }).from(documents).limit(1);
  if (existing.length) return;
  for (const item of demoDocuments) {
    const [created] = await db.insert(documents).values(item).returning();
    await db.insert(documentVersions).values({ documentId: created.id, version: 1, changeNote: "首次发布", operator: item.uploader });
  }
}

export async function GET() {
  try {
    await seedIfEmpty();
    const db = getDb();
    const [items, logs] = await Promise.all([
      db.select().from(documents).orderBy(desc(documents.updatedAt), desc(documents.id)),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(30),
    ]);
    return Response.json({ documents: items, logs });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "数据读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    const form = await request.formData();
    const title = String(form.get("title") ?? "").trim();
    const category = String(form.get("category") ?? "").trim();
    const owner = String(form.get("owner") ?? "").trim();
    if (!title || !category || !owner) return Response.json({ error: "标题、分类和负责人必填" }, { status: 400 });

    const file = form.get("file");
    let sourceKey: string | null = null;
    let sourceName: string | null = null;
    let mimeType: string | null = null;
    let size = 0;
    if (file instanceof File && file.size > 0) {
      sourceName = file.name;
      mimeType = file.type || "application/octet-stream";
      size = file.size;
      sourceKey = `documents/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const bucket = (env as unknown as { KNOWLEDGE_FILES?: R2Bucket }).KNOWLEDGE_FILES;
      if (bucket) await bucket.put(sourceKey, await file.arrayBuffer(), { httpMetadata: { contentType: mimeType } });
    }

    const uploader = user?.displayName ?? "面试演示用户";
    const db = getDb();
    const [document] = await db.insert(documents).values({
      title,
      category,
      owner,
      uploader,
      summary: String(form.get("summary") ?? ""),
      content: String(form.get("content") ?? ""),
      tags: String(form.get("tags") ?? ""),
      securityLevel: String(form.get("securityLevel") ?? "内部公开"),
      status: String(form.get("status") ?? "draft"),
      reviewDueAt: String(form.get("reviewDueAt") ?? "") || null,
      sourceKey,
      sourceName,
      mimeType,
      size,
    }).returning();
    await db.batch([
      db.insert(documentVersions).values({ documentId: document.id, version: 1, changeNote: "上传并创建知识", operator: uploader }),
      db.insert(auditLogs).values({ documentId: document.id, action: "UPLOAD", actor: uploader, detail: sourceName ? `上传文件 ${sourceName}` : "创建在线文档" }),
    ]);
    return Response.json({ document }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = await request.json() as { id?: number; action?: string };
    if (!payload.id || !["approve", "reject", "archive"].includes(payload.action ?? "")) return Response.json({ error: "无效操作" }, { status: 400 });
    const user = await getChatGPTUser();
    const actor = user?.displayName ?? "知识审核人";
    const status = payload.action === "approve" ? "published" : payload.action === "reject" ? "rejected" : "archived";
    const db = getDb();
    const [document] = await db.update(documents).set({ status, updatedAt: new Date().toISOString() }).where(eq(documents.id, payload.id)).returning();
    await db.insert(auditLogs).values({ documentId: payload.id, action: payload.action!.toUpperCase(), actor, detail: `状态更新为 ${status}` });
    return Response.json({ document });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 500 });
  }
}
