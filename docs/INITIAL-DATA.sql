INSERT OR IGNORE INTO departments(id, code, name, is_active) VALUES
  (1, 'GENERAL', '综合管理部', 1),
  (2, 'PRODUCT', '产品研发部', 1),
  (3, 'HR', '人力行政部', 1),
  (4, 'SALES', '销售市场部', 1),
  (5, 'FINANCE', '财务法务部', 1);

INSERT OR IGNORE INTO roles(id, code, name, description) VALUES
  (1, 'SUPER_ADMIN', '超级管理员', '全局目录、用户、权限、备份和清理治理'),
  (2, 'DEPT_ADMIN', '部门管理员', '本部门审核、授权和知识治理'),
  (3, 'EMPLOYEE', '普通员工', '本部门知识生产与已发布知识使用');

-- 首位通过平台登录的有效用户将自动成为超级管理员。
-- 后续人员由超级管理员分配部门和角色，禁止在初始化 SQL 中写入真实邮箱。
