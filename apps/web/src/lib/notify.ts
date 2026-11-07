/**
 * Notifications that reach you once, and only while you're away (3w3, D64). Every open Kratos tab
 * sees the same session changes, so each would notify: instead a tab you're looking at marks
 * itself in localStorage (then nobody notifies — that tab's title and favicon already show it),
 * and otherwise a Web Lock per event lets the first tab through and the others skip it.
 */
const LOOKING = "kratos-looking";
const tabId = crypto.randomUUID();

/** Whether you're looking at this tab: visible, and its window in front. */
const lookingHere = () => !document.hidden && document.hasFocus();

function markPresence(): void {
  try {
    if (lookingHere()) localStorage.setItem(LOOKING, tabId);
    else if (localStorage.getItem(LOOKING) === tabId) localStorage.removeItem(LOOKING);
  } catch {
    // storage blocked: each tab then only knows about itself
  }
}

/** Keep this tab's "you're looking at me" mark current (mount once, in the layout). Also wakes
 * the chime's audio on your first click, as browsers only allow sound after one. */
export function trackPresence(): () => void {
  const events = ["focus", "blur", "visibilitychange"] as const;
  const leave = () => {
    try {
      if (localStorage.getItem(LOOKING) === tabId) localStorage.removeItem(LOOKING);
    } catch {}
  };
  const wake = () => void (audio ??= new AudioContext()).resume().catch(() => {});
  for (const e of events) (e === "visibilitychange" ? document : window).addEventListener(e, markPresence);
  window.addEventListener("pagehide", leave);
  window.addEventListener("pointerdown", wake, { once: true });
  markPresence();
  return () => {
    for (const e of events) (e === "visibilitychange" ? document : window).removeEventListener(e, markPresence);
    window.removeEventListener("pagehide", leave);
    window.removeEventListener("pointerdown", wake);
    leave();
  };
}

function lookingAtKratos(): boolean {
  if (lookingHere()) return true;
  try {
    return localStorage.getItem(LOOKING) !== null;
  } catch {
    return false;
  }
}

/** Whether this browser lets Kratos notify at all. */
export const canNotify = () => "Notification" in window && Notification.permission === "granted";

/** Run `show` for event `key` in exactly one tab, unless you're looking at a Kratos tab. */
export function notifyOnce(key: string, show: () => void): void {
  if (!canNotify() || lookingAtKratos()) return;
  if (!("locks" in navigator)) return show();
  void navigator.locks.request(`kratos-notify:${key}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return; // another tab has it
    show();
    await new Promise((resolve) => setTimeout(resolve, 5000)); // held a while, so slower tabs skip it
  });
}

let audio: AudioContext | undefined;

/** A short two-note chime, made on the spot (no sound file). Silent if the browser hasn't allowed
 * this tab to play sound yet (no click in it so far). */
export function chime(): void {
  try {
    audio ??= new AudioContext();
    const start = audio.currentTime;
    [880, 1320].forEach((frequency, i) => {
      const at = start + i * 0.12;
      const tone = audio!.createOscillator();
      const volume = audio!.createGain();
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, at);
      volume.gain.exponentialRampToValueAtTime(0.15, at + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      tone.connect(volume).connect(audio!.destination);
      tone.start(at);
      tone.stop(at + 0.4);
    });
  } catch {
    // no Web Audio: no sound
  }
}
