import type { ClientMessage } from "@kratos/core";
import { useKratos } from "@/lib/kratos-store";

type Level = Extract<ClientMessage, { type: "client_log" }>["level"];

/**
 * Log from the browser (D44): shown in devtools as usual, and sent to the server so it lands in
 * the log file next to the server's own lines (component "web"). Dropped if not connected.
 */
export function clientLog(level: Level, message: string, data?: unknown): void {
  console[level === "info" ? "info" : level](`kratos: ${message}`, ...(data === undefined ? [] : [data]));
  useKratos.getState().send({ type: "client_log", level, message: message.slice(0, 2000), data });
}
