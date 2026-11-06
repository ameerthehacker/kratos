import ShikiHighlighter from "react-shiki/web";
import { CODE_THEME } from "@/lib/appearance";

/** A shell command, highlighted by Shiki (react-shiki) as `bash`, on the raw block's own background. */
export function Command({ text }: { text: string }) {
  return (
    <ShikiHighlighter language="bash" theme={CODE_THEME} showLanguage={false} addDefaultStyles={false} className="shiki-inline">
      {`$ ${text}`}
    </ShikiHighlighter>
  );
}
