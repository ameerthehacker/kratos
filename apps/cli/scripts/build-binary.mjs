// The single binary (3u3, D57). esbuild bundles the server into one ESM file, then @yao-pkg/pkg
// makes a Node SEA of it (stock Node, downloaded and checksum-verified per target) with the "pkg"
// config in package.json: the web UI and DB migrations ride along as assets, read through pkg's
// virtual filesystem at the same paths as from source (src/paths.ts), and better-sqlite3's native
// addon is extracted on first run. pnpm's symlinked node_modules trips pkg, so better-sqlite3 (no
// dependencies of its own) stays out of the bundle and is copied, as a real folder, next to it.
// Usage: node scripts/build-binary.mjs [pkg target…] (default: this machine), after `pnpm build`.
// Output: dist-bin/kratos (one target) or dist-bin/kratos-<os>-<arch>.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, realpathSync, rmSync } from "node:fs";
import { build } from "esbuild";

if (!existsSync("../web/dist/index.html")) throw new Error("Build the web UI first: pnpm build");

await build({
  entryPoints: ["src/index.ts"],
  // In dist/ like tsc's output, so src/paths.ts's paths (../../web/dist, ../drizzle) still hold.
  outfile: "dist/kratos.mjs",
  bundle: true,
  platform: "node",
  target: "node26", // .nvmrc (D59)
  format: "esm",
  external: ["better-sqlite3"],
  // CommonJS dependencies call require(); an ESM bundle has none of its own.
  banner: { js: 'import { createRequire as __kratosRequire } from "node:module"; const require = __kratosRequire(import.meta.url);' },
  logLevel: "warning",
});
rmSync("dist/node_modules", { recursive: true, force: true });
// Only what runs: not its C sources (deps/, src/), which pkg would pack too.
const sqlite = realpathSync("node_modules/better-sqlite3");
for (const part of ["package.json", "lib", "prebuilds"]) cpSync(`${sqlite}/${part}`, `dist/node_modules/better-sqlite3/${part}`, { recursive: true });

rmSync("dist-bin", { recursive: true, force: true });
const targets = process.argv.slice(2);
execFileSync(
  "pnpm",
  ["exec", "pkg", "dist/kratos.mjs", "--config", "package.json", "--output", "dist-bin/kratos", ...(targets.length ? ["--targets", targets.join(",")] : [])],
  { stdio: "inherit" },
);
