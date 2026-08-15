ALTER TABLE `scheduled_tasks` ADD `config_json` text NOT NULL DEFAULT '{}';
ALTER TABLE `scheduled_tasks` ADD `config_version` integer NOT NULL DEFAULT 1;
ALTER TABLE `scheduled_tasks` ADD `update_time` text NOT NULL DEFAULT '';

UPDATE `scheduled_tasks`
SET `name`='制度到期治理',
    `description`='按配置识别即将到期或已到期制度，创建待人工处理的治理任务并通知负责人，不自动作废文档',
    `config_json`='{"scopeMode":"ALL_DEPARTMENTS","departmentIds":[],"advanceDays":30,"citationWindowDays":30,"mediumCitationThreshold":3,"highCitationThreshold":10,"highRiskDueDays":3,"normalDueDays":7,"maxDocumentsPerRun":50,"maxCostCny":0.5,"taskCreationMode":"AUTO_CREATE","assigneeStrategy":"DOCUMENT_OWNER","unownedFallback":"DEPARTMENT_ADMIN","notifyOwner":true,"notifyHighRiskAdmin":true,"executionMode":"PROPOSE_ONLY"}',
    `config_version`=1,
    `update_time`=CURRENT_TIMESTAMP
WHERE `code`='archive_expired';

UPDATE `scheduled_tasks`
SET `name`='复核到期提醒（已并入制度到期治理）',
    `description`='该旧任务已由制度到期治理统一负责候选识别、任务创建和负责人通知，默认停用以避免重复提醒',
    `enabled`=0,
    `update_time`=CURRENT_TIMESTAMP
WHERE `code`='review_reminders';

UPDATE `scheduled_tasks` SET `update_time`=CURRENT_TIMESTAMP WHERE `update_time`='';
