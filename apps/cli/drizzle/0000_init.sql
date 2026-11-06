CREATE TABLE `messages` (
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `seq`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_dir` text NOT NULL,
	`agent` text NOT NULL,
	`agent_started_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_by_project` ON `sessions` (`project_dir`,`updated_at`);