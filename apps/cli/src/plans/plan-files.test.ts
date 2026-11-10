import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diskPlans } from "./plan-files.js";

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((plans) => plans.close()));
});

/** The watcher says it's ready a moment before macOS delivers events for its folders: an edit
 * in that moment can go unseen. Real edits come seconds later; tests wait the moment out. */
const settled = (plans: { ready(): Promise<void> }) => plans.ready().then(() => new Promise((r) => setTimeout(r, 150)));

/** A throwaway project and its plans, with every change recorded. */
function project(setup?: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "kratos-plans-"));
  setup?.(dir);
  const plans = diskPlans(dir);
  opened.push(plans);
  const changes: [string, string | undefined][] = [];
  plans.onChange((folder, markdown) => changes.push([folder, markdown]));
  return { dir, plans, changes };
}

describe("diskPlans (4p1a, D79)", () => {
  it("writes a plan, making .kratos/ with a .gitignore that keeps it out of git", async () => {
    const { dir, plans, changes } = project();
    expect(existsSync(join(dir, ".kratos"))).toBe(false); // nothing until a plan is made
    await plans.write("features/csv-export", "# CSV export\n");
    expect(readFileSync(join(dir, ".kratos/features/csv-export/plan.md"), "utf8")).toBe("# CSV export\n");
    expect(readFileSync(join(dir, ".kratos/.gitignore"), "utf8")).toMatch(/^\*$/m);
    expect(plans.text("features/csv-export")).toBeDefined();
    expect(plans.text("features/csv-export")).toBe("# CSV export\n");
    expect(plans.text("sessions/nope")).toBeUndefined();
    expect(changes).toEqual([["features/csv-export", "# CSV export\n"]]);
  });

  it("keeps a .gitignore that's already there", async () => {
    const { dir, plans } = project((d) => {
      mkdirSync(join(d, ".kratos"));
      writeFileSync(join(d, ".kratos/.gitignore"), "mine\n");
    });
    await plans.write("sessions/s1", "# S\n");
    expect(readFileSync(join(dir, ".kratos/.gitignore"), "utf8")).toBe("mine\n");
  });

  it("knows the plans already there, and sees edits from outside: new, changed, removed", async () => {
    const { dir, plans, changes } = project((d) => {
      mkdirSync(join(d, ".kratos/sessions/s1"), { recursive: true });
      writeFileSync(join(d, ".kratos/sessions/s1/plan.md"), "# Before\n");
    });
    expect(plans.text("sessions/s1")).toBeDefined();
    await settled(plans);

    writeFileSync(join(dir, ".kratos/sessions/s1/plan.md"), "# After\n");
    await vi.waitFor(() => expect(changes).toEqual([["sessions/s1", "# After\n"]]), { timeout: 1000 });

    mkdirSync(join(dir, ".kratos/features/by-hand"));
    writeFileSync(join(dir, ".kratos/features/by-hand/plan.md"), "# By hand\n");
    await vi.waitFor(() => expect(changes.at(-1)).toEqual(["features/by-hand", "# By hand\n"]), { timeout: 1000 });

    rmSync(join(dir, ".kratos/sessions/s1"), { recursive: true });
    await vi.waitFor(() => expect(changes.at(-1)).toEqual(["sessions/s1", undefined]), { timeout: 1000 });
    expect(plans.text("sessions/s1")).toBeUndefined();
  });

  it("create writes only where there's no plan, even one it hasn't seen yet", async () => {
    const { dir, plans } = project((d) => {
      mkdirSync(join(d, ".kratos/sessions/s1"), { recursive: true });
      writeFileSync(join(d, ".kratos/sessions/s1/plan.md"), "# The agent's\n");
    });
    rmSync(join(dir, ".kratos/sessions/s1/plan.md")); // gone: create may write
    expect(await plans.create("sessions/s1", "# Template\n")).toBe(true);
    writeFileSync(join(dir, ".kratos/sessions/s1/plan.md"), "# The agent's again\n"); // not seen yet
    expect(await plans.create("sessions/s1", "# Template\n")).toBe(false);
    expect(readFileSync(join(dir, ".kratos/sessions/s1/plan.md"), "utf8")).toBe("# The agent's again\n");
  });

  it("watches a .kratos/ that's already there, so a plan made by someone else is seen", async () => {
    const { dir, plans, changes } = project((d) => mkdirSync(join(d, ".kratos"))); // only the database's, say
    await settled(plans);
    mkdirSync(join(dir, ".kratos/sessions/s1"));
    writeFileSync(join(dir, ".kratos/sessions/s1/plan.md"), "# By the agent\n");
    await vi.waitFor(() => expect(changes).toEqual([["sessions/s1", "# By the agent\n"]]), { timeout: 1000 });
  });

  it("reports its own write once, and ignores the database and other files beside the plans", async () => {
    const { dir, plans, changes } = project((d) => mkdirSync(join(d, ".kratos")));
    await plans.write("features/a", "# A\n");
    await settled(plans);
    writeFileSync(join(dir, ".kratos/kratos.db-wal"), "churn");
    writeFileSync(join(dir, ".kratos/features/a/notes.txt"), "not a plan");
    writeFileSync(join(dir, ".kratos/features/a/plan.md"), "# A2\n");
    await vi.waitFor(() => expect(changes.at(-1)).toEqual(["features/a", "# A2\n"]), { timeout: 1000 });
    expect(changes).toEqual([
      ["features/a", "# A\n"],
      ["features/a", "# A2\n"],
    ]);
  });
});

describe("diskPlans: review fixes (after 4p7b)", () => {
  it("a listener that throws doesn't stop the others hearing, nor end the process", async () => {
    const { plans, changes } = project();
    plans.onChange(() => {
      throw new Error("boom");
    });
    const after: string[] = [];
    plans.onChange((folder) => after.push(folder));
    await plans.write("sessions/s1", "# A\n");
    expect(changes).toEqual([["sessions/s1", "# A\n"]]);
    expect(after).toEqual(["sessions/s1"]);
  });
});
