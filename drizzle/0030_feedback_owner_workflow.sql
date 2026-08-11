ALTER TABLE `knowledge_governance_tasks` ADD `workflow_stage` text NOT NULL DEFAULT 'WAITING_OWNER';

UPDATE `knowledge_governance_tasks`
SET workflow_stage=CASE
  WHEN status='RESOLVED' THEN 'RESOLVED'
  WHEN status='IN_PROGRESS' AND source_document_id IS NOT NULL THEN 'OWNER_REVISING'
  WHEN source_document_id IS NOT NULL THEN 'WAITING_OWNER'
  ELSE 'ADMIN_TRIAGE'
END;

CREATE INDEX IF NOT EXISTS `knowledge_governance_tasks_assignee_stage_idx`
ON `knowledge_governance_tasks` (`assignee_user_id`,`workflow_stage`,`update_time`);
