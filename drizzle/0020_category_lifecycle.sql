-- 系统仅保留一个不可删除的兜底分类，其余初始化分类均可迁移和停用。
INSERT OR IGNORE INTO knowledge_categories(dept_id,name,code,sort_order,is_active)
VALUES(NULL,'未分类','UNCLASSIFIED',9999,1);
