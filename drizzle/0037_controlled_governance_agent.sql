CREATE TABLE IF NOT EXISTS agent_workflow_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  trigger_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED')),
  config_json TEXT NOT NULL DEFAULT '{}',
  config_version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id INTEGER NOT NULL REFERENCES agent_workflow_definitions(id),
  trigger_type TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','WAITING_CONFIRMATION','WAITING_EVENT','SUCCEEDED','PARTIAL','FAILED','CANCELLED')),
  actor_user_id INTEGER NOT NULL REFERENCES users(id),
  scope_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '',
  stop_reason TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  request_id TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(definition_id, trigger_key)
);
CREATE INDEX IF NOT EXISTS agent_workflow_runs_status_time_idx ON agent_workflow_runs(status, create_time);

CREATE TABLE IF NOT EXISTS agent_workflow_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('PLAN','TOOL_CALL','TOOL_RESULT','DECISION','ERROR')),
  tool_name TEXT,
  risk_level TEXT NOT NULL DEFAULT 'READ' CHECK(risk_level IN ('READ','LOW','HIGH')),
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'SUCCEEDED',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS agent_action_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES agent_workflow_runs(id) ON DELETE CASCADE,
  step_id INTEGER REFERENCES agent_workflow_steps(id),
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER,
  proposal_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','EXECUTED','EXPIRED')),
  decided_by INTEGER REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT '',
  decided_at TEXT,
  executed_at TEXT,
  create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS agent_action_confirmations_status_idx ON agent_action_confirmations(status, create_time);

INSERT OR IGNORE INTO agent_workflow_definitions(code,name,goal,trigger_code,config_json,created_by)
VALUES(
  'EXPIRY_GOVERNANCE_V1',
  '制度到期治理 Agent',
  '在授权范围内识别需要复核的制度，核验证据与影响，创建低风险治理任务；需要发布、审批、作废、删除、转交或权限变更时必须提交人工确认，不得直接执行。',
  'archive_expired',
  '{"actorUserId":1,"maxIterations":6,"maxToolCalls":30,"maxDocuments":50,"departmentIds":[],"allowedTools":["list_expiring_documents","inspect_document","create_governance_task","propose_high_risk_action"],"citationWindowDays":30,"mediumCitationThreshold":3,"highCitationThreshold":10}',
  1
);
