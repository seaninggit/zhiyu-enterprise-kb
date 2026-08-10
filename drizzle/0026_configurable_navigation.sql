-- 可配置功能树：菜单展示、页面访问与业务操作分离。
INSERT OR IGNORE INTO permissions(id,code,name,parent_code,sort_order) VALUES
(101,'menu:knowledge','知识门户',NULL,101),
(102,'page:library','知识首页','menu:knowledge',102),
(103,'page:favorites','我的收藏','menu:knowledge',103),
(110,'menu:my_knowledge','我的知识',NULL,110),
(111,'page:contributions','我的上传','menu:my_knowledge',111),
(120,'menu:approval','审批中心',NULL,120),
(121,'page:approval_pending','待我审批','menu:approval',121),
(122,'page:approval_history','审批记录','menu:approval',122),
(130,'menu:governance','知识治理',NULL,130),
(131,'page:document_admin','文档管理','menu:governance',131),
(132,'page:feedback_governance','反馈治理','menu:governance',132),
(133,'page:lifecycle_governance','生命周期治理','menu:governance',133),
(140,'menu:taxonomy','知识体系',NULL,140),
(141,'page:taxonomy','分类与标签','menu:taxonomy',141),
(150,'menu:ai_ops','AI运营',NULL,150),
(151,'page:ai_ops','AI策略与运营','menu:ai_ops',151),
(160,'menu:accounts','成员与权限',NULL,160),
(161,'page:accounts','账号、部门与角色','menu:accounts',161),
(170,'menu:runtime','系统运行',NULL,170),
(171,'page:runtime','系统运行与自动化','menu:runtime',171),
(180,'menu:audit','安全与审计',NULL,180),
(181,'page:audit','安全与审计','menu:audit',181),
(190,'menu:ai_assistant','AI知识助手',NULL,190),
(191,'page:ai_assistant','智能问答','menu:ai_assistant',191);

INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 1,id FROM permissions WHERE code LIKE 'menu:%' OR code LIKE 'page:%';
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 2,id FROM permissions WHERE code IN ('menu:knowledge','page:library','page:favorites','menu:my_knowledge','page:contributions','menu:approval','page:approval_pending','page:approval_history','menu:governance','page:document_admin','page:feedback_governance','page:lifecycle_governance','menu:taxonomy','page:taxonomy','menu:ai_ops','page:ai_ops','menu:audit','page:audit','menu:ai_assistant','page:ai_assistant');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id)
SELECT 3,id FROM permissions WHERE code IN ('menu:knowledge','page:library','page:favorites','menu:my_knowledge','page:contributions','menu:ai_assistant','page:ai_assistant');
