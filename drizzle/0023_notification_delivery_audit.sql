CREATE TABLE IF NOT EXISTS `notification_deliveries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `document_id` integer,
  `channel` text NOT NULL,
  `event_type` text NOT NULL,
  `recipient` text NOT NULL,
  `status` text NOT NULL DEFAULT 'PENDING',
  `attempt` integer NOT NULL DEFAULT 1,
  `provider_message_id` text NOT NULL DEFAULT '',
  `error_message` text NOT NULL DEFAULT '',
  `request_id` text NOT NULL DEFAULT '',
  `create_time` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`)
);
CREATE INDEX IF NOT EXISTS `notification_deliveries_status_idx`
  ON `notification_deliveries` (`status`,`create_time`);
CREATE INDEX IF NOT EXISTS `notification_deliveries_user_event_idx`
  ON `notification_deliveries` (`user_id`,`event_type`,`create_time`);
