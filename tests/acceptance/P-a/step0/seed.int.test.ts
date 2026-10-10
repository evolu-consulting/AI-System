// HUB-FR-104 · HUB-FR-114 · D18 · S0-32, S0-33 (test-plan-int §1, plan-seed): `hub:seed` thư mục seed thật (`apps/hub-api/seed`)
// ⇒ mẫu `sdlc` 8 giai đoạn, `hoa-don` 2 giai đoạn, nhóm `plan-team`/`dev-team`/`test-team` sequential, bản `hoa-don` của tenant dev
// (acme) gán Group "Kế toán" + bật; seed lần 2 không nhân đôi. Group "Kế toán" có sẵn từ persona P-a (`ke-toan`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { OWNER_URL } from "../../H1/_fixtures";
import { fn, loadSeed } from "../_support/modules";
import { type Json, PA_FIX, type Sql, setupPa, T } from "../_support/pa";
import { needSchema } from "../_support/schema";

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
  const run = fn(m, "runHubSeed");
  await run({ url: OWNER_URL, dir: m.DEFAULT_SEED_DIR, appEnv: "development" });
}
const tpl = async (key: string): Promise<Json> =>
  (
    await sql<
      Json[]
    >`select * from hub.process_defs where tenant_id is null and key = ${key} and deleted_at is null`
  )[0];

describe("S0-32…S0-33 · seed D18 [HUB-FR-104]", () => {
  it("HUB-FR-104 · S0-32 · mẫu sdlc 8 stage: executor đúng thứ tự, review ở 1/5/8, auto ở 2–4, 6–7", async () => {
    needSchema(ready);
    await seed();
    const d = await tpl("sdlc");
    expect(d).toBeDefined();
    const stages: Json[] = d?.stages ?? [];
    expect(stages).toHaveLength(8);
    const [agents, teams] = await Promise.all([
      sql<Json[]>`select id, key from hub.agents`,
      sql<Json[]>`select id, key from hub.agent_teams`,
    ]);
    const keyOf = new Map<string, string>([...agents, ...teams].map((r) => [r.id, r.key]));
    const exec = stages.map((s) => keyOf.get(s.executor.agent_id ?? s.executor.team_id));
    expect(exec).toEqual([
      "intake-analyst",
      "docs-architect",
      "plan-team",
      "qc",
      "spec-readiness",
      "dev-team",
      "test-team",
      "reviewer",
    ]);
    expect(stages.map((s) => s.after.kind)).toEqual([
      "review",
      "auto",
      "auto",
      "auto",
      "review",
      "auto",
      "auto",
      "review",
    ]);
    for (const s of stages) expect(s.output.required_sections.length).toBeGreaterThan(0);
  });
  it("HUB-FR-114 · S0-33 · mẫu hoa-don 2 stage (review, real_action); nhóm sequential; bản acme gán Kế toán + bật; seed lần 2 không nhân đôi", async () => {
    needSchema(ready);
    await seed();
    const hd = await tpl("hoa-don");
    expect(hd?.stages.map((s: Json) => [s.after.kind, s.real_action])).toEqual([
      ["review", false],
      ["auto", true],
    ]);
    const teams = await sql<
      Json[]
    >`select key, mode from hub.agent_teams where key in ('plan-team','dev-team','test-team','ba-team') order by key`;
    expect(teams.map((t) => t.key)).toEqual(["ba-team", "dev-team", "plan-team", "test-team"]);
    for (const t of teams.filter((x) => x.key !== "ba-team")) expect(t.mode).toBe("sequential");
    const [mine] = await sql<Json[]>`select enabled, stages from hub.process_defs
      where tenant_id = ${T.acme} and key = 'hoa-don' and deleted_at is null`;
    expect(mine?.enabled).toBe(true);
    expect(mine?.stages?.[0]?.after?.group_id).toBe(PA_FIX.gKeToan);
    const n = async () =>
      Number((await sql`select count(*)::int as n from hub.process_defs`)[0]?.n);
    const before = await n();
    await seed();
    expect(await n()).toBe(before);
  });
});
