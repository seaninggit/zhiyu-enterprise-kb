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

CREATE INDEX `approval_records_doc_idx` ON `approval_records` (`document_id`,`create_time`);
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer,
	`dept_id` integer,
	`action` text NOT NULL,
	`actor_user_id` integer DEFAULT 1 NOT NULL,
	`actor` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`request_id` text DEFAULT '' NOT NULL,
	`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX `audit_logs_doc_idx` ON `audit_logs` (`document_id`);
CREATE INDEX `audit_logs_dept_time_idx` ON `audit_logs` (`dept_id`,`create_time`);
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

CREATE UNIQUE INDEX `departments_code_uidx` ON `departments` (`code`);
CREATE INDEX `departments_parent_idx` ON `departments` (`parent_id`);
CREATE TABLE `document_tags` (
	`document_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`document_id`, `tag_id`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `document_tags_tag_idx` ON `document_tags` (`tag_id`);
CREATE TABLE `document_versions` (
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

CREATE UNIQUE INDEX `document_versions_doc_ver_uidx` ON `document_versions` (`document_id`,`version`);
CREATE TABLE `document_visibility` (
	`document_id` integer NOT NULL,
	`dept_id` integer NOT NULL,
	PRIMARY KEY(`document_id`, `dept_id`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `document_visibility_dept_idx` ON `document_visibility` (`dept_id`);
CREATE TABLE `documents` (
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
	CONSTRAINT "documents_status_check" CHECK("documents"."status" in ('DRAFT','PENDING_DEPT_REVIEW','ARCHIVED_ACTIVE','EXPIRED_VOID')),
	CONSTRAINT "documents_share_check" CHECK("documents"."share_scope" in ('DEPT','CROSS_DEPT'))
);

CREATE INDEX `documents_dept_status_idx` ON `documents` (`dept_id`,`status`,`is_deleted`);
CREATE INDEX `documents_creator_idx` ON `documents` (`create_user_id`);
CREATE INDEX `documents_share_idx` ON `documents` (`share_scope`,`status`);
CREATE TABLE `feedback` (
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

CREATE INDEX `feedback_doc_status_idx` ON `feedback` (`document_id`,`status`);
CREATE TABLE `rate_limits` (
	`subject` text NOT NULL,
	`bucket` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL,
	PRIMARY KEY(`subject`, `bucket`)
);

CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL
);

CREATE UNIQUE INDEX `roles_code_uidx` ON `roles` (`code`);
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`dept_id` integer
);

CREATE UNIQUE INDEX `tags_dept_name_uidx` ON `tags` (`dept_id`,`name`);
CREATE TABLE `user_departments` (
	`user_id` integer NOT NULL,
	`dept_id` integer NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_dept_admin` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `dept_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `user_departments_dept_idx` ON `user_departments` (`dept_id`);
CREATE TABLE `user_roles` (
	`user_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `user_roles_role_idx` ON `user_roles` (`role_id`);
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX `users_email_uidx` ON `users` (`email`);
CREATE INDEX `users_status_idx` ON `users` (`status`);
