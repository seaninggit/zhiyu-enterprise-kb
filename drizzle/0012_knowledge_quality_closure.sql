ALTER TABLE `knowledge_governance_tasks` ADD `assignee_user_id` integer REFERENCES `users`(`id`);
--> statement-breakpoint
ALTER TABLE `knowledge_governance_tasks` ADD `target_document_id` integer REFERENCES `documents`(`id`);
--> statement-breakpoint
ALTER TABLE `knowledge_governance_tasks` ADD `resolution` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `knowledge_governance_tasks` ADD `resolved_by` integer REFERENCES `users`(`id`);
--> statement-breakpoint
ALTER TABLE `knowledge_governance_tasks` ADD `resolved_at` text;
--> statement-breakpoint
ALTER TABLE `search_logs` ADD `corrected_query` text;
--> statement-breakpoint
ALTER TABLE `search_logs` ADD `correction_reason` text;
--> statement-breakpoint
ALTER TABLE `ai_messages` ADD `correction_payload` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
CREATE TABLE `search_corrections` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `source_term` text NOT NULL,
  `target_term` text NOT NULL,
  `pinyin` text DEFAULT '' NOT NULL,
  `kind` text DEFAULT 'HOMOPHONE' NOT NULL,
  `usage_count` integer DEFAULT 0 NOT NULL,
  `is_active` integer DEFAULT 1 NOT NULL,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `update_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_corrections_source_uidx` ON `search_corrections` (`source_term`);
--> statement-breakpoint
CREATE INDEX `search_corrections_pinyin_idx` ON `search_corrections` (`pinyin`,`is_active`);
--> statement-breakpoint
INSERT OR IGNORE INTO `search_corrections` (`source_term`,`target_term`,`pinyin`,`kind`) VALUES
('虚球','需求','xu qiu','HOMOPHONE'),
('报消','报销','bao xiao','HOMOPHONE'),
('审披','审批','shen pi','HOMOPHONE'),
('流成','流程','liu cheng','HOMOPHONE'),
('入只','入职','ru zhi','HOMOPHONE'),
('离只','离职','li zhi','HOMOPHONE'),
('归挡','归档','gui dang','HOMOPHONE'),
('核消','核销','he xiao','HOMOPHONE');
--> statement-breakpoint
INSERT OR IGNORE INTO `system_settings` (`key`,`value`,`description`) VALUES
('search.correction_enabled','1','启用企业词库同音字纠错'),
('search.correction_auto_confidence','0.92','达到该置信度时默认采用纠正词并保留原词双路召回'),
('governance.auto_expire','1','复核日期逾期后自动将知识标记为过期作废');
