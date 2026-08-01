ALTER TABLE `users` ADD `identity_provider` text DEFAULT 'CHATGPT' NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_time` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `activated_by` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_time` text;
--> statement-breakpoint
CREATE INDEX `users_last_login_idx` ON `users` (`last_login_time`);
