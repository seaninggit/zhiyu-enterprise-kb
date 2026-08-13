CREATE TABLE IF NOT EXISTS `ai_model_services` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `provider` text NOT NULL DEFAULT 'deepseek',
  `model_code` text NOT NULL,
  `base_url` text NOT NULL,
  `secret_env_key` text NOT NULL DEFAULT 'DEEPSEEK_API_KEY',
  `status` text NOT NULL DEFAULT 'ACTIVE',
  `create_user_id` integer NOT NULL,
  `create_time` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`create_user_id`) REFERENCES `users`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `ai_model_services_name_uidx` ON `ai_model_services` (`name`);
CREATE INDEX IF NOT EXISTS `ai_model_services_status_idx` ON `ai_model_services` (`status`);

CREATE TABLE IF NOT EXISTS `ai_scene_routes` (
  `scene_code` text PRIMARY KEY NOT NULL,
  `scene_name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `primary_service_id` integer NOT NULL,
  `fallback_service_id` integer,
  `update_user_id` integer NOT NULL,
  `update_time` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`primary_service_id`) REFERENCES `ai_model_services`(`id`),
  FOREIGN KEY (`fallback_service_id`) REFERENCES `ai_model_services`(`id`),
  FOREIGN KEY (`update_user_id`) REFERENCES `users`(`id`)
);

INSERT OR IGNORE INTO `ai_model_services` (`id`,`name`,`provider`,`model_code`,`base_url`,`secret_env_key`,`status`,`create_user_id`)
VALUES (1,'DeepSeek 默认服务','deepseek','deepseek-v4-flash','https://api.deepseek.com','DEEPSEEK_API_KEY','ACTIVE',1);

INSERT OR IGNORE INTO `ai_scene_routes` (`scene_code`,`scene_name`,`description`,`primary_service_id`,`fallback_service_id`,`update_user_id`) VALUES
('KNOWLEDGE_QA','智能问答','面向员工的企业知识检索与回答',1,NULL,1),
('GOVERNANCE_AGENT','知识治理 Agent','知识质量巡检与治理建议',1,NULL,1),
('PROMPT_EVAL','PromptOps 评测','策略在线测试与评测集运行',1,NULL,1);
