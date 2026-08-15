import { getD1 } from "../../../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../../../lib/api";
import { hasPermission, requireApiUser } from "../../../../../lib/authz";

const ACTION_LABELS: Record<string, string> = { PUBLISH: "发布", APPROVE: "审批", VOID: "作废", DELETE: "删除", TRANSFER_OWNER: "责任转交", CHANGE_PERMISSION: "权限变更" };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "governance:platform")) throw new ApiError(403, "FORBIDDEN", "无权处理 Agent 确认");
    const id = Number((await context.params).id);
    if (!id) throw new ApiError(400, "VALIDATION_ERROR", "确认记录ID不能为空");
    const p = await request.json() as { action?: string; decision?: "APPROVE" | "REJECT"; note?: string };
    const db = getD1();
    const confirmation = await db.prepare("SELECT * FROM agent_action_confirmations WHERE id=?").bind(id).first<Record<string, unknown>>();
    if (!confirmation) throw new ApiError(404, "NOT_FOUND", "确认记录不存在");
    const run = await db.prepare("SELECT * FROM agent_workflow_runs WHERE id=?").bind(Number(confirmation.run_id)).first<Record<string, unknown>>();
    if (!run) throw new ApiError(404, "NOT_FOUND", "关联运行不存在");

    if (p.action === "DECIDE") {
      if (confirmation.status !== "PENDING" || run.status !== "WAITING_CONFIRMATION") throw new ApiError(409, "STATE_CONFLICT", "该确认已处理，或运行已不在等待状态");
      const note = safeText(p.note, 500);
      const proposal = JSON.parse(String(confirmation.proposal_json || "{}")) as { action_type?: string; target_type?: string; target_id?: number; reason?: string };
      const actionLabel = ACTION_LABELS[String(proposal.action_type || "")] || String(proposal.action_type || "未知动作");

      if (p.decision === "REJECT") {
        await db.batch([
          db.prepare("UPDATE agent_action_confirmations SET status='REJECTED',decided_by=?,decision_note=?,decided_at=CURRENT_TIMESTAMP WHERE id=?").bind(ctx.userId, note, id),
          db.prepare("UPDATE agent_workflow_runs SET status='SUCCEEDED',summary=?,stop_reason='HIGH_RISK_REJECTED_BY_HUMAN',finished_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(`高风险建议（${actionLabel}）已由 ${ctx.displayName} 拒绝：${note || "未填写原因"}`, Number(confirmation.run_id)),
          db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'AGENT_CONFIRMATION_REJECTED',?,?,?,?)").bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `拒绝确认 #${id}（${actionLabel}）：${note || "未填写原因"}`, rid),
        ]);
        return ok({ decision: "REJECTED", runStatus: "SUCCEEDED" }, rid);
      }
      if (p.decision !== "APPROVE") throw new ApiError(400, "DECISION_INVALID", "请选择批准或拒绝");
      await db.prepare("UPDATE agent_action_confirmations SET status='APPROVED',decided_by=?,decision_note=?,decided_at=CURRENT_TIMESTAMP WHERE id=?").bind(ctx.userId, note, id).run();

      // 作废/归档可安全复用现有正式业务服务：以批准人身份进程内调用，服务会再次校验其真实部门管理权限
      if (proposal.action_type === "VOID" && proposal.target_type === "DOCUMENT" && Number(proposal.target_id)) {
        const { PATCH: documentsPatch } = await import("../../../documents/route");
        const comment = safeText(note || String(proposal.reason || ""), 1000) || "Agent 高风险建议经人工批准执行";
        const inner = new Request("http://internal/api/documents", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: Number(proposal.target_id), action: "archive", comment }) });
        const response = await documentsPatch(inner);
        if (response.ok) {
          await db.batch([
            db.prepare("UPDATE agent_action_confirmations SET status='EXECUTED',executed_at=CURRENT_TIMESTAMP WHERE id=?").bind(id),
            db.prepare("UPDATE agent_workflow_runs SET status='SUCCEEDED',summary=?,stop_reason='HIGH_RISK_APPROVED_EXECUTED',finished_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(`高风险建议（作废文档 #${Number(proposal.target_id)}）已批准，并通过正式业务服务执行完成。`, Number(confirmation.run_id)),
            db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'AGENT_CONFIRMATION_EXECUTED',?,?,?,?)").bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `批准并执行确认 #${id}（作废文档 #${Number(proposal.target_id)}）`, rid),
          ]);
          return ok({ decision: "APPROVED", executed: true, runStatus: "SUCCEEDED" }, rid);
        }
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        await db.batch([
          db.prepare("UPDATE agent_workflow_runs SET status='WAITING_EVENT',summary=?,stop_reason='HIGH_RISK_APPROVED_MANUAL_REQUIRED',update_time=CURRENT_TIMESTAMP WHERE id=?").bind(`已批准作废建议，但正式业务服务拒绝自动执行（${body?.error?.message || "服务不可用"}）。请在资料管理界面手动执行该动作，完成后回到 Agent 运行页复核。`, Number(confirmation.run_id)),
          db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'AGENT_CONFIRMATION_APPROVED',?,?,?,?)").bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `批准确认 #${id}（作废），正式服务未执行（${body?.error?.message || "服务不可用"}），转入人工执行`, rid),
        ]);
        return ok({ decision: "APPROVED", executed: false, runStatus: "WAITING_EVENT" }, rid);
      }

      // 其余高风险动作暂无安全可复用的自动执行服务：停在 WAITING_EVENT，由人工在正式业务界面执行后复核
      await db.batch([
        db.prepare("UPDATE agent_workflow_runs SET status='WAITING_EVENT',summary=?,stop_reason='HIGH_RISK_APPROVED_MANUAL_REQUIRED',update_time=CURRENT_TIMESTAMP WHERE id=?").bind(`已批准【${actionLabel}】建议。请在资料管理界面执行该正式动作，完成后回到 Agent 运行页复核。`, Number(confirmation.run_id)),
        db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'AGENT_CONFIRMATION_APPROVED',?,?,?,?)").bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `批准确认 #${id}（${actionLabel}），等待人工执行正式动作`, rid),
      ]);
      return ok({ decision: "APPROVED", executed: false, runStatus: "WAITING_EVENT" }, rid);
    }

    if (p.action === "VERIFY") {
      if (confirmation.status !== "APPROVED" || run.status !== "WAITING_EVENT") throw new ApiError(409, "STATE_CONFLICT", "仅已批准且等待人工执行的确认可以复核");
      const proposal = JSON.parse(String(confirmation.proposal_json || "{}")) as { action_type?: string; target_type?: string; target_id?: number };
      let verified = false, formalState = "";
      if (proposal.target_type === "DOCUMENT" && Number(proposal.target_id)) {
        const doc = await db.prepare("SELECT status,is_deleted FROM documents WHERE id=?").bind(Number(proposal.target_id)).first<{ status: string; is_deleted: number }>();
        if (doc) {
          if (proposal.action_type === "VOID" && doc.status === "EXPIRED_VOID") { verified = true; formalState = "文档已作废"; }
          else if (proposal.action_type === "DELETE" && Number(doc.is_deleted) === 1) { verified = true; formalState = "文档已删除"; }
          else formalState = `当前状态：${doc.status}${Number(doc.is_deleted) ? "（已删除）" : ""}`;
        } else {
          formalState = "文档不存在";
        }
      }
      if (!verified) return ok({ verified: false, formalState }, rid);
      await db.batch([
        db.prepare("UPDATE agent_action_confirmations SET status='EXECUTED',executed_at=CURRENT_TIMESTAMP WHERE id=?").bind(id),
        db.prepare("UPDATE agent_workflow_runs SET status='SUCCEEDED',summary=?,stop_reason='HIGH_RISK_APPROVED_VERIFIED',finished_at=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(`正式动作已完成并复核通过（${formalState}）。`, Number(confirmation.run_id)),
        db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'AGENT_CONFIRMATION_VERIFIED',?,?,?,?)").bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `复核确认 #${id}：${formalState}`, rid),
      ]);
      return ok({ verified: true, formalState, runStatus: "SUCCEEDED" }, rid);
    }

    throw new ApiError(400, "ACTION_INVALID", "不支持的操作");
  } catch (error) { return fail(error, rid); }
}
