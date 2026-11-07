import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useKratos, type Changes } from "@/lib/kratos-store";

/**
 * A session's changes (3v2): asked for when connected, and again whenever its status changes (a
 * turn starts, waits on you, ends) — live counts while the agent edits come in 3v4. Undefined until
 * the server answers.
 */
export function useChanges(sessionId: string | undefined): Changes | undefined {
  const { connected, send, status, changes } = useKratos(
    useShallow((s) => ({
      connected: s.connected,
      send: s.send,
      status: s.sessions.find((session) => session.id === sessionId)?.status,
      changes: sessionId ? s.changes[sessionId] : undefined,
    })),
  );
  useEffect(() => {
    if (connected && sessionId) send({ type: "get_changes", sessionId });
  }, [connected, sessionId, status, send]);
  return changes;
}
