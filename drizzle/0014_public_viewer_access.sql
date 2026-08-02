INSERT OR IGNORE INTO `users` (`id`,`email`,`display_name`,`status`,`identity_provider`)
VALUES (9900,'visitor-shared@public.zhiyu.invalid','外部用户','ACTIVE','PUBLIC_ACCESS');
--> statement-breakpoint
INSERT OR IGNORE INTO `user_roles` (`user_id`,`role_id`)
SELECT 9900,`id` FROM `roles` WHERE `code`='EMPLOYEE';
--> statement-breakpoint
INSERT OR IGNORE INTO `user_departments` (`user_id`,`dept_id`,`is_primary`,`is_dept_admin`)
SELECT 9900,`id`,CASE WHEN `code`='GENERAL' THEN 1 ELSE 0 END,0
FROM `departments` WHERE `is_active`=1;
