// CR-114 hub-eval · replay chạy trong bộ unit thường: mọi ca seed đạt, không hồi quy so baseline, ca seed phủ đủ nhóm.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runCli } from "./cli";
import type { EvalCase, Report } from "./types";

const DIR = import.meta.dir;
const baseline = join(DIR, "baseline.replay.json");

describe("hub-eval replay", () => {
  test("replay of recorded responses passes every case with no regression vs baseline", async () => {
    const r = await runCli(["--baseline", baseline, "--json"]);
    const j = JSON.parse(r.stdout) as Report & { diff: { regression: boolean } };
    expect(j.results.filter((x) => !x.pass).map((x) => x.id)).toEqual([]);
    expect(j.diff.regression).toBe(false);
    expect(r.code).toBe(0);
  });

  test("text summary is at most 10 lines and replay is deterministic", async () => {
    const a = await runCli(["--baseline", baseline]);
    const b = await runCli(["--baseline", baseline]);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout.trim().split("\n").length).toBeLessThanOrEqual(10);
  });

  test("seed set covers routing, contracts, rag, confirm tools and leak probes with demo data only", async () => {
    const cases = (await Bun.file(join(DIR, "cases.json")).json()) as EvalCase[];
    expect(cases.length).toBeGreaterThanOrEqual(15);
    const tags = new Set(cases.flatMap((c) => c.tags ?? []));
    for (const t of ["routing", "tool", "confirm", "leak", "facts", "no-hallucination"])
      expect(tags.has(t)).toBe(true);
    expect(new Set(cases.map((c) => c.agent))).toEqual(
      new Set(["orchestrator", "contracts", "rag", "dify-invoice"]),
    );
    const all = JSON.stringify(cases) + (await Bun.file(join(DIR, "fixtures.json")).text());
    expect(/niti|titi/i.test(all)).toBe(false);
  });

  test("a degraded recording is caught: exit 1 against baseline", async () => {
    const { writeFileSync, mkdtempSync, copyFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "hub-eval-"));
    for (const f of ["cases.json", "fixtures.json"]) copyFileSync(join(DIR, f), join(dir, f));
    const rec = (await Bun.file(join(DIR, "recorded.replay.json")).json()) as {
      responses: Record<string, { target?: string }>;
    };
    for (const id of ["orch-delegate-contracts", "orch-delegate-rag", "orch-delegate-invoice"]) {
      const x = rec.responses[id];
      if (x) x.target = "rag-wrong";
    }
    writeFileSync(join(dir, "recorded.replay.json"), JSON.stringify(rec));
    const r = await runCli(["--baseline", baseline], { dir });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("hồi quy");
  });
});
