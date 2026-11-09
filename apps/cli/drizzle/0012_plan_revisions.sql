CREATE TABLE `plan_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_dir` text NOT NULL,
	`folder` text NOT NULL,
	`markdown` text,
	`by` text NOT NULL,
	`session_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `plan_revisions_by_plan` ON `plan_revisions` (`project_dir`,`folder`,`id`);