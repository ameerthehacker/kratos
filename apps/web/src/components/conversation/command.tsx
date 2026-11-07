import ShikiHighlighter from "react-shiki/web";
import { useCodeTheme } from "@/lib/appearance";

/** A shell command, highlighted by Shiki (react-shiki) as `bash`, on the raw block's own background. */
export function Command({ text }: { text: string }) {
  const theme = useCodeTheme();
  return (
    <ShikiHighlighter language="bash" theme={theme} showLanguage={false} addDefaultStyles={false} className="shiki-inline">
      {`$ ${text}`}
    </ShikiHighlighter>
  );
}
