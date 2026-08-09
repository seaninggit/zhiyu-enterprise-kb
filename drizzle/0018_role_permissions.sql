-- 知域 · 可配置角色权限系统
-- 双层模型：功能权限（permissions）控制操作入口，数据范围（scope）控制可见数据量

-- ============================================================
-- 权限功能点表
-- ============================================================
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_code TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS permissions_code_uidx ON permissions(code);

-- ============================================================
-- 角色-权限关联表（多对多）
-- ============================================================
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id),
  permission_id INTEGER NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON role_permissions(role_id);

-- ============================================================
-- roles 表扩展：数据范围 + 系统保护标记
-- ============================================================
ALTER TABLE roles ADD COLUMN scope TEXT NOT NULL DEFAULT 'department';
ALTER TABLE roles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

-- 标记现有三角色为系统角色
UPDATE roles SET scope='global', is_system=1 WHERE code='SUPER_ADMIN';
UPDATE roles SET scope='department', is_system=1 WHERE code='DEPT_ADMIN';
UPDATE roles SET scope='department', is_system=1 WHERE code='EMPLOYEE';

-- ============================================================
-- 种子：13 个功能权限点
-- ============================================================

-- 知识服务（EMPLOYEE+）
INSERT OR IGNORE INTO permissions(id, code, name, parent_code, sort_order) VALUES
(1,  'knowledge:library',   '知识广场',   NULL,              1),
(2,  'knowledge:favorites', '我的收藏',   NULL,              2),
(3,  'knowledge:upload',    '上传知识',   NULL,              3),
(4,  'knowledge:edit',      '编辑知识',   NULL,              4),
(5,  'knowledge:export',    '导出附件',   NULL,              5);

-- 知识治理（DEPT_ADMIN+）
INSERT OR IGNORE INTO permissions(id, code, name, parent_code, sort_order) VALUES
(10, 'governance:admin',    '维护工作台', NULL,             10),
(11, 'governance:platform', '治理与洞察', NULL,             11),
(12, 'governance:audit',    '审计日志',   NULL,             12),
(13, 'governance:approve',  '审核发布',   NULL,             13),
(14, 'governance:archive',  '作废恢复',   NULL,             14);

-- 系统管理（SUPER_ADMIN）
INSERT OR IGNORE INTO permissions(id, code, name, parent_code, sort_order) VALUES
(20, 'system:accounts',     '成员与权限', NULL,             20),
(21, 'system:settings',     '系统配置',   NULL,             21);

-- AI Agent（DEPT_ADMIN+）
INSERT OR IGNORE INTO permissions(id, code, name, parent_code, sort_order) VALUES
(30, 'agent:use',           '使用AI Agent', NULL,           30);

-- ============================================================
-- 种子：为现有三角色分配权限
-- ============================================================

-- SUPER_ADMIN（role_id=1）：全部 13 项权限
INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
SELECT 1, id FROM permissions;

-- DEPT_ADMIN（role_id=2）：knowledge:* + governance:* + agent:use
INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
SELECT 2, id FROM permissions
WHERE code IN (
  'knowledge:library','knowledge:favorites','knowledge:upload','knowledge:edit','knowledge:export',
  'governance:admin','governance:platform','governance:audit','governance:approve','governance:archive',
  'agent:use'
);

-- EMPLOYEE（role_id=3）：knowledge:*
INSERT OR IGNORE INTO role_permissions(role_id, permission_id)
SELECT 3, id FROM permissions
WHERE code IN (
  'knowledge:library','knowledge:favorites','knowledge:upload','knowledge:edit','knowledge:export'
);
