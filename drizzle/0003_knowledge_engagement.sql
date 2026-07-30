CREATE TABLE `knowledge_subscriptions` (
  `document_id` integer NOT NULL,
  `user_id` integer NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (`document_id`,`user_id`),
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `knowledge_subscriptions_user_idx` ON `knowledge_subscriptions` (`user_id`,`is_active`);
--> statement-breakpoint
CREATE TABLE `ai_answer_feedback` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `query_log_id` integer NOT NULL,
  `user_id` integer NOT NULL,
  `helpful` integer NOT NULL,
  `reason` text DEFAULT '' NOT NULL,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`query_log_id`) REFERENCES `ai_query_logs`(`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_answer_feedback_query_user_idx` ON `ai_answer_feedback` (`query_log_id`,`user_id`);
--> statement-breakpoint
CREATE TABLE `workflow_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text NOT NULL,
  `title` text NOT NULL,
  `document_id` integer NOT NULL,
  `applicant_user_id` integer NOT NULL,
  `dept_id` integer NOT NULL,
  `status` text DEFAULT 'SUBMITTED' NOT NULL,
  `payload` text DEFAULT '{}' NOT NULL,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
  FOREIGN KEY (`applicant_user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`)
);
--> statement-breakpoint
CREATE INDEX `workflow_requests_user_status_idx` ON `workflow_requests` (`applicant_user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `workflow_requests_dept_time_idx` ON `workflow_requests` (`dept_id`,`create_time`);
