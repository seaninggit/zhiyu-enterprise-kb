-- 定时任务配置表
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cron_expr TEXT NOT NULL DEFAULT '0 18 * * *',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 种子：默认四个定时任务
INSERT OR IGNORE INTO scheduled_tasks(id, code, name, description, cron_expr) VALUES
(1, 'archive_expired',   '自动作废过期文档',   '每天检查超过复核日期的文档并自动标记为作废', '0 18 * * *'),
(2, 'detect_duplicates', '重复文档检测',       '每天扫描标题相似的已发布文档并创建治理任务', '0 19 * * *'),
(3, 'review_reminders',  '复核到期提醒',       '每天检查30天内即将到复核日期的文档并通知负责人', '0 8 * * *'),
(4, 'search_self_learn', '搜索同音自学习',     '每天分析搜索零结果→成功搜索的换词行为，自动建立同音纠错映射', '0 20 * * *');
