import { createCodePlugin } from "@streamdown/code";

/**
 * How code looks everywhere in the UI: reply code blocks (Streamdown) and raw commands
 * (react-shiki). One place on purpose — it becomes a user setting later (owner, PLAN "Settings").
 * Any Shiki bundled theme name works.
 */
export const CODE_THEME = "github-dark";

/** Streamdown's code plugin on the same theme (light slot unused: the app is dark-only for now). */
export const codePlugin = createCodePlugin({ themes: ["github-light", CODE_THEME] });
