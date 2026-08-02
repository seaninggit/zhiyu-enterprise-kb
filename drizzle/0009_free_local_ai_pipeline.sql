ALTER TABLE `documents` ADD `extraction_method` text DEFAULT 'NONE' NOT NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD `extraction_detail` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `documents` ADD `ocr_status` text DEFAULT 'NOT_REQUIRED' NOT NULL;
--> statement-breakpoint
UPDATE `documents`
SET `extraction_method` = CASE
  WHEN `mime_type` LIKE 'text/%' THEN 'TEXT'
  WHEN `extracted_text` <> '' THEN 'LEGACY'
  ELSE 'NONE'
END,
`ocr_status` = CASE
  WHEN `mime_type` LIKE 'image/%' AND `extracted_text` = '' THEN 'REQUIRED'
  ELSE 'NOT_REQUIRED'
END;
