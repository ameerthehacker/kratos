ALTER TABLE `sessions` ADD `model` text;--> statement-breakpoint
-- `agent` now holds the harness id (D43); sessions from before stored the display name.
UPDATE `sessions` SET `agent` = 'claude-code' WHERE `agent` = 'Claude Code';
