INSERT OR IGNORE INTO `permissions` (`code`,`name`,`parent_code`,`sort_order`)
VALUES ('governance:business_review','业务内容审核','governance:admin',245);

INSERT OR IGNORE INTO `role_permissions` (`role_id`,`permission_id`)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='BUSINESS_REVIEWER' AND p.code='governance:business_review';

DELETE FROM `role_permissions`
WHERE role_id=(SELECT id FROM roles WHERE code='BUSINESS_REVIEWER')
  AND permission_id=(SELECT id FROM permissions WHERE code='governance:department_review');

DELETE FROM `role_permissions`
WHERE role_id=(SELECT id FROM roles WHERE code='SUPER_ADMIN')
  AND permission_id IN (
    SELECT id FROM permissions WHERE code IN (
      'governance:department_review',
      'governance:business_review',
      'governance:enterprise_review',
      'governance:compliance_review'
    )
  );

DELETE FROM `approval_duties`
WHERE user_id IN (
  SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id
  WHERE r.code='SUPER_ADMIN'
)
AND duty_code<>'EMERGENCY_PUBLISHER';
