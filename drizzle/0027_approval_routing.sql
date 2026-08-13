CREATE TABLE IF NOT EXISTS `approval_duties` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL,
  `dept_id` integer,
  `duty_code` text NOT NULL,
  `is_active` integer NOT NULL DEFAULT 1,
  `create_user_id` integer NOT NULL,
  `create_time` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`dept_id`) REFERENCES `departments`(`id`),
  FOREIGN KEY (`create_user_id`) REFERENCES `users`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `approval_duties_user_dept_code_uidx` ON `approval_duties` (`user_id`,`dept_id`,`duty_code`);
CREATE INDEX IF NOT EXISTS `approval_duties_route_idx` ON `approval_duties` (`dept_id`,`duty_code`,`is_active`);

CREATE TABLE IF NOT EXISTS `approval_instances` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `document_id` integer NOT NULL,
  `document_version` integer NOT NULL,
  `route_type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'PENDING',
  `submitted_by` integer NOT NULL,
  `modifier_user_id` integer NOT NULL,
  `current_stage` integer NOT NULL DEFAULT 1,
  `create_time` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `complete_time` text,
  FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`),
  FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`),
  FOREIGN KEY (`modifier_user_id`) REFERENCES `users`(`id`)
);
CREATE INDEX IF NOT EXISTS `approval_instances_doc_status_idx` ON `approval_instances` (`document_id`,`status`,`create_time`);

CREATE TABLE IF NOT EXISTS `approval_steps` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `instance_id` integer NOT NULL,
  `stage_no` integer NOT NULL,
  `duty_code` text NOT NULL,
  `assignee_user_id` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'PENDING',
  `action_user_id` integer,
  `comment` text NOT NULL DEFAULT '',
  `action_time` text,
  `create_time` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`instance_id`) REFERENCES `approval_instances`(`id`),
  FOREIGN KEY (`assignee_user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`action_user_id`) REFERENCES `users`(`id`)
);
CREATE UNIQUE INDEX IF NOT EXISTS `approval_steps_instance_stage_uidx` ON `approval_steps` (`instance_id`,`stage_no`);
CREATE INDEX IF NOT EXISTS `approval_steps_assignee_status_idx` ON `approval_steps` (`assignee_user_id`,`status`,`create_time`);

INSERT OR IGNORE INTO `permissions` (`code`,`name`,`parent_code`,`sort_order`) VALUES
  ('governance:department_review','部门知识审核','governance:admin',245),
  ('governance:enterprise_review','企业知识审核','governance:admin',246),
  ('governance:compliance_review','合规审核','governance:admin',247),
  ('governance:emergency_publish','紧急发布','governance:admin',248);
INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
  SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='DEPT_ADMIN' AND p.code='governance:department_review';
INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
  SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='SUPER_ADMIN' AND p.code IN ('governance:department_review','governance:enterprise_review','governance:compliance_review','governance:emergency_publish');
INSERT OR IGNORE INTO `roles` (`code`,`name`,`description`,`scope`,`is_system`) VALUES
  ('KNOWLEDGE_REVIEWER','知识审核员','负责指定部门的日常知识备审','department',1),
  ('BUSINESS_REVIEWER','业务审核员','负责业务真实性与适用性审核','department',1),
  ('ENTERPRISE_KNOWLEDGE_ADMIN','企业知识管理员','负责跨部门与重要知识审核','global',1),
  ('COMPLIANCE_REVIEWER','合规审核员','负责敏感、机密及高风险知识审核','global',1);
INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
  SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='KNOWLEDGE_REVIEWER' AND p.code IN ('menu:system','page:approval_pending','page:approval_history','governance:department_review','knowledge:view');
INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
  SELECT reviewer.id,rp.permission_id FROM roles reviewer CROSS JOIN roles employee JOIN role_permissions rp ON rp.role_id=employee.id WHERE reviewer.code='KNOWLEDGE_REVIEWER' AND employee.code='EMPLOYEE';
INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
  SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='BUSINESS_REVIEWER' AND p.code IN ('menu:system','page:approval_pending','page:approval_history','governance:department_review','knowledge:view');
INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
  SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='ENTERPRISE_KNOWLEDGE_ADMIN' AND p.code IN ('menu:system','page:approval_pending','page:approval_history','governance:enterprise_review','knowledge:view');
INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
  SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='COMPLIANCE_REVIEWER' AND p.code IN ('menu:system','page:approval_pending','page:approval_history','governance:compliance_review','knowledge:view');
