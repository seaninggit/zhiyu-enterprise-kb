import { getD1 } from "../../../../db";
import { requireApiUser } from "../../../../lib/authz";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";

function requireSuper(role: string) {
  if (role !== "SUPER_ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "仅超级管理员可管理企业账号");
}

export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); requireSuper(ctx.role); const db = getD1();
    const [users, departments] = await Promise.all([
      db.prepare(`SELECT u.id,u.email,u.display_name,u.status,u.identity_provider,u.last_login_time,u.create_time,
        COALESCE((SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id ORDER BY CASE r.code WHEN 'SUPER_ADMIN' THEN 1 WHEN 'DEPT_ADMIN' THEN 2 ELSE 3 END LIMIT 1),'UNASSIGNED') role,
        COALESCE((SELECT group_concat(d.name, '、') FROM user_departments ud JOIN departments d ON d.id=ud.dept_id WHERE ud.user_id=u.id),'待分配') departments,
        COALESCE((SELECT ud.dept_id FROM user_departments ud WHERE ud.user_id=u.id AND ud.is_primary=1 LIMIT 1),0) primary_dept_id
        FROM users u WHERE u.email NOT LIKE '%@demo.invalid' AND u.email NOT LIKE '%@local.invalid' ORDER BY CASE u.status WHEN 'PENDING' THEN 1 WHEN 'ACTIVE' THEN 2 ELSE 3 END,u.update_time DESC`).all(),
      db.prepare("SELECT id,code,name FROM departments WHERE is_active=1 ORDER BY id").all(),
    ]);
    return ok({ users: users.results, departments: departments.results }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); requireSuper(ctx.role); const payload = await request.json() as Record<string, unknown>;
    if (Array.isArray(payload.members)) {
      const members=(payload.members as Record<string,unknown>[]).slice(0,500);if(!members.length)throw new ApiError(400,"VALIDATION_ERROR","导入名单不能为空");
      const db=getD1();const departments=await db.prepare("SELECT id,code FROM departments WHERE is_active=1").all<{id:number;code:string}>();const deptMap=new Map(departments.results.flatMap(row=>[[String(row.id),row.id],[row.code.toUpperCase(),row.id]]));const roles=await db.prepare("SELECT id,code FROM roles").all<{id:number;code:string}>();const roleMap=new Map(roles.results.map(row=>[row.code,row.id]));
      const normalized=members.map((member,index)=>{const email=safeText(member.email,200).toLowerCase(),displayName=safeText(member.displayName,80),role=safeText(member.role||"EMPLOYEE",30).toUpperCase(),deptKey=safeText(member.deptCode??member.deptId,40).toUpperCase(),deptId=deptMap.get(deptKey),roleId=roleMap.get(role);if(!/^\S+@\S+\.\S+$/.test(email)||!displayName||!deptId||!roleId||!["SUPER_ADMIN","DEPT_ADMIN","EMPLOYEE"].includes(role))throw new ApiError(400,"IMPORT_VALIDATION_ERROR",`第 ${index+1} 行信息有误，请检查姓名、邮箱、部门编码和角色`);return{email,displayName,role,deptId,roleId};});
      if(new Set(normalized.map(item=>item.email)).size!==normalized.length)throw new ApiError(400,"IMPORT_DUPLICATE","导入名单中存在重复邮箱");const existing=await db.prepare(`SELECT email FROM users WHERE email IN (${normalized.map(()=>"?").join(",")})`).bind(...normalized.map(item=>item.email)).all<{email:string}>();if(existing.results.length)throw new ApiError(409,"ACCOUNT_EXISTS",`以下成员已存在：${existing.results.map(item=>item.email).join("、")}`);
      const statements=[];for(const member of normalized){const id=crypto.getRandomValues(new Uint32Array(1))[0];statements.push(db.prepare("INSERT INTO users(id,email,display_name,status,identity_provider,activated_by) VALUES(?,?,?,'ACTIVE','DIRECTORY_IMPORT',?)").bind(id,member.email,member.displayName,ctx.userId),db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)").bind(id,member.roleId),db.prepare("INSERT INTO user_departments(user_id,dept_id,is_primary,is_dept_admin) VALUES(?,?,1,?)").bind(id,member.deptId,member.role==="DEPT_ADMIN"?1:0),db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'ACCOUNT_IMPORT',?,?,?,?)").bind(member.deptId,ctx.userId,ctx.displayName,`导入成员 ${member.email}，角色 ${member.role}`,rid));}
      await db.batch(statements);return ok({imported:normalized.length},rid,201);
    }
    const email = safeText(payload.email, 200).toLowerCase(); const displayName = safeText(payload.displayName, 80); const deptId = Number(payload.deptId); const role = safeText(payload.role, 30);
    if (!/^\S+@\S+\.\S+$/.test(email) || !displayName || !deptId || !["SUPER_ADMIN","DEPT_ADMIN","EMPLOYEE"].includes(role)) throw new ApiError(400, "VALIDATION_ERROR", "请完整填写企业邮箱、姓名、部门与角色");
    const db = getD1(); const existing = await db.prepare("SELECT id FROM users WHERE email=?").bind(email).first<{id:number}>();
    if (existing) throw new ApiError(409, "ACCOUNT_EXISTS", "该企业邮箱已存在");
    const created = await db.prepare("INSERT INTO users(email,display_name,status,identity_provider,activated_by) VALUES(?,?,'ACTIVE','CHATGPT',?)").bind(email, displayName, ctx.userId).run(); const userId = Number(created.meta.last_row_id);
    const roleRow = await db.prepare("SELECT id FROM roles WHERE code=?").bind(role).first<{id:number}>(); if (!roleRow) throw new ApiError(400, "ROLE_NOT_FOUND", "角色不存在");
    await db.batch([
      db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)").bind(userId, roleRow.id),
      db.prepare("INSERT INTO user_departments(user_id,dept_id,is_primary,is_dept_admin) VALUES(?,?,1,?)").bind(userId, deptId, role === "DEPT_ADMIN" ? 1 : 0),
      db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'ACCOUNT_CREATE',?,?,?,?)").bind(deptId,ctx.userId,ctx.displayName,`添加成员 ${email}，角色 ${role}`,rid),
    ]);
    return ok({ id:userId }, rid, 201);
  } catch (error) { return fail(error, rid); }
}

export async function PATCH(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser(); requireSuper(ctx.role); const payload = await request.json() as Record<string, unknown>; const id = Number(payload.id);
    const status = safeText(payload.status, 20); const role = safeText(payload.role, 30); const deptId = Number(payload.deptId); const displayName = safeText(payload.displayName, 80);
    if (!id || id === ctx.userId || !["ACTIVE","DISABLED","OFFBOARDED"].includes(status) || !["SUPER_ADMIN","DEPT_ADMIN","EMPLOYEE"].includes(role) || !deptId || !displayName) throw new ApiError(400,"VALIDATION_ERROR",id === ctx.userId ? "不能在当前会话中修改自己的权限或状态" : "账号配置不完整");
    const db = getD1(); const target = await db.prepare("SELECT email FROM users WHERE id=?").bind(id).first<{email:string}>(); if (!target) throw new ApiError(404,"ACCOUNT_NOT_FOUND","账号不存在");
    const roleRow = await db.prepare("SELECT id FROM roles WHERE code=?").bind(role).first<{id:number}>(); if (!roleRow) throw new ApiError(400,"ROLE_NOT_FOUND","角色不存在");
    await db.batch([
      db.prepare("UPDATE users SET display_name=?,status=?,activated_by=CASE WHEN ?='ACTIVE' THEN ? ELSE activated_by END,disabled_time=CASE WHEN ?='ACTIVE' THEN NULL ELSE CURRENT_TIMESTAMP END,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(displayName,status,status,ctx.userId,status,id),
      db.prepare("DELETE FROM user_roles WHERE user_id=?").bind(id), db.prepare("DELETE FROM user_departments WHERE user_id=?").bind(id),
      db.prepare("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)").bind(id,roleRow.id),
      db.prepare("INSERT INTO user_departments(user_id,dept_id,is_primary,is_dept_admin) VALUES(?,?,1,?)").bind(id,deptId,role === "DEPT_ADMIN" ? 1 : 0),
      db.prepare("INSERT INTO audit_logs(dept_id,action,actor_user_id,actor,detail,request_id) VALUES(?,'ACCOUNT_UPDATE',?,?,?,?)").bind(deptId,ctx.userId,ctx.displayName,`更新账号 ${target.email}：${status}/${role}`,rid),
    ]);
    return ok({ updated:true },rid);
  } catch (error) { return fail(error,rid); }
}
