ALTER TABLE `notification_deliveries` ADD COLUMN `subject` text NOT NULL DEFAULT '';
ALTER TABLE `notification_deliveries` ADD COLUMN `content` text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS `scheduled_task_runs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `task_code` text NOT NULL,
  `status` text NOT NULL DEFAULT 'RUNNING',
  `detail` text NOT NULL DEFAULT '',
  `request_id` text NOT NULL DEFAULT '',
  `started_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` text
);

CREATE INDEX IF NOT EXISTS `scheduled_task_runs_code_time_idx`
  ON `scheduled_task_runs` (`task_code`,`started_at`);
