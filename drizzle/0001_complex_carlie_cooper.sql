ALTER TABLE `audit_logs` RENAME COLUMN "created_at" TO "create_time";--> statement-breakpoint
CREATE TABLE `approval_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`applicant_user_id` integer NOT NULL,
	`approver_user_id` integer,
	`action` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `approval_records_doc_idx` ON `approval_records` (`document_id`,`create_time`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`parent_id` integer,
	`manager_user_id` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_code_uidx` ON `departments` (`code`);--> statement-breakpoint
CREATE INDEX `departments_parent_idx` ON `departments` (`parent_id`);--> statement-breakpoint
CREATE TABLE `document_tags` (
	`document_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`document_id`, `tag_id`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_tags_tag_idx` ON `document_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `document_visibility` (
	`document_id` integer NOT NULL,
	`dept_id` integer NOT NULL,
	PRIMARY KEY(`document_id`, `dept_id`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_visibility_dept_idx` ON `document_visibility` (`dept_id`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`subject` text NOT NULL,
	`bucket` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL,
	PRIMARY KEY(`subject`, `bucket`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_code_uidx` ON `roles` (`code`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`dept_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_dept_name_uidx` ON `tags` (`dept_id`,`name`);--> statement-breakpoint
CREATE TABLE `user_departments` (
	`user_id` integer NOT NULL,
	`dept_id` integer NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_dept_admin` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `dept_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_departments_dept_idx` ON `user_departments` (`dept_id`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_roles_role_idx` ON `user_roles` (`role_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uidx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);--> statement-breakpoint
INSERT OR IGNORE INTO `departments` (`id`,`code`,`name`,`is_active`) VALUES
(1,'GENERAL','综合管理部',1),(2,'PRODUCT','产品研发部',1),(3,'HR','人力行政部',1),(4,'SALES','销售市场部',1),(5,'FINANCE','财务法务部',1);--> statement-breakpoint
INSERT OR IGNORE INTO `users` (`id`,`email`,`display_name`,`status`) VALUES (1,'system@local.invalid','系统迁移用户','DISABLED');--> statement-breakpoint
INSERT OR IGNORE INTO `roles` (`id`,`code`,`name`,`description`) VALUES (1,'SUPER_ADMIN','超级管理员','全局知识治理'),(2,'DEPT_ADMIN','部门管理员','本部门知识治理'),(3,'EMPLOYEE','普通员工','知识生产与使用');--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `dept_id` integer;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `actor_user_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `request_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `audit_logs_doc_idx` ON `audit_logs` (`document_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_dept_time_idx` ON `audit_logs` (`dept_id`,`create_time`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_document_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`version` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`change_note` text NOT NULL,
	`operator_user_id` integer DEFAULT 1 NOT NULL,
	`operator` text NOT NULL,
	`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_document_versions`("id", "document_id", "version", "title", "content", "change_note", "operator_user_id", "operator", "create_time") SELECT "id", "document_id", "version", '', '', "change_note", 1, "operator", "create_time" FROM `document_versions`;--> statement-breakpoint
DROP TABLE `document_versions`;--> statement-breakpoint
ALTER TABLE `__new_document_versions` RENAME TO `document_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `document_versions_doc_ver_uidx` ON `document_versions` (`document_id`,`version`);--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dept_id` integer DEFAULT 1 NOT NULL,
	`create_user_id` integer DEFAULT 1 NOT NULL,
	`update_user_id` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`share_scope` text DEFAULT 'DEPT' NOT NULL,
	`security_level` text DEFAULT 'INTERNAL' NOT NULL,
	`owner` text NOT NULL,
	`uploader` text NOT NULL,
	`source_name` text,
	`source_key` text,
	`mime_type` text,
	`size` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`review_due_at` text,
	`is_deleted` integer DEFAULT false NOT NULL,
	`deleted_by` integer,
	`deleted_at` text,
	`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`create_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`update_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_status_check" CHECK("status" in ('DRAFT','PENDING_DEPT_REVIEW','ARCHIVED_ACTIVE','EXPIRED_VOID')),
	CONSTRAINT "documents_share_check" CHECK("share_scope" in ('DEPT','CROSS_DEPT'))
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "dept_id", "create_user_id", "update_user_id", "title", "summary", "content", "category", "status", "share_scope", "security_level", "owner", "uploader", "source_name", "source_key", "mime_type", "size", "version", "review_due_at", "is_deleted", "deleted_by", "deleted_at", "create_time", "update_time")
SELECT "id", 1, 1, 1, "title", "summary", "content", "category",
CASE "status" WHEN 'published' THEN 'ARCHIVED_ACTIVE' WHEN 'review' THEN 'PENDING_DEPT_REVIEW' WHEN 'archived' THEN 'EXPIRED_VOID' ELSE 'DRAFT' END,
'DEPT', "security_level", "owner", "uploader", "source_name", "source_key", "mime_type", "size", "version", "review_due_at", 0, NULL, NULL, "create_time", "update_time" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
CREATE INDEX `documents_dept_status_idx` ON `documents` (`dept_id`,`status`,`is_deleted`);--> statement-breakpoint
CREATE INDEX `documents_creator_idx` ON `documents` (`create_user_id`);--> statement-breakpoint
CREATE INDEX `documents_share_idx` ON `documents` (`share_scope`,`status`);--> statement-breakpoint
CREATE TABLE `__new_feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`reporter_user_id` integer DEFAULT 1 NOT NULL,
	`reporter` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_feedback`("id", "document_id", "type", "content", "reporter_user_id", "reporter", "status", "create_time") SELECT "id", "document_id", "type", "content", 1, "reporter", UPPER("status"), "create_time" FROM `feedback`;--> statement-breakpoint
DROP TABLE `feedback`;--> statement-breakpoint
ALTER TABLE `__new_feedback` RENAME TO `feedback`;--> statement-breakpoint
CREATE INDEX `feedback_doc_status_idx` ON `feedback` (`document_id`,`status`);
