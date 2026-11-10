// `pnpm dev`'s project (3z8): a playground at the repo root, so trying Kratos out doesn't have the
// agent edit Kratos itself. Gitignored here, and a git repository of its own, so reviewing changes
// (D65) sees only its files, not this repo's. Made once; left alone after that.
// `KRATOS_PROJECT=<dir> pnpm dev` (e.g. `../..` to dogfood) skips it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.env.KRATOS_PROJECT) process.exit(0);

const dir = fileURLToPath(new URL("../../../playground/", import.meta.url));
if (existsSync(`${dir}.git`)) process.exit(0);

mkdirSync(dir, { recursive: true });
if (!existsSync(`${dir}README.md`)) {
  writeFileSync(
    `${dir}README.md`,
    "# Kratos playground\n\nWhere `pnpm dev`'s agent works: try anything here. Not part of Kratos (gitignored there);\nits own git repository, so reviewing changes shows only this folder.\n",
  );
}
const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
git("init", "-q");
git("add", "-A");
// Its own name, so a machine without a git identity can still make the first commit; unsigned and
// without hooks, so a global signing key or hook can't fail it (and leave a playground with no commit).
try {
  git("-c", "user.name=Kratos", "-c", "user.email=kratos@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "Playground");
} catch (err) {
  rmSync(`${dir}.git`, { recursive: true, force: true }); // tried again next time
  throw err;
}
console.log(`kratos: made the dev playground at ${dir}`);
