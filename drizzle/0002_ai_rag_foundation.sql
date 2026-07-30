ALTER TABLE `documents` ADD `ai_index_status` text DEFAULT 'PENDING' NOT NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD `ai_indexed_at` text;
--> statement-breakpoint
CREATE TABLE `document_chunks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `document_id` integer NOT NULL,
  `dept_id` integer NOT NULL,
  `document_version` integer NOT NULL,
  `chunk_index` integer NOT NULL,
  `content` text NOT NULL,
  `embedding` text,
  `embedding_model` text,
  `is_active` integer DEFAULT 1 NOT NULL,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
  FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_chunks_doc_ver_idx` ON `document_chunks` (`document_id`,`document_version`,`chunk_index`);
--> statement-breakpoint
CREATE INDEX `document_chunks_dept_active_idx` ON `document_chunks` (`dept_id`,`is_active`);
--> statement-breakpoint
CREATE TABLE `ai_query_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `dept_id` integer NOT NULL,
  `question` text NOT NULL,
  `answer` text NOT NULL,
  `mode` text NOT NULL,
  `source_document_ids` text DEFAULT '[]' NOT NULL,
  `request_id` text NOT NULL,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`)
);
--> statement-breakpoint
CREATE INDEX `ai_query_logs_user_time_idx` ON `ai_query_logs` (`user_id`,`create_time`);
--> statement-breakpoint
CREATE INDEX `ai_query_logs_dept_time_idx` ON `ai_query_logs` (`dept_id`,`create_time`);
