ALTER TABLE `ai_model_services` ADD COLUMN `api_protocol` text NOT NULL DEFAULT 'CHAT_COMPLETIONS';
ALTER TABLE `ai_scene_routes` ADD COLUMN `status` text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE `ai_scene_routes` ADD COLUMN `source_type` text NOT NULL DEFAULT 'SYSTEM';
CREATE INDEX IF NOT EXISTS `ai_scene_routes_status_idx` ON `ai_scene_routes` (`status`);
