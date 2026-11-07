CREATE TABLE `viewed_files` (
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`version` text NOT NULL,
	`viewed_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `path`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
