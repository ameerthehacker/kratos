import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { PlanKind } from "@kratos/core";
import { planKey, useKratos, type PlanState } from "@/lib/kratos-store";

/** Plans asked for on this connection: every change arrives by itself after the first answer, so
 * the components showing one plan (island, notices, page) ask once between them. */
const asked = new Set<string>();

/**
 * A feature's or a session's plan (4p1b, D79): asked for when connected; every change to its file
 * arrives by itself after that (4p1a). Undefined until the server answers.
 */
export function usePlan(kind: PlanKind, id: string | undefined): PlanState | undefined {
  const key = id ? planKey({ kind, id }) : undefined;
  const { connected, send, plan } = useKratos(
    useShallow((s) => ({ connected: s.connected, send: s.send, plan: key ? s.plans[key] : undefined })),
  );
  useEffect(() => {
    if (!connected) return void asked.clear(); // a new connection asks again
    if (!id || !key || asked.has(key)) return;
    asked.add(key);
    send({ type: "get_plan", owner: { kind, id } });
  }, [connected, kind, id, key, send]);
  return plan;
}
