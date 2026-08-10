ALTER TABLE security_events ADD COLUMN resolution_action TEXT;
ALTER TABLE security_events ADD COLUMN resolution_note TEXT;
ALTER TABLE security_events ADD COLUMN resolved_by INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_security_events_status_document
  ON security_events(status, document_id, create_time);
