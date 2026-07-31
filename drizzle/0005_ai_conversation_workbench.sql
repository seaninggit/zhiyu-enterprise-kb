CREATE TABLE `ai_conversations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `title` text NOT NULL,
  `status` text DEFAULT 'ACTIVE' NOT NULL,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_user_time_idx` ON `ai_conversations` (`user_id`,`update_time`);
--> statement-breakpoint
CREATE TABLE `ai_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `conversation_id` integer NOT NULL,
  `user_id` integer NOT NULL,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `mode` text,
  `source_payload` text DEFAULT '[]' NOT NULL,
  `query_log_id` integer,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`query_log_id`) REFERENCES `ai_query_logs`(`id`)
);
--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_time_idx` ON `ai_messages` (`conversation_id`,`create_time`);
--> statement-breakpoint
CREATE TABLE `knowledge_governance_tasks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `type` text NOT NULL,
  `status` text DEFAULT 'OPEN' NOT NULL,
  `dept_id` integer NOT NULL,
  `source_document_id` integer,
  `source_message_id` integer,
  `reporter_user_id` integer NOT NULL,
  `reason` text NOT NULL,
  `detail` text DEFAULT '' NOT NULL,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`),
  FOREIGN KEY (`source_document_id`) REFERENCES `documents`(`id`),
  FOREIGN KEY (`source_message_id`) REFERENCES `ai_messages`(`id`),
  FOREIGN KEY (`reporter_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `knowledge_governance_tasks_status_time_idx` ON `knowledge_governance_tasks` (`status`,`create_time`);
--> statement-breakpoint
CREATE INDEX `knowledge_governance_tasks_dept_status_idx` ON `knowledge_governance_tasks` (`dept_id`,`status`);
