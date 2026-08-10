ALTER TABLE `prompt_templates` ADD `strategy_json` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prompt_templates` ADD `change_note` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `prompt_templates` ADD `eval_score` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `prompt_templates` ADD `evaluated_at` text;
--> statement-breakpoint
ALTER TABLE `prompt_templates` ADD `submitted_at` text;
--> statement-breakpoint
ALTER TABLE `prompt_templates` ADD `approved_by` integer REFERENCES `users`(`id`);
--> statement-breakpoint
ALTER TABLE `prompt_templates` ADD `approved_at` text;
--> statement-breakpoint
ALTER TABLE `rag_eval_runs` ADD `prompt_id` integer REFERENCES `prompt_templates`(`id`);
--> statement-breakpoint
CREATE TABLE `prompt_release_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `prompt_id` integer NOT NULL,
  `action` text NOT NULL,
  `from_prompt_id` integer,
  `eval_score` real DEFAULT 0 NOT NULL,
  `actor_user_id` integer NOT NULL,
  `detail` text DEFAULT '' NOT NULL,
  `create_time` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`prompt_id`) REFERENCES `prompt_templates`(`id`),
  FOREIGN KEY (`from_prompt_id`) REFERENCES `prompt_templates`(`id`),
  FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `prompt_release_logs_prompt_time_idx` ON `prompt_release_logs` (`prompt_id`,`create_time`);
--> statement-breakpoint
INSERT OR IGNORE INTO system_settings(key,value,description) VALUES
('prompt.release_min_score','85','Prompt生产发布最低评测分'),
('prompt.require_approval','1','生产Prompt必须经过审核发布');
--> statement-breakpoint
UPDATE `prompt_templates` SET `strategy_json`='{"sections":{"companyEvidence":true,"generalAdvice":true,"pendingConfirmation":true},"facts":{"citationRequired":true,"noInternalGuess":true,"generalAdviceLabel":true},"style":"PROFESSIONAL","detail":"STANDARD","temperature":0.2,"maxCitations":5,"maxTokens":1200}' WHERE `strategy_json`='{}';
--> statement-breakpoint
INSERT INTO `rag_eval_cases` (`question`,`expected_document_ids`,`expected_keywords`,`create_user_id`) SELECT '报销费用有哪些基本要求？','[]','["真实性","审批","30天"]',id FROM users ORDER BY id LIMIT 1;
--> statement-breakpoint
INSERT INTO `rag_eval_cases` (`question`,`expected_document_ids`,`expected_keywords`,`create_user_id`) SELECT '招待费超过2000元怎么办？','[]','["2000","提前申请"]',id FROM users ORDER BY id LIMIT 1;
--> statement-breakpoint
INSERT INTO `rag_eval_cases` (`question`,`expected_document_ids`,`expected_keywords`,`create_user_id`) SELECT '需求评审需要包含什么？','[]','["需求","评审"]',id FROM users ORDER BY id LIMIT 1;
--> statement-breakpoint
INSERT INTO `rag_eval_cases` (`question`,`expected_document_ids`,`expected_keywords`,`create_user_id`) SELECT '报销在哪个系统入口提交？','[]','["通用建议","待确认"]',id FROM users ORDER BY id LIMIT 1;
