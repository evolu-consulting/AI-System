// CR-070 · HUB-FR-104 · K1-AC08 · spec §2 "Seed mẫu" + plan §6 (Q9) · test-plan K1 §4 A120–A122: `hub:seed` thư mục seed thật ⇒
// mẫu `sdlc-delivery` (9 stage) + `bug-fix` (6 stage), ≤ 10 stage, executor/after/back_to_steps đúng plan §6, hợp
// `ProcessStageDefSchema` + không vi phạm luật chéo stage (`processDefStageIssues`, gồm BACK_TARGET_INVALID); `sdlc` giữ 8 stage
// như cũ (12 file test khoá của sdlc không đổi = `test:lock:verify`); seed lần 2 không nhân đôi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ProcessStageDefSchema, processDefStageIssues } from "@ai/contracts/hub-admin";
import { OWNER_URL } from "../H1/_fixtures";
import { fn, loadSeed } from "../P-a/_support/modules";
import { type Json, type Sql, setupPa } from "../P-a/_support/pa";

let sql: Sql;
let ready = false;
beforeAll(async () => {
  ({ sql, ready } = await setupPa());
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

async function seed(): Promise<void> {
  const m = await loadSeed();
  await fn(m, "runHubSeed")({ url: OWNER_URL, dir: m.DEFAULT_SEED_DIR, appEnv: "development" });
}
const tpl = async (key: string): Promise<Json> =>
  (
    await sql<
      Json[]
    >`select * from hub.process_defs where tenant_id is null and key = ${key} and deleted_at is null`
  )[0];
async function execKeys(stages: Json[]): Promise<(string | undefined)[]> {
  const [agents, teams] = await Promise.all([
    sql<Json[]>`select id, key from hub.agents`,
    sql<Json[]>`select id, key from hub.agent_teams`,
  ]);
  const keyOf = new Map<string, string>([...agents, ...teams].map((r) => [r.id, r.key]));
  return stages.map((s) => keyOf.get(s.executor.agent_id ?? s.executor.team_id));
}
const backOf = (s: Json) => s.after?.back_to_steps ?? [];

describe("A120–A122 · seed mẫu AISDLC [CR-070 · K1-AC08]", () => {
  it("CR-070 · K1-AC08 · A120 · sdlc-delivery 9 stage: key, executor, after, back_to_steps theo plan §6; hợp contract + luật chéo stage", async () => {
    expect({ migration0019: ready }).toEqual({ migration0019: true });
    await seed();
    const d = await tpl("sdlc-delivery");
    expect(d).toBeDefined();
    const st: Json[] = d?.stages ?? [];
    expect(st.length).toBeLessThanOrEqual(10);
    expect(st.map((s) => s.key)).toEqual([
      "scope",
      "setup-plan",
      "spec",
      "design",
      "implement",
      "code-review",
      "testing",
      "uat",
      "release",
    ]);
    expect(await execKeys(st)).toEqual([
      "intake-analyst",
      "docs-architect",
      "docs-architect",
      "backend-lead",
      "dev-team",
      "reviewer",
      "qc",
      "qc-uat",
      "docs-architect",
    ]);
    expect(st.map((s) => s.after.kind)).toEqual([
      "review",
      "auto",
      "review",
      "auto",
      "auto",
      "review",
      "review",
      "review",
      "auto",
    ]);
    expect(st.map(backOf)).toEqual([[], [], [], [], [], [4], [4], [], []]);
    for (const s of st)
      expect({ k: s.key, ok: ProcessStageDefSchema.safeParse(s).success }).toEqual({
        k: s.key,
        ok: true,
      });
    expect(processDefStageIssues(st)).toEqual([]);
  });
  it("CR-070 · K1-AC08 · A121 · bug-fix 6 stage (Bug Intake gate → Code Reading → Bug Fix → Code Review/Testing trượt ⇒ quay lại bước 2 → Release)", async () => {
    expect({ migration0019: ready }).toEqual({ migration0019: true });
    await seed();
    const st: Json[] = (await tpl("bug-fix"))?.stages ?? [];
    expect(st.map((s) => s.key)).toEqual([
      "bug-intake",
      "code-reading",
      "bug-fix",
      "code-review",
      "testing",
      "release",
    ]);
    expect(await execKeys(st)).toEqual([
      "intake-analyst",
      "backend-lead",
      "backend-lead",
      "reviewer",
      "qc",
      "docs-architect",
    ]);
    expect(st.map((s) => s.after.kind)).toEqual([
      "review",
      "auto",
      "auto",
      "review",
      "review",
      "auto",
    ]);
    expect(st.map(backOf)).toEqual([[], [], [], [2], [2], []]);
    for (const s of st)
      expect({ k: s.key, ok: ProcessStageDefSchema.safeParse(s).success }).toEqual({
        k: s.key,
        ok: true,
      });
    expect(processDefStageIssues(st)).toEqual([]);
  });
  it("CR-070 · K1-AC08 · A122 · mọi template mẫu mới có đủ heading của required_sections; sdlc giữ 8 stage; seed lần 2 không nhân đôi", async () => {
    expect({ migration0019: ready }).toEqual({ migration0019: true });
    await seed();
    for (const key of ["sdlc-delivery", "bug-fix"]) {
      expect({ key, seeded: (await tpl(key)) !== undefined }).toEqual({ key, seeded: true });
      for (const s of ((await tpl(key))?.stages ?? []) as Json[]) {
        expect(s.output.required_sections.length).toBeGreaterThan(0);
        for (const sec of s.output.required_sections as string[])
          expect({
            key,
            stage: s.key,
            sec,
            has: String(s.output.template).includes(`## ${sec}`),
          }).toEqual({
            key,
            stage: s.key,
            sec,
            has: true,
          });
      }
    }
    expect((await tpl("sdlc"))?.stages).toHaveLength(8);
    const n = async () =>
      Number((await sql`select count(*)::int as n from hub.process_defs`)[0]?.n);
    const before = await n();
    await seed();
    expect(await n()).toBe(before);
  });
});
