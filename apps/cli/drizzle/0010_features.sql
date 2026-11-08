CREATE TABLE `features` (
	`id` text PRIMARY KEY NOT NULL,
	`project_dir` text NOT NULL,
	`title` text NOT NULL,
	`done_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `features_by_project` ON `features` (`project_dir`,`updated_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `feature_id` text REFERENCES features(id);