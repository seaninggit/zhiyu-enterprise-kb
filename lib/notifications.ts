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
  const apiKey = (env as unknown as { RESEND_API_KEY?: string }).RESEND_API_KEY;
  let status = "SKIPPED";
  let providerId = "";
  let error = "";
  if (!address || address.endsWith(".invalid") || address.endsWith("@local.invalid")) {
    error = "NON_DELIVERABLE_ACCOUNT";
  } else if (!apiKey) {
    error = "EMAIL_PROVIDER_NOT_CONFIGURED";
  } else {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: "知域知识库 <onboarding@resend.dev>",
          to: [address],
          subject: `[知域] ${input.title}`,
          html: `<h3>${html(input.title)}</h3><p>您好，${html(user.display_name)}：</p><p>${html(input.content)}</p><hr><small>此邮件由知域企业知识中台自动发送，请勿直接回复。</small>`,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (response.ok) {
        status = "SENT";
        providerId = payload.id || "";
      } else {
        status = "FAILED";
        error = payload.message || `HTTP_${response.status}`;
      }
    } catch (cause) {
      status = "FAILED";
      error = cause instanceof Error ? cause.message : "NETWORK_ERROR";
    }
  }

  await db.batch([
    db.prepare(
      "INSERT INTO notification_deliveries(user_id,document_id,channel,event_type,recipient,status,provider_message_id,error_message,request_id) VALUES(?,?,'EMAIL',?,?,?,?,?,?)",
    ).bind(
      user.id,
      input.documentId ?? null,
      input.type,
      address,
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
