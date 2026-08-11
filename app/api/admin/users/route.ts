import { getD1 } from "../../../../db";
import { hasPermission, requireApiUser, type AuthContext } from "../../../../lib/authz";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";
import { APPROVAL_DUTIES } from "../../../../lib/approval-routing";
import { notifyUser } from "../../../../lib/notifications";

function approvalDuties(value:unknown){const values=Array.isArray(value)?value:String(value??"").split(",");return [...new Set(values.map(item=>safeText(item,40).toUpperCase()).filter((item):item is typeof APPROVAL_DUTIES[number]=>APPROVAL_DUTIES.includes(item as typeof APPROVAL_DUTIES[number])))];}

type AssignableRole = {
  id: number;
  code: string;
  scope: string;
  canGovern: number;
};

async function findAssignableRole(code: string): Promise<AssignableRole> {
  const role = await getD1().prepare(`SELECT r.id,r.code,r.scope,
    EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
      WHERE rp.role_id=r.id AND p.code='governance:admin') canGovern
    FROM roles r WHERE r.code=?`).bind(code).first<AssignableRole>();
  if (!role) throw new ApiError(400, "ROLE_NOT_FOUND", "所选角色不存在或已被删除，请重新选择");
  return role;
}

async function assertDepartmentExists(id: number) {
  const department = await getD1().prepare("SELECT id FROM departments WHERE id=? AND is_active=1").bind(id).first();
  if (!department) throw new ApiError(400, "DEPARTMENT_NOT_FOUND", "所选部门不存在或已停用，请重新选择");
}

function requireAccountAdmin(ctx: AuthContext) {
  if (!hasPermission(ctx, "system:accounts")) throw new ApiError(403, "ADMIN_REQUIRED", "当前角色没有成员与权限管理能力");
}

export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); requireAccountAdmin(ctx); const db = getD1();
    const [users, departments] = await Promise.all([
      db.prepare(`SELECT u.id,u.email,u.display_name,u.status,u.identity_provider,u.last_login_time,u.create_time,
        COALESCE((SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id ORDER BY CASE r.code WHEN 'SUPER_ADMIN' THEN 1 WHEN 'DEPT_ADMIN' THEN 2 ELSE 3 END LIMIT 1),'UNASSIGNED') role,
        COALESCE((SELECT group_concat(d.name, '、') FROM user_departments ud JOIN departments d ON d.id=ud.dept_id WHERE ud.user_id=u.id),'待分配') departments,
        COALESCE((SELECT group_concat(ad.duty_code, ',') FROM approval_duties ad WHERE ad.user_id=u.id AND ad.is_active=1),'') approval_duties,
        COALESCE((SELECT group_concat(DISTINCT p.code) FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id AND p.code IN ('governance:department_review','governance:business_review','governance:enterprise_review','governance:compliance_review','governance:emergency_publish')),'') approval_capabilities,
        COALESCE((SELECT ud.dept_id FROM user_departments ud WHERE ud.user_id=u.id AND ud.is_primary=1 LIMIT 1),0) primary_dept_id,
        (SELECT COUNT(*) FROM documents d WHERE d.is_deleted=0 AND COALESCE(d.owner_user_id,d.create_user_id)=u.id) owned_document_count,
        (SELECT COUNT(*) FROM knowledge_governance_tasks t WHERE t.assignee_user_id=u.id AND t.status IN ('OPEN','IN_PROGRESS')) open_task_count,
        EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id AND p.code='knowledge:edit') can_edit
        FROM users u WHERE u.email NOT LIKE '%@demo.invalid' AND u.email NOT LIKE '%@local.invalid' ORDER BY CASE u.status WHEN 'PENDING' THEN 1 WHEN 'ACTIVE' THEN 2 ELSE 3 END,u.update_time DESC`).all(),
      db.prepare("SELECT id,code,name FROM departments WHERE is_active=1 ORDER BY id").all(),
    ]);
    return ok({ users: users.results, departments: departments.results }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); requireAccountAdmin(ctx); const payload = await request.json() as Record<string, unknown>;
    if (Array.isArray(payload.members)) {
      const members=(payload.members as Record<string,unknown>[]).slice(0,500);if(!members.length)throw new ApiError(400,"VALIDATION_ERROR","导入名单不能为空");
      const db=getD1();const departments=await db.prepare("SELECT id,code FROM departments WHERE is_active=1").all<{id:number;code:string}>();const deptMap=new Map(departments.results.flatMap(row=>[[String(row.id),row.id],[row.code.toUpperCase(),row.id]]));const roles=await db.prepare(`SELECT r.id,r.code,r.scope,EXISTS(SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id AND p.code='governance:admin') canGovern FROM roles r`).all<AssignableRole>();const roleMap=new Map(roles.results.map(row=>[row.code,row]));
      const normalized=members.map((member,index)=>{const email=safeText(member.email,200).toLowerCase(),displayName=safeText(member.displayName,80),role=safeText(member.role||"EMPLOYEE",30).toUpperCase(),deptKey=safeText(member.deptCode??member.deptId,40).toUpperCase(),deptId=deptMap.get(deptKey),roleRow=roleMap.get(role);if(!/^\S+@\S+\.\S+$/.test(email)||!displayName)throw new ApiError(400,"IMPORT_VALIDATION_ERROR",`第 ${index+1} 行姓名或企业邮箱格式不正确`);if(!deptId)throw new ApiError(400,"IMPORT_DEPARTMENT_NOT_FOUND",`第 ${index+1} 行部门编码不存在或已停用`);if(!roleRow)throw new ApiError(400,"IMPORT_ROLE_NOT_FOUND",`第 ${index+1} 行角色编码不存在`);return{email,displayName,role,deptId,roleId:roleRow.id,isDeptAdmin:Boolean(roleRow.canGovern)&&roleRow.scope!=="global"};});
      if(new Set(normalized.map(item=>item.email)).size!==normalized.length)throw new ApiError(400,"IMPORT_DUPLICATE","导入名单中存在重复邮箱");const existing=await db.prepare(`SELECT email FROM users WHERE email IN (${normalized.map(()=>"?").join(",")})`).bind(...normalized.map(item=>item.email)).all<{email:string}>();if(existing.results.length)throw new ApiError(409,"ACCOUNT_EXISTS",`以下成员已存在：${existing.results.map(item=>item.email).join("、")}`);
      const statements=[];for(const member of normalized){const id=crypto.getRandomValues(new Uint32Array(1))[0];statements.push(db.prepare("INSERT INTO users(id,email,display_name,status,identity_provider,activated_by) VALUES(?,?,?,'ACTIVE','DIRECTORY_IMPORT',?)").bind(id,member.email,member.displayName,ctx.userId),db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)").bind(id,member.roleId),db.prepare("INSERT INTO user_departments(user_id,dept_id,is_primary,is_dept_admin) VALUES(?,?,1,?)").bind(id,member.deptId,member.isDeptAdmin?1:0),db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'ACCOUNT_IMPORT',?,?,?,?)").bind(member.deptId,ctx.userId,ctx.displayName,`导入成员 ${member.email}，角色 ${member.role}`,rid));}
      await db.batch(statements);return ok({imported:normalized.length},rid,201);
    }
    const email = safeText(payload.email, 200).toLowerCase(); const displayName = safeText(payload.displayName, 80); const deptId = Number(payload.deptId); const role = safeText(payload.role, 30).toUpperCase();const duties=approvalDuties(payload.approvalDuties);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, "EMAIL_INVALID", "请输入有效的企业邮箱");
    if (!displayName) throw new ApiError(400, "DISPLAY_NAME_REQUIRED", "请输入员工姓名");
    if (!deptId) throw new ApiError(400, "DEPARTMENT_REQUIRED", "请选择主部门");
    if (!role) throw new ApiError(400, "ROLE_REQUIRED", "请选择角色");
    const db = getD1(); const existing = await db.prepare("SELECT id FROM users WHERE email=?").bind(email).first<{id:number}>();
    if (existing) throw new ApiError(409, "ACCOUNT_EXISTS", "该企业邮箱已存在");
    await assertDepartmentExists(deptId);
    const roleRow = await findAssignableRole(role);
    const created = await db.prepare("INSERT INTO users(email,display_name,status,identity_provider,activated_by) VALUES(?,?,'ACTIVE','CHATGPT',?)").bind(email, displayName, ctx.userId).run(); const userId = Number(created.meta.last_row_id);
    await db.batch([
      db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)").bind(userId, roleRow.id),
      db.prepare("INSERT INTO user_departments(user_id,dept_id,is_primary,is_dept_admin) VALUES(?,?,1,?)").bind(userId, deptId, roleRow.canGovern && roleRow.scope !== "global" ? 1 : 0),
      db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'ACCOUNT_CREATE',?,?,?,?)").bind(deptId,ctx.userId,ctx.displayName,`添加成员 ${email}，角色 ${role}`,rid),
      ...duties.map(duty=>db.prepare("INSERT INTO approval_duties(user_id,dept_id,duty_code,create_user_id) VALUES(?,?,?,?)").bind(userId,["ENTERPRISE_REVIEWER","COMPLIANCE_REVIEWER","EMERGENCY_PUBLISHER"].includes(duty)?null:deptId,duty,ctx.userId)),
    ]);
    return ok({ id:userId }, rid, 201);
  } catch (error) { return fail(error, rid); }
}

export async function PATCH(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); requireAccountAdmin(ctx); const payload = await request.json() as Record<string, unknown>; const id = Number(payload.id);
    if(payload.approvalOnly===true){if(!id||id===ctx.userId)throw new ApiError(400,"SELF_UPDATE_FORBIDDEN",id===ctx.userId?"不能在当前会话中修改自己的审批岗位":"账号ID无效");const duties=approvalDuties(payload.approvalDuties),deptId=Number(payload.deptId),db=getD1(),target=await db.prepare("SELECT email FROM users WHERE id=? AND status='ACTIVE'").bind(id).first<{email:string}>();if(!target)throw new ApiError(404,"ACCOUNT_NOT_FOUND","有效账号不存在");if(!deptId)throw new ApiError(400,"DEPARTMENT_REQUIRED","请选择审批岗位所属部门");await assertDepartmentExists(deptId);const permissions=await db.prepare("SELECT DISTINCT p.code FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=?").bind(id).all<{code:string}>(),codes=new Set(permissions.results.map(item=>item.code)),required:Record<string,string>={DEPT_REVIEWER:"governance:department_review",BUSINESS_REVIEWER:"governance:business_review",ENTERPRISE_REVIEWER:"governance:enterprise_review",COMPLIANCE_REVIEWER:"governance:compliance_review",EMERGENCY_PUBLISHER:"governance:emergency_publish"};if(duties.some(duty=>!codes.has(required[duty])))throw new ApiError(400,"APPROVAL_CAPABILITY_REQUIRED","成员角色尚未获得对应审批能力，请先配置角色权限");await db.batch([db.prepare("DELETE FROM approval_duties WHERE user_id=?").bind(id),...duties.map(duty=>db.prepare("INSERT INTO approval_duties(user_id,dept_id,duty_code,create_user_id) VALUES(?,?,?,?)").bind(id,["ENTERPRISE_REVIEWER","COMPLIANCE_REVIEWER","EMERGENCY_PUBLISHER"].includes(duty)?null:deptId,duty,ctx.userId)),db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'APPROVAL_DUTY_UPDATE',?,?,?,?)").bind(deptId,ctx.userId,ctx.displayName,`配置 ${target.email} 审批岗位：${duties.join("、")||"无"}`,rid)]);return ok({updated:true,duties},rid);}
    const status = safeText(payload.status, 20); const role = safeText(payload.role, 30).toUpperCase(); const deptId = Number(payload.deptId); const displayName = safeText(payload.displayName, 80);
    if (!id || id === ctx.userId) throw new ApiError(400,"SELF_UPDATE_FORBIDDEN",id === ctx.userId ? "不能在当前会话中修改自己的权限或状态" : "账号ID无效");
    if (!["ACTIVE","DISABLED","OFFBOARDED"].includes(status)) throw new ApiError(400,"STATUS_INVALID","账号状态无效");
    if (!deptId) throw new ApiError(400,"DEPARTMENT_REQUIRED","请选择主部门");
    if (!role) throw new ApiError(400,"ROLE_REQUIRED","请选择角色");
    if (!displayName) throw new ApiError(400,"DISPLAY_NAME_REQUIRED","请输入员工姓名");
    const db = getD1(); const target = await db.prepare("SELECT u.email,u.display_name,COALESCE((SELECT ud.dept_id FROM user_departments ud WHERE ud.user_id=u.id AND ud.is_primary=1 LIMIT 1),0) dept_id FROM users u WHERE u.id=?").bind(id).first<{email:string;display_name:string;dept_id:number}>(); if (!target) throw new ApiError(404,"ACCOUNT_NOT_FOUND","账号不存在");
    await assertDepartmentExists(deptId);
    const roleRow = await findAssignableRole(role);
    const responsibility=await db.prepare(`SELECT
      (SELECT COUNT(*) FROM documents d WHERE d.is_deleted=0 AND COALESCE(d.owner_user_id,d.create_user_id)=?) documents,
      (SELECT COUNT(*) FROM knowledge_governance_tasks t WHERE t.assignee_user_id=? AND t.status IN ('OPEN','IN_PROGRESS')) tasks`).bind(id,id).first<{documents:number;tasks:number}>();
    const mustTransfer=(status!=="ACTIVE"||deptId!==Number(target.dept_id))&&(Number(responsibility?.documents||0)>0||Number(responsibility?.tasks||0)>0);
    const successorId=Number(payload.successorUserId),transferReason=safeText(payload.transferReason,500);let successor:{id:number;display_name:string}|null=null;
    if(mustTransfer){if(!successorId)throw new ApiError(409,"RESPONSIBILITY_TRANSFER_REQUIRED",`该成员仍负责 ${Number(responsibility?.documents||0)} 份资料和 ${Number(responsibility?.tasks||0)} 个未完成任务，请先选择继任人`);if(transferReason.length<2)throw new ApiError(400,"TRANSFER_REASON_REQUIRED","请填写责任转交原因");successor=await db.prepare(`SELECT u.id,u.display_name FROM users u JOIN user_departments ud ON ud.user_id=u.id AND ud.dept_id=? WHERE u.id=? AND u.id<>? AND u.status='ACTIVE' AND EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=u.id AND p.code='knowledge:edit')`).bind(target.dept_id,successorId,id).first<{id:number;display_name:string}>();if(!successor)throw new ApiError(409,"SUCCESSOR_NOT_ELIGIBLE","继任人必须是原资料所属部门的在职成员，并具备资料编辑权限");}
    const owned=successor?await db.prepare("SELECT id,dept_id,title FROM documents WHERE is_deleted=0 AND COALESCE(owner_user_id,create_user_id)=?").bind(id).all<{id:number;dept_id:number;title:string}>():{results:[]};
    await db.batch([
      ...owned.results.flatMap(document=>[
        db.prepare("UPDATE documents SET owner_user_id=?,owner=?,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(successor!.id,successor!.display_name,document.id),
        db.prepare("INSERT INTO audit_logs(document_id,dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,?,'OWNER_TRANSFER',?,?,?,?)").bind(document.id,document.dept_id,ctx.userId,ctx.displayName,`${target.display_name} → ${successor!.display_name}；范围：成员变动批量转交；原因：${transferReason}`,rid),
      ]),
      ...(successor?[db.prepare("UPDATE knowledge_governance_tasks SET assignee_user_id=?,workflow_stage=CASE WHEN workflow_stage='OWNER_REVISING' THEN 'WAITING_OWNER' ELSE workflow_stage END,update_time=CURRENT_TIMESTAMP WHERE assignee_user_id=? AND status IN ('OPEN','IN_PROGRESS')").bind(successor.id,id)]:[]),
      db.prepare("UPDATE users SET display_name=?,status=?,activated_by=CASE WHEN ?='ACTIVE' THEN ? ELSE activated_by END,disabled_time=CASE WHEN ?='ACTIVE' THEN NULL ELSE CURRENT_TIMESTAMP END,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(displayName,status,status,ctx.userId,status,id),
      db.prepare("DELETE FROM user_roles WHERE user_id=?").bind(id), db.prepare("DELETE FROM user_departments WHERE user_id=?").bind(id),
      db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)").bind(id,roleRow.id),
      db.prepare("INSERT INTO user_departments(user_id,dept_id,is_primary,is_dept_admin) VALUES(?,?,1,?)").bind(id,deptId,roleRow.canGovern && roleRow.scope !== "global" ? 1 : 0),
      db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'ACCOUNT_UPDATE',?,?,?,?)").bind(deptId,ctx.userId,ctx.displayName,`更新账号 ${target.email}：${status}/${role}${successor?`；责任转交给 ${successor.display_name}（${Number(responsibility?.documents||0)} 份资料、${Number(responsibility?.tasks||0)} 个任务）`:''}`,rid),
    ]);
    if(successor)await notifyUser({userId:successor.id,type:"OWNER_TRANSFER",title:"成员变动责任已批量转交给你",content:`${target.display_name} 负责的 ${Number(responsibility?.documents||0)} 份资料和 ${Number(responsibility?.tasks||0)} 个未完成任务已转交给你。原因：${transferReason}`,requestId:rid,email:true});
    return ok({ updated:true,transferred:successor?{documents:Number(responsibility?.documents||0),tasks:Number(responsibility?.tasks||0),successor:successor.display_name}:null },rid);
  } catch (error) { return fail(error,rid); }
}
