import type { ServerInfo } from "@/lib/kratos-store";

/**
 * Kratos's version, right after the wordmark (3u1, the design's header pill): the bare value — a
 * release ("0.3.1") or the commit it runs from ("ab9151c") — small and muted. New (owner): a link
 * to that release's notes, or that commit, on GitHub.
 */
export function VersionPill({ info }: { info: Pick<ServerInfo, "serverVersion" | "versionUrl"> }) {
  const { serverVersion: version, versionUrl: url } = info;
  const release = /^\d+\.\d+\.\d+/.test(version);
  const look = "inline-flex h-5 items-center rounded-full bg-secondary px-1.75 font-mono text-xs whitespace-nowrap text-muted-foreground";
  if (!url) return <span className={look} title={`Kratos version ${version}`}>{version}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Kratos version ${version}`}
      title={`Kratos version ${version} · ${release ? "release notes" : "commit"}`}
      className={`${look} hover:bg-accent hover:text-secondary-foreground focus-visible:outline-2 focus-visible:outline-ring`}
    >
      {version}
    </a>
  );
}
