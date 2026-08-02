import { and, eq } from "drizzle-orm";
import { getChatGPTUser, isPublicViewerEmail } from "../app/chatgpt-auth";
import { getDb, getD1 } from "../db";
import { roles, userDepartments, userRoles, users } from "../db/schema";
import { ApiError } from "./api";

export type RoleCode = "SUPER_ADMIN" | "DEPT_ADMIN" | "EMPLOYEE";
export type AuthContext = { userId: number; email: string; displayName: string; role: RoleCode; deptIds: number[]; primaryDeptId: number; isPublicViewer: boolean };

async function ensureIdentityRecord(email: string, displayName: string) {
  const db = getDb();
  const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (found.length) return;
  const d1 = getD1();
  if (isPublicViewerEmail(email)) {
    await d1.batch([
      d1.prepare("INSERT OR IGNORE INTO users(email,display_name,status,identity_provider) VALUES(?,?,'ACTIVE','PUBLIC_ACCESS')").bind(email, displayName),
      d1.prepare("INSERT OR IGNORE INTO user_roles(user_id,role_id) SELECT u.id,r.id FROM users u CROSS JOIN roles r WHERE u.email=? AND r.code='EMPLOYEE'").bind(email),
      d1.prepare("INSERT OR IGNORE INTO user_departments(user_id,dept_id,is_primary,is_dept_admin) SELECT u.id,d.id,CASE WHEN d.code='GENERAL' THEN 1 ELSE 0 END,0 FROM users u CROSS JOIN departments d WHERE u.email=? AND d.is_active=1").bind(email),
    ]);
    return;
  }
  await d1.batch([
    d1.prepare("INSERT OR IGNORE INTO departments(id, code, name, is_active) VALUES(1, 'GENERAL', '综合管理部', 1)"),
    d1.prepare("INSERT OR IGNORE INTO roles(id, code, name, description) VALUES(1, 'SUPER_ADMIN', '超级管理员', '全局知识治理')"),
    d1.prepare("INSERT OR IGNORE INTO roles(id, code, name, description) VALUES(2, 'DEPT_ADMIN', '部门管理员', '本部门知识治理')"),
    d1.prepare("INSERT OR IGNORE INTO roles(id, code, name, description) VALUES(3, 'EMPLOYEE', '普通员工', '知识生产与使用')"),
    d1.prepare("INSERT INTO users(email, display_name, status, identity_provider) VALUES(?, ?, 'PENDING', 'CHATGPT')").bind(email, displayName),
  ]);
}

export async function requireApiUser(): Promise<AuthContext> {
  const identity = await getChatGPTUser();
  if (!identity) throw new ApiError(401, "UNAUTHENTICATED", "请先登录");
  await ensureIdentityRecord(identity.email, identity.displayName);
  const db = getDb();
  const [account] = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
  if (!account) throw new ApiError(500, "USER_BOOTSTRAP_FAILED", "身份记录初始化失败");
  if (account.status === "PENDING") throw new ApiError(403, "ACCOUNT_PENDING", "账号已识别，等待企业管理员分配部门与角色");
  if (account.status !== "ACTIVE") throw new ApiError(403, "ACCOUNT_DISABLED", "账号已停用或离职，无法访问企业知识库");
  await getD1().prepare("UPDATE users SET display_name=?,last_login_time=CURRENT_TIMESTAMP,update_time=CURRENT_TIMESTAMP WHERE id=?").bind(identity.displayName, account.id).run();
  const [user] = await db.select().from(users).where(and(eq(users.email, identity.email), eq(users.status, "ACTIVE"))).limit(1);
  if (!user) throw new ApiError(403, "ACCOUNT_DISABLED", "账号不可用");
  const [roleRows, deptRows] = await Promise.all([
    db.select({ code: roles.code }).from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id)).where(eq(userRoles.userId, user.id)),
    db.select({ deptId: userDepartments.deptId, isPrimary: userDepartments.isPrimary, isDeptAdmin: userDepartments.isDeptAdmin }).from(userDepartments).where(eq(userDepartments.userId, user.id)),
  ]);
  const role = (roleRows.some(r => r.code === "SUPER_ADMIN") ? "SUPER_ADMIN" : roleRows.some(r => r.code === "DEPT_ADMIN") || deptRows.some(d => d.isDeptAdmin) ? "DEPT_ADMIN" : "EMPLOYEE") as RoleCode;
  const primary = deptRows.find(d => d.isPrimary)?.deptId ?? deptRows[0]?.deptId;
  if (!primary) throw new ApiError(403, "NO_DEPARTMENT", "账号未分配部门");
  return { userId: user.id, email: user.email, displayName: user.displayName, role, deptIds: deptRows.map(d => d.deptId), primaryDeptId: primary, isPublicViewer: isPublicViewerEmail(user.email) };
}

export function canManageDepartment(ctx: AuthContext, deptId: number) { return ctx.role === "SUPER_ADMIN" || (ctx.role === "DEPT_ADMIN" && ctx.deptIds.includes(deptId)); }
export function assertDepartment(ctx: AuthContext, deptId: number) { if (!canManageDepartment(ctx, deptId) && !ctx.deptIds.includes(deptId)) throw new ApiError(403, "DEPARTMENT_FORBIDDEN", "无权访问该部门数据"); }

export async function enforceRateLimit(ctx: AuthContext, action: string, limit: number, seconds: number) {
  const now = Math.floor(Date.now() / 1000); const reset = now + seconds; const db = getD1(); const bucket = `${action}:${Math.floor(now / seconds)}`;
  await db.prepare("INSERT INTO rate_limits(subject,bucket,count,reset_at) VALUES(?,?,1,?) ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1").bind(String(ctx.userId), bucket, reset).run();
  const row = await db.prepare("SELECT count FROM rate_limits WHERE subject=? AND bucket=?").bind(String(ctx.userId), bucket).first<{ count: number }>();
  if (Number(row?.count ?? 0) > limit) throw new ApiError(429, "RATE_LIMITED", "操作过于频繁，请稍后再试");
}
