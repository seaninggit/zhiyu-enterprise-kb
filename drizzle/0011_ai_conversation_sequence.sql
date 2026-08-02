ALTER TABLE `ai_messages` ADD `sequence_no` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `ai_messages` AS target
SET `sequence_no` = (
  SELECT COUNT(*) FROM `ai_messages` AS previous
  WHERE previous.conversation_id = target.conversation_id
    AND (previous.create_time < target.create_time OR (
      previous.create_time = target.create_time AND (
        CASE previous.role WHEN 'user' THEN 0 ELSE 1 END < CASE target.role WHEN 'user' THEN 0 ELSE 1 END
        OR (CASE previous.role WHEN 'user' THEN 0 ELSE 1 END = CASE target.role WHEN 'user' THEN 0 ELSE 1 END AND previous.id <= target.id)
      )
    ))
);
--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_sequence_idx` ON `ai_messages` (`conversation_id`,`sequence_no`);
