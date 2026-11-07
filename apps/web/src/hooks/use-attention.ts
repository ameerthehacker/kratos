import { findLast } from "lodash-es";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import type { SessionSummary } from "@kratos/core";
import logoSvg from "@/assets/kratos-logo.svg?raw";
import { useKratos } from "@/lib/kratos-store";
import { chime, notifyOnce, trackPresence } from "@/lib/notify";

/** A session that's blocked on you: the agent asked a question, or wants your OK. */
const waitsForYou = (s: SessionSummary) => !s.done && (s.status === "needs_answer" || s.status === "needs_approval");
/** A session that just finished its turn: idle now, busy before (3w3). */
const finished = (s: SessionSummary, was: SessionSummary["status"] | undefined) => !s.done && s.status === "idle" && was !== undefined && was !== "idle";

/**
 * Tells you when an agent is waiting on you while Kratos isn't in front of you (3r3, the design):
 * the tab title counts the waiting sessions ("(1) Question · Kratos"), the favicon — the Kratos
 * logo — gets an amber dot, and a system notification shows when one starts waiting ("Claude Code
 * has a question" + the question) or finishes (3w3) while you're away — as quick settings allow,
 * once across tabs, with an optional chime. Clicking it opens that session.
 */
export function useAttention() {
  const sessions = useKratos((s) => s.sessions);
  const harnesses = useKratos((s) => s.harnesses);
  const viewing = useKratos((s) => s.viewing);
  const log = useKratos((s) => s.log);
  const prefs = useKratos((s) => s.settings?.notifications);
  const theme = useKratos((s) => s.settings?.theme);
  const navigate = useNavigate();
  useEffect(trackPresence, []);
  const waiting = sessions.filter(waitsForYou);
  const questions = waiting.filter((s) => s.status === "needs_answer").length;

  // Title and favicon follow the count.
  const label =
    waiting.length === questions
      ? questions === 1 ? "Question" : "Questions"
      : questions === 0
        ? waiting.length === 1 ? "Approval" : "Approvals"
        : "Waiting for you";
  useEffect(() => {
    document.title = waiting.length > 0 ? `(${waiting.length}) ${label} · Kratos` : "Kratos";
    setFavicon(waiting.length > 0);
  }, [waiting.length, label, theme]); // the favicon is drawn in the theme's colours

  // A notification for each session that starts waiting, or finishes, while you're away. Sessions
  // already in that state when the page loads don't notify (you're looking at the tab then).
  const before = useRef<Map<string, SessionSummary["status"]> | null>(null);
  useEffect(() => {
    const previous = before.current;
    before.current = new Map(sessions.map((s) => [s.id, s.status]));
    if (!previous || !prefs?.on) return;
    for (const session of sessions) {
      const was = previous.get(session.id);
      if (was === session.status) continue;
      const agent = harnesses.find((h) => h.id === session.harness)?.name ?? "The agent";
      const name = session.title ?? "New session";
      let title: string;
      let body = name;
      if (waitsForYou(session) && prefs.needsYou) {
        title = session.status === "needs_answer" ? `${agent} has a question` : `${agent} needs your OK`;
        body = (session.status === "needs_answer" && session.id === viewing ? openQuestionText(log) : undefined) ?? name;
      } else if (finished(session, was) && prefs.finished) {
        title = `${agent} finished`;
      } else continue;
      notifyOnce(`${session.id}:${session.status}`, () => {
        const note = new Notification(title, { body, tag: session.id }); // one per session: a newer one replaces it
        note.onclick = () => {
          window.focus();
          navigate(`/s/${session.id}`);
          note.close();
        };
        if (prefs.sound) chime();
      });
    }
  }, [sessions, harnesses, viewing, log, navigate, prefs]);
}

/**
 * Ask once whether Kratos may show notifications — from a click (sending a prompt), as
 * browsers require; never again once you've answered.
 */
export function askToNotify(): void {
  if (useKratos.getState().settings?.notifications.on === false) return; // turned off in quick settings (3w3)
  if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
}

/** The first question of the newest still-open question set in the viewed session's log. */
function openQuestionText(log: ReturnType<typeof useKratos.getState>["log"]): string | undefined {
  const resolved = new Set(log.flatMap((m) => (m.type === "question_resolved" ? [m.id] : [])));
  const open = findLast(log, (m) => m.type === "question_request" && !resolved.has(m.id));
  return open?.type === "question_request" ? open.request.questions[0]?.question : undefined;
}

/** The Kratos logo as the favicon, with an amber dot (the theme's `--wait`) while you're needed.
 * A favicon is drawn outside the page, where CSS variables don't resolve: so the logo's
 * `var(--primary, …)` colours are swapped for the theme's current values first (the file's
 * fallback only if the theme doesn't set one). */
function setFavicon(dot: boolean): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  const theme = getComputedStyle(document.documentElement);
  const wait = theme.getPropertyValue("--wait").trim();
  const canvas = theme.getPropertyValue("--canvas").trim();
  const themed = logoSvg.replace(/var\(--([\w-]+),\s*([^)]+)\)/g, (_, name: string, fallback: string) => theme.getPropertyValue(`--${name}`).trim() || fallback.trim());
  const svg = dot ? themed.replace("</svg>", `<circle cx="52" cy="12" r="11" fill="${wait}" stroke="${canvas}" stroke-width="4"/></svg>`) : themed;
  link.type = "image/svg+xml";
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
