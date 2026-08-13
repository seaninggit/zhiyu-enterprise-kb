import {getD1} from "../../../../db";
import {ApiError,fail,ok,requestId,safeText} from "../../../../lib/api";
import {hasPermission,requireApiUser} from "../../../../lib/authz";
import {documentListScope} from "../../../../lib/document-access";

const statusMap:Record<string,string>={draft:"DRAFT",review:"PENDING_DEPT_REVIEW",published:"ARCHIVED_ACTIVE",archived:"EXPIRED_VOID"};
export async function GET(request:Request){const rid=requestId(request);try{
  const ctx=await requireApiUser(),url=new URL(request.url),mode=url.searchParams.get("mode")||"mine";
  if(mode==="manage"&&!['governance:admin','governance:department_review','governance:business_review','governance:enterprise_review','governance:compliance_review','page:approval_pending','page:approval_history','page:document_admin','page:lifecycle_governance'].some(permission=>hasPermission(ctx,permission)))throw new ApiError(403,"FORBIDDEN","无权访问管理资料列表");
  const page=Math.max(1,Number(url.searchParams.get("page"))||1),pageSize=Math.min(100,Math.max(5,Number(url.searchParams.get("pageSize"))||15));
  const access=documentListScope(ctx,"d"),where=[access.sql],binds:unknown[]=[...access.binds];
  if(mode==="mine"){where.push("(d.create_user_id=? OR COALESCE(d.owner_user_id,d.create_user_id)=?)");binds.push(ctx.userId,ctx.userId);}
  if(mode==="manage"&&ctx.scope!=="global"){where.push(`d.dept_id IN (${ctx.deptIds.map(()=>"?").join(",")})`);binds.push(...ctx.deptIds);}
  const optionClause=where.join(" AND "),optionBinds=[...binds];
  if(url.searchParams.get("lifecycle")==="1")where.push("d.status IN ('ARCHIVED_ACTIVE','EXPIRED_VOID') AND (d.status='EXPIRED_VOID' OR d.review_due_at IS NOT NULL)");
  const lifecycleStage=safeText(url.searchParams.get("lifecycleStage"),30);
  if(lifecycleStage==="overdue")where.push("d.status<>'EXPIRED_VOID' AND date(d.review_due_at)<date('now')");
  if(lifecycleStage==="dueSoon")where.push("d.status<>'EXPIRED_VOID' AND date(d.review_due_at) BETWEEN date('now') AND date('now','+30 day')");
  if(lifecycleStage==="scheduled")where.push("d.status<>'EXPIRED_VOID' AND date(d.review_due_at)>date('now','+30 day')");
  if(lifecycleStage==="voided")where.push("d.status='EXPIRED_VOID'");
  if(url.searchParams.get("approvalHistory")==="1")where.push("EXISTS(SELECT 1 FROM approval_records ah WHERE ah.document_id=d.id)");
  const approvalAction=safeText(url.searchParams.get("approvalAction"),30);if(approvalAction){where.push("EXISTS(SELECT 1 FROM approval_records aa WHERE aa.document_id=d.id AND aa.action=?)");binds.push(approvalAction);}
  const status=safeText(url.searchParams.get("status"),30);if(status==="rejected")where.push("d.status='DRAFT' AND EXISTS(SELECT 1 FROM approval_records ar WHERE ar.document_id=d.id AND ar.action='REJECT')");else if(status==="supplement")where.push("EXISTS(SELECT 1 FROM knowledge_governance_tasks gt WHERE gt.source_document_id=d.id AND gt.status IN ('OPEN','IN_PROGRESS'))");else if(statusMap[status]){where.push("d.status=?");binds.push(statusMap[status]);}
  if(url.searchParams.get("approvalForMe")==="1"){where.push("EXISTS(SELECT 1 FROM approval_instances ai JOIN approval_steps aps ON aps.instance_id=ai.id WHERE ai.document_id=d.id AND ai.status='PENDING' AND aps.status='PENDING' AND aps.assignee_user_id=?)");binds.push(ctx.userId);}
  if(url.searchParams.get("approvalSubmittedByMe")==="1"){where.push("EXISTS(SELECT 1 FROM approval_instances ai WHERE ai.document_id=d.id AND ai.submitted_by=?)");binds.push(ctx.userId);}
  if(url.searchParams.get("approvalProcessedByMe")==="1"){where.push("EXISTS(SELECT 1 FROM approval_steps aps JOIN approval_instances ai ON ai.id=aps.instance_id WHERE ai.document_id=d.id AND aps.action_user_id=? AND aps.status IN ('APPROVED','REJECTED'))");binds.push(ctx.userId);}
  const category=safeText(url.searchParams.get("category"),80);if(category){where.push("d.category=?");binds.push(category);}
  const deptId=Number(url.searchParams.get("deptId"));if(deptId){if(ctx.scope!=="global"&&!ctx.deptIds.includes(deptId))throw new ApiError(403,"DEPARTMENT_FORBIDDEN","无权筛选该部门");where.push("d.dept_id=?");binds.push(deptId);}
  const uploader=safeText(url.searchParams.get("uploader"),80);if(uploader){where.push("d.uploader=?");binds.push(uploader);}
  const keyword=safeText(url.searchParams.get("keyword"),120);if(keyword){where.push("(d.title LIKE ? OR d.source_name LIKE ? OR d.owner LIKE ? OR d.uploader LIKE ?)");binds.push(...Array(4).fill(`%${keyword}%`));}
  const from=safeText(url.searchParams.get("from"),20),to=safeText(url.searchParams.get("to"),20);if(from){where.push("date(d.create_time)>=date(?)");binds.push(from);}if(to){where.push("date(d.create_time)<=date(?)");binds.push(to);}
  const order=url.searchParams.get("order")==="created"?"d.create_time":"d.update_time",db=getD1(),clause=where.join(" AND ");
  const total=await db.prepare(`SELECT COUNT(*) count FROM documents d WHERE ${clause}`).bind(...binds).first<{count:number}>();
  const lifecycleSummary=url.searchParams.get("lifecycle")==="1"?await db.prepare(`SELECT
    COUNT(*) total,
    SUM(CASE WHEN d.status='EXPIRED_VOID' THEN 1 ELSE 0 END) voided,
    SUM(CASE WHEN d.status<>'EXPIRED_VOID' AND date(d.review_due_at)<date('now') THEN 1 ELSE 0 END) overdue,
    SUM(CASE WHEN d.status<>'EXPIRED_VOID' AND date(d.review_due_at) BETWEEN date('now') AND date('now','+30 day') THEN 1 ELSE 0 END) due_soon,
    SUM(CASE WHEN d.status<>'EXPIRED_VOID' AND date(d.review_due_at)>date('now','+30 day') THEN 1 ELSE 0 END) scheduled
    FROM documents d WHERE ${optionClause} AND d.status IN ('ARCHIVED_ACTIVE','EXPIRED_VOID') AND (d.status='EXPIRED_VOID' OR d.review_due_at IS NOT NULL)`).bind(...optionBinds).first():null;
  const filterOptions=mode==="manage"?(await db.prepare(`SELECT DISTINCT d.dept_id,dep.name department_name,d.category,d.uploader FROM documents d JOIN departments dep ON dep.id=d.dept_id WHERE ${optionClause} ORDER BY dep.name,d.category,d.uploader`).bind(...optionBinds).all()).results:[];
  const rows=await db.prepare(`SELECT d.*,u.display_name creator_name,dep.name department_name,
    (SELECT MAX(a.create_time) FROM approval_records a WHERE a.document_id=d.id AND a.action='SUBMIT') submitted_at,
    (SELECT MAX(a.create_time) FROM approval_records a WHERE a.document_id=d.id AND a.action='APPROVE') approved_at,
    (SELECT MAX(a.create_time) FROM approval_records a WHERE a.document_id=d.id AND a.action='REJECT') rejected_at,
    (SELECT a.action FROM approval_records a WHERE a.document_id=d.id ORDER BY a.id DESC LIMIT 1) latest_approval_action,
    (SELECT a.comment FROM approval_records a WHERE a.document_id=d.id ORDER BY a.id DESC LIMIT 1) latest_approval_comment,
    (SELECT au.display_name FROM approval_records a LEFT JOIN users au ON au.id=a.approver_user_id WHERE a.document_id=d.id ORDER BY a.id DESC LIMIT 1) latest_approver,
    (SELECT a.create_time FROM approval_records a WHERE a.document_id=d.id ORDER BY a.id DESC LIMIT 1) latest_approval_at,
    (SELECT au.display_name FROM approval_instances ai JOIN approval_steps aps ON aps.instance_id=ai.id JOIN users au ON au.id=aps.assignee_user_id WHERE ai.document_id=d.id AND ai.status='PENDING' AND aps.status='PENDING' ORDER BY ai.id DESC,aps.stage_no LIMIT 1) current_approver,
    (SELECT aps.duty_code FROM approval_instances ai JOIN approval_steps aps ON aps.instance_id=ai.id WHERE ai.document_id=d.id AND ai.status='PENDING' AND aps.status='PENDING' ORDER BY ai.id DESC,aps.stage_no LIMIT 1) current_approval_duty,
    (SELECT ai.route_type FROM approval_instances ai WHERE ai.document_id=d.id AND ai.status='PENDING' ORDER BY ai.id DESC LIMIT 1) approval_route_type,
    (SELECT ai.current_stage FROM approval_instances ai WHERE ai.document_id=d.id AND ai.status='PENDING' ORDER BY ai.id DESC LIMIT 1) approval_current_stage,
    (SELECT COUNT(*) FROM approval_instances ai JOIN approval_steps aps ON aps.instance_id=ai.id WHERE ai.document_id=d.id AND ai.status='PENDING') approval_total_stages,
    (SELECT COUNT(*) FROM feedback f WHERE f.document_id=d.id) feedback_count,
    (SELECT f.content FROM feedback f WHERE f.document_id=d.id ORDER BY f.id DESC LIMIT 1) latest_feedback,
    (SELECT f.create_time FROM feedback f WHERE f.document_id=d.id ORDER BY f.id DESC LIMIT 1) latest_feedback_at,
    (SELECT COUNT(*) FROM knowledge_governance_tasks t WHERE t.source_document_id=d.id AND t.status IN ('OPEN','IN_PROGRESS')) open_feedback_count,
    (SELECT t.workflow_stage FROM knowledge_governance_tasks t WHERE t.source_document_id=d.id AND t.status IN ('OPEN','IN_PROGRESS') ORDER BY t.update_time DESC,t.id DESC LIMIT 1) governance_stage
    FROM documents d JOIN users u ON u.id=d.create_user_id JOIN departments dep ON dep.id=d.dept_id WHERE ${clause} ORDER BY ${order} DESC,d.id DESC LIMIT ? OFFSET ?`).bind(...binds,pageSize,(page-1)*pageSize).all();
  return ok({documents:rows.results,filterOptions,lifecycleSummary,pagination:{page,pageSize,total:Number(total?.count||0),pages:Math.max(1,Math.ceil(Number(total?.count||0)/pageSize))}},rid);
}catch(error){return fail(error,rid);}}
