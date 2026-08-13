ALTER TABLE `documents` ADD COLUMN `document_type` text NOT NULL DEFAULT 'NORMAL';
ALTER TABLE `documents` ADD COLUMN `risk_level` text NOT NULL DEFAULT 'NORMAL';
CREATE INDEX IF NOT EXISTS `documents_approval_class_idx` ON `documents` (`document_type`,`risk_level`,`security_level`,`share_scope`);
