import { env } from "cloudflare:workers";
import { getD1 } from "../db";

type NotificationInput = {
  userId: number;
  type: string;
  title: string;
  content: string;
  documentId?: number | null;
  requestId: string;
  email?: boolean;
};

function html(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br>");
}

async function deliverEmail(address: string, displayName: string, title: string, content: string) {
  const apiKey = (env as unknown as { RESEND_API_KEY?: string }).RESEND_API_KEY;
  if (!address || address.endsWith(".invalid") || address.endsWith("@local.invalid"))
    return { status: "SKIPPED", providerId: "", error: "NON_DELIVERABLE_ACCOUNT" };
  if (!apiKey)
    return { status: "FAILED", providerId: "", error: "EMAIL_PROVIDER_NOT_CONFIGURED" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: "知域知识库 <onboarding@resend.dev>", to: [address], subject: `[知域] ${title}`,
        html: `<h3>${html(title)}</h3><p>您好，${html(displayName)}：</p><p>${html(content)}</p><hr><small>此邮件由知域企业知识中台自动发送，请勿直接回复。</small>`,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    return response.ok
      ? { status: "SENT", providerId: payload.id || "", error: "" }
      : { status: "FAILED", providerId: "", error: payload.message || `HTTP_${response.status}` };
  } catch (cause) {
    return { status: "FAILED", providerId: "", error: cause instanceof Error ? cause.message : "NETWORK_ERROR" };
  }
}

export async function retryNotificationDelivery(id: number, requestId: string, actorUserId: number, actor: string) {
  const db = getD1();
  const row = await db.prepare(`SELECT nd.*,u.display_name FROM notification_deliveries nd JOIN users u ON u.id=nd.user_id WHERE nd.id=?`).bind(id).first<Record<string,unknown>>();
  if (!row) throw new Error("投递记录不存在");
  if (!['FAILED','PENDING'].includes(String(row.status))) throw new Error("仅失败或等待中的邮件可以重试");
  if (!String(row.subject) || !String(row.content)) throw new Error("历史投递缺少可重试正文");
  const result = await deliverEmail(String(row.recipient), String(row.display_name), String(row.subject), String(row.content));
  await db.batch([
    db.prepare("UPDATE notification_deliveries SET status=?,attempt=attempt+1,provider_message_id=?,error_message=?,request_id=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(result.status,result.providerId,result.error,requestId,id),
    db.prepare("INSERT INTO audit_logs(document_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?)").bind(row.document_id??null,result.status==='SENT'?'EMAIL_RETRY_SENT':'EMAIL_RETRY_FAILED',actorUserId,actor,`${row.event_type} → ${row.recipient}${result.error?`（${result.error}）`:''}`,requestId),
  ]);
  return { id, ...result, attempt:Number(row.attempt||1)+1 };
}

export async function notifyUser(input: NotificationInput) {
  const db = getD1();
  const user = await db
    .prepare("SELECT id,email,display_name FROM users WHERE id=? AND status='ACTIVE'")
    .bind(input.userId)
    .first<{ id: number; email: string; display_name: string }>();
  if (!user) return { station: false, email: "SKIPPED", reason: "USER_INACTIVE" };

  await db
    .prepare("INSERT INTO notifications(user_id,type,title,content,document_id) VALUES(?,?,?,?,?)")
    .bind(user.id, input.type, input.title, input.content, input.documentId ?? null)
    .run();

  if (!input.email)
    return { station: true, email: "SKIPPED", reason: "EMAIL_NOT_REQUESTED" };

  const address = String(user.email || "").trim().toLowerCase();
  const {status,providerId,error}=await deliverEmail(address,user.display_name,input.title,input.content);

  await db.batch([
    db.prepare(
      "INSERT INTO notification_deliveries(user_id,document_id,channel,event_type,recipient,subject,content,status,provider_message_id,error_message,request_id) VALUES(?,?,'EMAIL',?,?,?,?,?,?,?,?)",
    ).bind(
      user.id,
      input.documentId ?? null,
      input.type,
      address,
      input.title,
      input.content,
      status,
      providerId,
      error,
      input.requestId,
    ),
    db.prepare(
      "INSERT INTO audit_logs(document_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,?,?,?,?)",
    ).bind(
      input.documentId ?? null,
      status === "SENT" ? "EMAIL_SENT" : status === "FAILED" ? "EMAIL_FAILED" : "EMAIL_SKIPPED",
      user.id,
      "通知服务",
      `${input.type} → ${address || "无邮箱"}${error ? `（${error}）` : ""}`,
      input.requestId,
    ),
  ]);
  return { station: true, email: status, reason: error || undefined, providerId };
}
