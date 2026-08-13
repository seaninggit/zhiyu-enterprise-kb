import { getD1 } from "../db";
import { notifyUser } from "./notifications";

export async function resolvePublishedFeedback(input: {
  documentId: number;
  actorUserId: number;
  actorName: string;
  requestId: string;
}) {
  const db = getD1();
  const document = await db
    .prepare("SELECT id,title,dept_id,status FROM documents WHERE id=? AND is_deleted=0")
    .bind(input.documentId)
    .first<{ id: number; title: string; dept_id: number; status: string }>();
  if (!document || document.status !== "ARCHIVED_ACTIVE")
    return { resolved: 0, deliveries: [] as unknown[] };

  const tasks = await db
    .prepare("SELECT id,reporter_user_id,reason FROM knowledge_governance_tasks WHERE type='DOCUMENT_FEEDBACK' AND (source_document_id=? OR target_document_id=?) AND workflow_stage='WAITING_APPROVAL' AND status IN ('OPEN','IN_PROGRESS')")
    .bind(document.id, document.id)
    .all<{ id: number; reporter_user_id: number; reason: string }>();
  const deliveries: unknown[] = [];
  for (const task of tasks.results) {
    await db.batch([
      db.prepare("UPDATE knowledge_governance_tasks SET status='RESOLVED',workflow_stage='RESOLVED',target_document_id=?,resolution='关联文档已审核发布，系统自动闭环',resolved_by=?,resolved_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE id=? AND status IN ('OPEN','IN_PROGRESS')")
        .bind(document.id, input.actorUserId, task.id),
      db.prepare("UPDATE feedback SET status='RESOLVED' WHERE document_id=? AND reporter_user_id=? AND status='OPEN'")
        .bind(document.id, task.reporter_user_id),
      db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,'GOVERNANCE_AUTO_RESOLVED',?,?,?,?)")
        .bind(document.id, document.dept_id, input.actorUserId, input.actorName, `审批发布后自动关闭治理任务 #${task.id}`, input.requestId),
    ]);
    deliveries.push(await notifyUser({
      userId: task.reporter_user_id,
      type: "GOVERNANCE_RESOLVED",
      title: "你的知识反馈已处理",
      content: `你反馈的《${document.title}》已完成修改、审核并重新发布。反馈事项“${task.reason}”已自动闭环。`,
      documentId: document.id,
      requestId: input.requestId,
      email: true,
    }));
  }
  return { resolved: tasks.results.length, deliveries };
}
