import { getD1 } from "../../../../db";
import { ApiError, fail, ok, requestId, safeText } from "../../../../lib/api";
import { hasPermission, requireApiUser } from "../../../../lib/authz";

export async function GET(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "system:accounts")) throw new ApiError(403, "FORBIDDEN", "无权管理角色");

    const db = getD1();
    const url = new URL(request.url);
    const tree = url.searchParams.get("tree") === "true";

    if (tree) {
      const perms = await db.prepare("SELECT id, code, name, parent_code, sort_order FROM permissions ORDER BY sort_order, id").all<{ id: number; code: string; name: string; parent_code: string | null; sort_order: number }>();
      return ok({ permissions: perms.results }, rid);
    }

    const allRoles = await db.prepare("SELECT id, code, name, description, scope, is_system FROM roles ORDER BY is_system DESC, id").all<{ id: number; code: string; name: string; description: string; scope: string; is_system: number }>();
    const rolePermMap: Record<number, string[]> = {};
    const allMappings = await db.prepare("SELECT rp.role_id, p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id").all<{ role_id: number; code: string }>();
    for (const m of allMappings.results) {
      if (!rolePermMap[m.role_id]) rolePermMap[m.role_id] = [];
      rolePermMap[m.role_id].push(m.code);
    }

    return ok({
      roles: allRoles.results.map(r => ({
        ...r,
        isSystem: r.is_system === 1,
        permissions: rolePermMap[r.id] || [],
      })),
    }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function POST(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "system:accounts")) throw new ApiError(403, "FORBIDDEN", "无权管理角色");

    const p = await request.json() as { action?: string; code?: string; name?: string; description?: string; scope?: string; permissionIds?: number[] };

    // 添加自定义权限
    if (p.action === "ADD_PERMISSION") {
      const db = getD1();
      const permCode = safeText(p.code, 40).toLowerCase().replace(/[^a-z0-9_:]/g, "_");
      const permName = safeText(p.name, 60);
      if (!permCode || !permName) throw new ApiError(400, "VALIDATION_ERROR", "权限编码和名称不能为空");
      const existing = await db.prepare("SELECT id FROM permissions WHERE code=?").bind(permCode).first();
      if (existing) throw new ApiError(409, "DUPLICATE", "权限编码已存在");
      const result = await db.prepare("INSERT INTO permissions(code, name, sort_order) VALUES(?,?,99)").bind(permCode, permName).run();
      await db.prepare("INSERT INTO audit_logs(dept_id, action, actor_user_id, actor, detail, request_id) VALUES(?,'ADD_PERMISSION',?,'Admin',?,?)").bind(ctx.primaryDeptId, ctx.userId, `添加自定义权限 ${permName}(${permCode})`, rid).run();
      return ok({ id: Number(result.meta.last_row_id), code: permCode, name: permName }, rid, 201);
    }

    const code = safeText(p.code, 30).toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    const name = safeText(p.name, 60);
    const description = safeText(p.description, 200);
    const scope = ["global", "department"].includes(String(p.scope)) ? String(p.scope) : "department";
    if (!code || !name) throw new ApiError(400, "VALIDATION_ERROR", "角色编码和名称不能为空");

    const db = getD1();
    const existing = await db.prepare("SELECT id FROM roles WHERE code=?").bind(code).first();
    if (existing) throw new ApiError(409, "DUPLICATE", "角色编码已存在");

    const result = await db.prepare("INSERT INTO roles(code, name, description, scope, is_system) VALUES(?,?,?,?,0)").bind(code, name, description, scope).run();
    const roleId = Number(result.meta.last_row_id);

    if (Array.isArray(p.permissionIds) && p.permissionIds.length) {
      for (const pid of p.permissionIds) {
        await db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, permission_id) VALUES(?,?)").bind(roleId, Number(pid)).run();
      }
    }

    await db.prepare("INSERT INTO audit_logs(dept_id, action, actor_user_id, actor, detail, request_id) VALUES(?, 'CREATE_ROLE', ?, ?, ?, ?)").bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `创建角色 ${name}(${code})`, rid).run();

    return ok({ id: roleId, code, name, scope }, rid, 201);
  } catch (error) { return fail(error, rid); }
}

export async function PATCH(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "system:accounts")) throw new ApiError(403, "FORBIDDEN", "无权管理角色");

    const p = await request.json() as { id?: number; name?: string; description?: string; scope?: string; permissionIds?: number[] };
    const id = Number(p.id);
    if (!id) throw new ApiError(400, "VALIDATION_ERROR", "角色ID不能为空");

    const db = getD1();
    const role = await db.prepare("SELECT id FROM roles WHERE id=?").bind(id).first();
    if (!role) throw new ApiError(404, "NOT_FOUND", "角色不存在");

    const name = safeText(p.name, 60);
    const description = safeText(p.description, 200);
    const scope = ["global", "department"].includes(String(p.scope)) ? String(p.scope) : undefined;

    if (name) {
      if (scope) await db.prepare("UPDATE roles SET name=?, description=?, scope=? WHERE id=?").bind(name, description, scope, id).run();
      else await db.prepare("UPDATE roles SET name=?, description=? WHERE id=?").bind(name, description, id).run();
    }

    if (Array.isArray(p.permissionIds)) {
      await db.prepare("DELETE FROM role_permissions WHERE role_id=?").bind(id).run();
      for (const pid of p.permissionIds) {
        await db.prepare("INSERT OR IGNORE INTO role_permissions(role_id, permission_id) VALUES(?,?)").bind(id, Number(pid)).run();
      }
    }

    await db.prepare("INSERT INTO audit_logs(dept_id, action, actor_user_id, actor, detail, request_id) VALUES(?, 'UPDATE_ROLE', ?, ?, ?, ?)").bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `更新角色 ${name || id} 权限`, rid).run();

    return ok({ updated: true, id }, rid);
  } catch (error) { return fail(error, rid); }
}

export async function DELETE(request: Request) {
  const rid = requestId(request);
  try {
    const ctx = await requireApiUser();
    if (!hasPermission(ctx, "system:accounts")) throw new ApiError(403, "FORBIDDEN", "无权管理角色");

    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) throw new ApiError(400, "VALIDATION_ERROR", "角色ID不能为空");

    const db = getD1();
    const role = await db.prepare("SELECT id, code, name FROM roles WHERE id=?").bind(id).first<{ id: number; code: string; name: string }>();
    if (!role) throw new ApiError(404, "NOT_FOUND", "角色不存在");

    // 检查是否有用户正在使用此角色
    const userCount = await db.prepare("SELECT COUNT(*) cnt FROM user_roles WHERE role_id=?").bind(id).first<{ cnt: number }>();
    if (userCount && userCount.cnt > 0) throw new ApiError(409, "IN_USE", `该角色下还有 ${userCount.cnt} 个用户，请先取消分配`);

    await db.batch([
      db.prepare("DELETE FROM role_permissions WHERE role_id=?").bind(id),
      db.prepare("DELETE FROM roles WHERE id=?").bind(id),
      db.prepare("INSERT INTO audit_logs(dept_id, action, actor_user_id, actor, detail, request_id) VALUES(?, 'DELETE_ROLE', ?, ?, ?, ?)").bind(ctx.primaryDeptId, ctx.userId, ctx.displayName, `删除角色 ${role.name}(${role.code})`, rid),
    ]);

    return ok({ deleted: true, id }, rid);
  } catch (error) { return fail(error, rid); }
}
