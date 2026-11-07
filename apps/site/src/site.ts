/**
 * The facts the site states in more than one place (D58). Change them here.
 * The brew command works once the tap has its formula (step 3u).
 */
export const site = {
  name: "Kratos",
  tagline: "Mindful, controllable vibe coding",
  description:
    "Kratos is an ultra-minimal harness for mindful vibe coding. You approve every step and understand everything that ships.",
  /** Homebrew, from the owner's tap repo github.com/ameerthehacker/homebrew-kratos (step 3u). */
  installCommand: "brew install ameerthehacker/kratos/kratos",
  repoUrl: "https://github.com/ameerthehacker/kratos",
  /** The CLI's default port (DEFAULT_PORT in packages/core). */
  localUrl: "http://localhost:4317",
} as const;
