UPDATE `knowledge_governance_tasks`
SET assignee_user_id=(
  SELECT d.create_user_id FROM documents d
  WHERE d.id=knowledge_governance_tasks.source_document_id
), update_time=CURRENT_TIMESTAMP
WHERE source_document_id IS NOT NULL
  AND status IN ('OPEN','IN_PROGRESS');
