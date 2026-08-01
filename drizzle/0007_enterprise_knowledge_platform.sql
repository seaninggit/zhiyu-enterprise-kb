CREATE TABLE `knowledge_spaces` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`dept_id` integer,`name` text NOT NULL,`code` text NOT NULL,`description` text DEFAULT '' NOT NULL,`owner_user_id` integer,`is_active` integer DEFAULT true NOT NULL,`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,`update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`),FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`));
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_spaces_code_uidx` ON `knowledge_spaces` (`code`);
--> statement-breakpoint
CREATE INDEX `knowledge_spaces_dept_idx` ON `knowledge_spaces` (`dept_id`);
--> statement-breakpoint
CREATE TABLE `knowledge_folders` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`space_id` integer NOT NULL,`parent_id` integer,`name` text NOT NULL,`sort_order` integer DEFAULT 0 NOT NULL,`owner_user_id` integer,`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,`update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,FOREIGN KEY (`space_id`) REFERENCES `knowledge_spaces`(`id`),FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`));
--> statement-breakpoint
CREATE INDEX `knowledge_folders_space_parent_idx` ON `knowledge_folders` (`space_id`,`parent_id`,`sort_order`);
--> statement-breakpoint
ALTER TABLE `documents` ADD `space_id` integer REFERENCES `knowledge_spaces`(`id`);
--> statement-breakpoint
ALTER TABLE `documents` ADD `folder_id` integer REFERENCES `knowledge_folders`(`id`);
--> statement-breakpoint
ALTER TABLE `documents` ADD `extracted_text` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD `parse_status` text DEFAULT 'PENDING' NOT NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD `published_version` integer;
--> statement-breakpoint
ALTER TABLE `documents` ADD `published_title` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `published_content` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD `verification_status` text DEFAULT 'UNVERIFIED' NOT NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD `verified_at` text;
--> statement-breakpoint
CREATE TABLE `document_acl` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`document_id` integer NOT NULL,`subject_type` text NOT NULL,`subject_id` integer NOT NULL,`permission` text NOT NULL,`expires_at` text,`create_user_id` integer NOT NULL,`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),FOREIGN KEY (`create_user_id`) REFERENCES `users`(`id`));
--> statement-breakpoint
CREATE UNIQUE INDEX `document_acl_unique_idx` ON `document_acl` (`document_id`,`subject_type`,`subject_id`,`permission`);
--> statement-breakpoint
CREATE INDEX `document_acl_subject_idx` ON `document_acl` (`subject_type`,`subject_id`,`permission`);
--> statement-breakpoint
CREATE TABLE `ingestion_jobs` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`document_id` integer NOT NULL,`document_version` integer NOT NULL,`status` text DEFAULT 'QUEUED' NOT NULL,`stage` text DEFAULT 'EXTRACT' NOT NULL,`attempt` integer DEFAULT 0 NOT NULL,`extracted_chars` integer DEFAULT 0 NOT NULL,`chunk_count` integer DEFAULT 0 NOT NULL,`error_message` text DEFAULT '' NOT NULL,`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,`update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`));
--> statement-breakpoint
CREATE INDEX `ingestion_jobs_doc_idx` ON `ingestion_jobs` (`document_id`,`document_version`);
--> statement-breakpoint
CREATE INDEX `ingestion_jobs_status_idx` ON `ingestion_jobs` (`status`,`update_time`);
--> statement-breakpoint
CREATE TABLE `search_logs` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`user_id` integer NOT NULL,`dept_id` integer NOT NULL,`query` text NOT NULL,`result_count` integer DEFAULT 0 NOT NULL,`clicked_document_id` integer,`mode` text DEFAULT 'HYBRID' NOT NULL,`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`));
--> statement-breakpoint
CREATE INDEX `search_logs_time_idx` ON `search_logs` (`create_time`);
--> statement-breakpoint
CREATE INDEX `search_logs_zero_idx` ON `search_logs` (`result_count`,`create_time`);
--> statement-breakpoint
CREATE TABLE `notifications` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,`user_id` integer NOT NULL,`type` text NOT NULL,`title` text NOT NULL,`content` text DEFAULT '' NOT NULL,`document_id` integer,`is_read` integer DEFAULT false NOT NULL,`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,FOREIGN KEY (`user_id`) REFERENCES `users`(`id`));
--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`is_read`,`create_time`);
--> statement-breakpoint
CREATE TABLE `user_favorites` (`user_id` integer NOT NULL,`document_id` integer NOT NULL,`create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,PRIMARY KEY(`user_id`,`document_id`),FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`));
--> statement-breakpoint
CREATE INDEX `user_favorites_user_idx` ON `user_favorites` (`user_id`,`create_time`);
--> statement-breakpoint
CREATE TABLE `system_settings` (`key` text PRIMARY KEY NOT NULL,`value` text NOT NULL,`description` text DEFAULT '' NOT NULL,`update_user_id` integer,`update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,FOREIGN KEY (`update_user_id`) REFERENCES `users`(`id`));
--> statement-breakpoint
INSERT OR IGNORE INTO knowledge_spaces(id,dept_id,name,code,description,owner_user_id) VALUES (1,1,'公司制度','CORPORATE','公司级制度与公共知识',9001),(2,2,'产品研发','PRODUCT','产品、研发与技术规范',9002),(3,3,'人力行政','PEOPLE','员工全生命周期知识',9003),(4,4,'销售市场','GTM','客户、销售与品牌知识',9004),(5,5,'财务法务','FINANCE','财务、合同与合规知识',9005);
--> statement-breakpoint
INSERT OR IGNORE INTO knowledge_folders(id,space_id,parent_id,name,sort_order) VALUES (1,1,NULL,'公司治理',1),(2,2,NULL,'研发规范',1),(3,3,NULL,'员工服务',1),(4,4,NULL,'销售运营',1),(5,5,NULL,'费用与合同',1);
--> statement-breakpoint
UPDATE documents SET space_id=dept_id,folder_id=dept_id,published_version=CASE WHEN status='ARCHIVED_ACTIVE' THEN version ELSE NULL END,published_title=CASE WHEN status='ARCHIVED_ACTIVE' THEN title ELSE NULL END,published_content=CASE WHEN status='ARCHIVED_ACTIVE' THEN content ELSE NULL END,extracted_text=content,parse_status=CASE WHEN content<>'' THEN 'COMPLETED' ELSE 'PENDING' END,verification_status=CASE WHEN status='ARCHIVED_ACTIVE' THEN 'VERIFIED' ELSE 'UNVERIFIED' END,verified_at=CASE WHEN status='ARCHIVED_ACTIVE' THEN update_time ELSE NULL END;
--> statement-breakpoint
INSERT OR IGNORE INTO system_settings(key,value,description) VALUES ('hybrid.vector_weight','0.72','混合检索向量权重'),('hybrid.keyword_weight','0.28','混合检索关键词权重'),('rag.top_k','5','RAG召回片段数'),('governance.review_days','180','默认复核周期'),('identity.sync_mode','SIWC_MANAGED','企业身份同步模式');
