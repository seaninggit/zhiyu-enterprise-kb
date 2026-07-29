import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { auditLogs, documents, documentVersions, feedback } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const documentId = Number(id);
  const db = getDb();
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!document) return Response.json({ error: "文档不存在" }, { status: 404 });
  const versions = await db.select().from(documentVersions).where(eq(documentVersions.documentId, documentId));
  return Response.json({ document, versions });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const documentId = Number(id);
  const payload = await request.json() as { type?: string; content?: string };
  const user = await getChatGPTUser();
  const reporter = user?.displayName ?? "普通员工";
  if (!payload.content?.trim()) return Response.json({ error: "反馈内容不能为空" }, { status: 400 });
  const db = getDb();
  const [item] = await db.insert(feedback).values({ documentId, type: payload.type ?? "纠错", content: payload.content.trim(), reporter }).returning();
  await db.insert(auditLogs).values({ documentId, action: "FEEDBACK", actor: reporter, detail: payload.content.trim() });
  return Response.json({ feedback: item }, { status: 201 });
}

export async function PUT(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const documentId = Number(id);
  const db = getDb();
  const [document] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!document?.sourceKey) return Response.json({ error: "该知识没有原始附件" }, { status: 404 });
  const bucket = (env as unknown as { KNOWLEDGE_FILES?: R2Bucket }).KNOWLEDGE_FILES;
  const object = await bucket?.get(document.sourceKey);
  if (!object) return Response.json({ error: "附件暂不可用" }, { status: 404 });
  return new Response(object.body, { headers: { "content-type": document.mimeType ?? "application/octet-stream", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.sourceName ?? "document")}` } });
}
