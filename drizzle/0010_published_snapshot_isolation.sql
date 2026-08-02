ALTER TABLE `documents` ADD `published_summary` text;
--> statement-breakpoint
UPDATE `documents`
SET `published_summary` = `summary`
WHERE `published_version` IS NOT NULL AND `published_summary` IS NULL;
