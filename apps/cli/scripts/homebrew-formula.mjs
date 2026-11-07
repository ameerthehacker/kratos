// The Homebrew formula for a release (3u4, D57): one prebuilt binary per OS and CPU, from the
// release's assets. The release workflow runs it and pushes the result to the tap
// (github.com/ameerthehacker/homebrew-kratos → `brew install ameerthehacker/kratos/kratos`).
// Usage: node scripts/homebrew-formula.mjs <version> <SHA256SUMS file>  → the formula on stdout.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REPOSITORY = "https://github.com/ameerthehacker/kratos";

/** What the release ships, as Homebrew's blocks name them. Asset names use Node's platform/arch. */
const TARGETS = [
  { os: "macos", cpu: "arm", asset: "darwin-arm64" },
  { os: "macos", cpu: "intel", asset: "darwin-x64" },
  { os: "linux", cpu: "arm", asset: "linux-arm64" },
  { os: "linux", cpu: "intel", asset: "linux-x64" },
];

/** `kratos-<version>-<platform>-<arch>.tar.gz`, as the workflow names the archives. */
export const assetName = (version, target) => `kratos-${version}-${target}.tar.gz`;

/** sha256sum's output ("<hash>  <file>" per line) → { file: hash }. */
export function parseSums(text) {
  const sums = {};
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64}) [ *]?(\S+)$/.exec(line.trim());
    if (match) sums[match[2]] = match[1];
  }
  return sums;
}

/** The formula's Ruby. Throws if the version is odd or an archive's checksum is missing. */
export function formula(version, sums) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Not a release version: ${version}`);
  const block = (os) => {
    const parts = TARGETS.filter((t) => t.os === os).map((t) => {
      const name = assetName(version, t.asset);
      if (!sums[name]) throw new Error(`No checksum for ${name}`);
      return [
        `    on_${t.cpu} do`,
        `      url "${REPOSITORY}/releases/download/v${version}/${name}"`,
        `      sha256 "${sums[name]}"`,
        `    end`,
      ].join("\n");
    });
    return [`  on_${os} do`, ...parts, `  end`].join("\n");
  };
  return `# Written by the release workflow (apps/cli/scripts/homebrew-formula.mjs); edits here are overwritten.
class Kratos < Formula
  desc "Mindful, controllable coding-agent harness"
  homepage "${REPOSITORY}"
  version "${version}"

${block("macos")}
${block("linux")}

  def install
    bin.install "kratos"
  end

  def caveats
    <<~EOS
      Kratos drives the Claude Code CLI: install \`claude\` and sign in first.
      Then run \`kratos\` in a project folder; the UI opens in your browser.
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kratos --version")
  end
end
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [version, sumsFile] = process.argv.slice(2);
  if (!version || !sumsFile) throw new Error("Usage: homebrew-formula.mjs <version> <SHA256SUMS file>");
  process.stdout.write(formula(version, parseSums(readFileSync(sumsFile, "utf8"))));
}
