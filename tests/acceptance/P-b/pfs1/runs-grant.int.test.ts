// P-b · CR-060 · vòng soát sau-UAT (reviewer B4) · WRK-FR-27 · PB-R16 · HUB-BR-14 · RG-01…RG-05 (test-plan §4.1b).
// Migration `0022_pb_runs_grant.sql`: role `agent_runtime` (vòng LRU snapshot) đọc ĐÚNG cột (id, status) của hub.runs,
// CHỈ hàng `status='running'`; không đọc cột khác (tenant_id/user_id/… ⇒ 42501), không ghi (INSERT/UPDATE/DELETE ⇒ 42501).
// Dữ liệu: acme (lan) 1 run running + 1 run finished; beta (an) 1 run running. Mọi INSERT bằng owner (setupPa).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { AGENT_RT_URL } from "../../H1/_fixtures";
import { ROOT } from "../../P-a/_support/modules";
import { PA, type Sql, setupPa } from "../../P-a/_support/pa";
import { pgCode } from "../../X2a/_x2a";

const U = (n: number) => `b1b40000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RUN = { acmeLive: U(1), acmeDone: U(2), betaLive: U(3) };
const DIR = join(ROOT, "packages/db/migrations-hub");
const file0022 = (): string | undefined => readdirSync(DIR).find((f) => /^0022_.*\.sql$/.test(f));

let sql: Sql;
let rt: Sql;

type Who = { id: string; tid: string };
async function insertAgentRun(
  s: Sql,
  who: Who,
  runId: string,
  n: number,
  status: string,
): Promise<void> {
  const conv = U(100 + n);
  const flow = U(200 + n);
  const mU = U(300 + n);
  const mA = U(400 + n);
  await s`insert into hub.conversations (id, tenant_id, user_id, title, title_norm)
    values (${conv}, ${who.tid}, ${who.id}, ${`rg-${n}`}, ${`rg-${n}`})`;
  await s`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flow}, ${who.tid}, ${who.id}, ${conv}, ${`rg-${n}`}, 2)`;
  await s`insert into hub.messages (id, tenant_id, user_id, conversation_id, flow_id, role, content, run_id) values
    (${mU}, ${who.tid}, ${who.id}, ${conv}, ${flow}, 'user', 'hỏi', null),
    (${mA}, ${who.tid}, ${who.id}, ${conv}, ${flow}, 'assistant', '', ${runId})`;
  const finished = status === "running" ? null : new Date();
  await s`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, owner, lease_until, finished_at) values
    (${runId}, ${who.tid}, ${who.id}, ${conv}, ${flow}, ${status}, 1, ${mU}, ${mA},
     'qc-other-instance', now() + interval '1 hour', ${finished})`;
}

beforeAll(async () => {
  ({ sql } = await setupPa());
  rt = postgres(AGENT_RT_URL, { max: 2, onnotice: () => {} });
  await insertAgentRun(sql, PA.A, RUN.acmeLive, 1, "running");
  await insertAgentRun(sql, PA.A, RUN.acmeDone, 2, "finished");
  await insertAgentRun(sql, PA.D, RUN.betaLive, 3, "running");
}, 60_000);
afterAll(async () => {
  await rt?.end();
  await sql?.end();
});

const ALL = () => [RUN.acmeLive, RUN.acmeDone, RUN.betaLive];

describe("RG-01…05 · 0022 GRANT SELECT(id,status) hub.runs → agent_runtime [WRK-FR-27, PB-R16, HUB-BR-14]", () => {
  it("WRK-FR-27 · PB-R16 · RG-01 · truy vấn LRU của Runtime chạy được (không 42501) ⇒ đúng các run running", async () => {
    const rows = await rt.unsafe(
      "SELECT id::text AS id FROM hub.runs WHERE id = ANY($1::uuid[]) AND status = 'running'",
      [ALL()],
    );
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([RUN.acmeLive, RUN.betaLive]));
  });

  it("PB-R16 · HUB-BR-14 · RG-02 · RLS: agent_runtime chỉ thấy hàng status='running' (finished vô hình kể cả khi không lọc status)", async () => {
    const rows =
      await rt`select id::text as id, status from hub.runs where id = any(${rt.array(ALL(), 2950)})`;
    expect(rows.map((r) => r.status)).toEqual(["running", "running"]);
    expect(rows.some((r) => r.id === RUN.acmeDone)).toBe(false);
  });

  it("HUB-BR-14 · RG-03 · cột ngoài (id,status) ⇒ 42501 (tenant_id, user_id, *, error_message)", async () => {
    expect(await pgCode(rt`select tenant_id from hub.runs limit 1`)).toBe("42501");
    expect(await pgCode(rt`select user_id from hub.runs limit 1`)).toBe("42501");
    expect(await pgCode(rt`select * from hub.runs limit 1`)).toBe("42501");
    expect(await pgCode(rt`select error_message from hub.runs where id = ${RUN.acmeLive}`)).toBe(
      "42501",
    );
    expect(await pgCode(rt`select count(*) from hub.runs where tenant_id = ${PA.A.tid}`)).toBe(
      "42501",
    );
  });

  it("HUB-BR-14 · RG-04 · agent_runtime KHÔNG ghi được hub.runs (INSERT/UPDATE/DELETE ⇒ 42501); dữ liệu không đổi", async () => {
    expect(
      await pgCode(rt`update hub.runs set status = 'cancelled' where id = ${RUN.acmeLive}`),
    ).toBe("42501");
    expect(await pgCode(rt`delete from hub.runs where id = ${RUN.betaLive}`)).toBe("42501");
    expect(
      await pgCode(
        rt`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
          user_message_id, answer_message_id) values (${U(9)}, ${PA.A.tid}, ${PA.A.id}, ${U(101)}, ${U(201)},
          'running', 1, ${U(301)}, ${U(401)})`,
      ),
    ).toBe("42501");
    const after =
      await sql`select id::text as id, status from hub.runs where id = any(${sql.array(ALL(), 2950)}) order by id`;
    expect(after.map((r) => [r.id, r.status])).toEqual([
      [RUN.acmeLive, "running"],
      [RUN.acmeDone, "finished"],
      [RUN.betaLive, "running"],
    ]);
  });

  it("WRK-FR-27 · RG-05 · 0022 idempotent: áp lại ⇒ không lỗi, đúng 1 policy runs_agent_runtime_select", async () => {
    const f = file0022();
    expect({ file0022: f !== undefined }).toEqual({ file0022: true });
    await sql.unsafe(
      readFileSync(join(DIR, f as string), "utf8").replaceAll("--> statement-breakpoint", ""),
    );
    const [p] = await sql`select count(*)::int as n from pg_policies
      where schemaname = 'hub' and tablename = 'runs' and policyname = 'runs_agent_runtime_select'`;
    expect(p?.n).toBe(1);
    const rows =
      await rt`select id::text as id from hub.runs where id = any(${rt.array(ALL(), 2950)})`;
    expect(rows.length).toBe(2);
  });
});
