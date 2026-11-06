// CR-121 R6 · c16 · int: "Dùng bởi" + "Công ty dùng" của trang Công cụ AI qua admin-api thật (RLS admin_api).
// (1) đường chính + số câu SQL cố định khi thêm 20 workflow; (2) vai khác platform_admin ⇒ 403 cả hai route.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AiToolUsageListSchema, WorkflowCompanyListSchema } from "@ai/contracts/workflow-tools";
import { createDb, withScope } from "@ai/db";
import { probe, probeSamples, resetProbe, setProbe } from "@ai/db/probe";
import { ADMIN_API_URL } from "../../../../../tests/acceptance/M1/_fixtures";
import { createM4Env, type M4Env, TENANT_ID } from "../../../../../tests/acceptance/M4/_ab";
import { USAGE_QUERIES, workflowToolsRepo } from "./adapters/workflow-tools.repo";

let env: M4Env;
beforeAll(async () => {
  env = await createM4Env();
}, 60_000);
afterAll(async () => {
  await env?.close();
});

const admin = (m: string, p: string, b?: unknown) => env.by("platform", "admin")(m, p, b);
const A = TENANT_ID.acme;

describe("c16 · Dùng bởi + Công ty dùng (platform_admin)", () => {
  it("đọc theo tập: usage khớp số lệnh thật, bật một công ty ⇒ company_count 1 + companies on; số câu SQL không theo số công cụ", async () => {
    const [w] = await env.owner<
      { id: string; key: string }[]
    >`select id, key from admin.workflows order by key limit 1`;
    if (!w) throw new Error("fixture: admin.workflows rỗng");
    await env.owner`delete from admin.tenant_workflow_tools where workflow_id = ${w.id}`;

    const before = await admin("GET", "/admin/workflow-tools/usage");
    expect(before.status).toBe(200);
    const list = AiToolUsageListSchema.parse(before.json);
    const mine = list.items.find((i) => i.workflow_id === w.id);
    const [cmd] = await env.owner<
      { n: number }[]
    >`select count(*)::int as n from admin.commands where workflow_id = ${w.id}`;
    expect(mine).toMatchObject({ company_count: 0, command_count: cmd?.n ?? 0 });

    expect((await admin("PUT", `/admin/tenants/${A}/workflow-tools/${w.id}`, {})).status).toBe(200);
    const after = AiToolUsageListSchema.parse(
      (await admin("GET", "/admin/workflow-tools/usage")).json,
    );
    expect(after.items.find((i) => i.workflow_id === w.id)?.company_count).toBe(1);

    const cs = await admin("GET", `/admin/workflow-tools/${w.id}/companies`);
    expect(cs.status).toBe(200);
    const companies = WorkflowCompanyListSchema.parse(cs.json).items;
    expect(companies.find((c) => c.tenant_id === A)).toMatchObject({ on: true });
    expect(companies.filter((c) => c.on)).toHaveLength(1);
    expect(
      (await admin("GET", `/admin/workflow-tools/${crypto.randomUUID()}/companies`)).status,
    ).toBe(404);

    // Số câu SQL: đo usage() trước và sau khi thêm 20 workflow — phải bằng nhau (≤ USAGE_QUERIES + câu đặt scope).
    const sqlOf = async () => {
      setProbe(true);
      resetProbe();
      const db = createDb(ADMIN_API_URL, { max: 2 });
      try {
        await probe("usage", () =>
          withScope(db, { kind: "platform" }, (tx) => workflowToolsRepo(tx).usage(200)),
        );
      } finally {
        await db.close();
        setProbe(false);
      }
      return probeSamples().at(-1)?.sql ?? -1;
    };
    const n1 = await sqlOf();
    await env.owner`insert into admin.workflows (key, name, description, app_type, base_url, secret_id)
      select 'xt-' || g, 'Công cụ thử ' || g, repeat('m', 30), 'workflow', 'https://dify.test/v1', w.secret_id
      from generate_series(1, 20) g, admin.workflows w where w.id = ${w.id}`;
    const n2 = await sqlOf();
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(n1);
    expect(n1).toBeLessThanOrEqual(USAGE_QUERIES + 2); // + các câu đặt scope RLS của withScope (đo: 4 tổng)
  });

  it("vai khác platform_admin (tenant_admin) ⇒ 403 cả usage lẫn companies", async () => {
    const tadmin = env.by("acme", "binh");
    const id = crypto.randomUUID();
    expect((await tadmin("GET", "/admin/workflow-tools/usage")).status).toBe(403);
    expect((await tadmin("GET", `/admin/workflow-tools/${id}/companies`)).status).toBe(403);
  });
});
