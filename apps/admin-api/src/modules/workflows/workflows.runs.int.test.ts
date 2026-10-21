// dify-workflows · int đường chính GET /admin/workflows/:id/runs (service, DB đầy đủ Admin + Hub, role admin_api thật):
// chỉ lượt của workflow được hỏi, phân trang + total, lọc tenant/status/ngày, link Dify (DIFY_CONSOLE_URL), console_url ở list,
// usage lọc theo workflow. Chặn tenant_admin: 403 qua HTTP ở `workflows.runs.http.int.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DifyRunsResponseSchema } from "@ai/contracts";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls, withCreds } from "@ai/test-kit/env";
import { getUsage } from "../usage/usage.service";
import { listWorkflowRuns } from "./workflows.runs";
import type { Call } from "./workflows.service";
import { listWorkflows } from "./workflows.service";

const id = (n: number) => `a5100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TA = id(1);
const TB = id(2);
const UA = id(11);
const UB = id(12);
const SEC = id(21);
const WF = id(31);
const OTHER = id(32);
const APP = "0b9f2c1e-1111-4222-8333-444455556666";
const CONSOLE = "https://dify.example.com";

let owner: Sql;
let db: Db;
const call = (difyConsoleUrl: string | null = CONSOLE): Call => ({
  ctx: { db, difyConsoleUrl },
  actor: { userId: UA, tenantId: TA, tenantKey: "acme", role: "platform_admin", sid: null },
  scope: { kind: "platform" },
});

async function seed(o: Sql): Promise<void> {
  await o`insert into admin.tenants (id, key, name) values (${TA}, 'acme', 'Acme'), (${TB}, 'globex', 'Globex')`;
  await o`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
    values (${UA}, ${TA}, 'binh', 'x', 'Binh', 'platform_admin'), (${UB}, ${TB}, 'hoa', 'x', 'Hoa', 'member')`;
  await o`insert into admin.secrets (id, name, ciphertext, iv, last4)
    values (${SEC}, 'K_EY', ${Buffer.alloc(32)}, ${Buffer.alloc(12)}, 'abcd')`;
  for (const [wid, key, type, app] of [
    [WF, "translate", "workflow", APP],
    [OTHER, "other", "chat", null],
  ] as const)
    await o`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id, dify_app_id)
      values (${wid}, ${key}, ${key}, ${"d".repeat(30)}, ${type}, 'https://dify.test/v1', ${SEC}, ${app})`;
  // 25 lượt của WF (acme 15 / globex 10; lỗi mỗi 5 lượt) + 3 lượt của workflow khác (không được lọt vào).
  for (let i = 0; i < 25; i++) {
    const t = i < 15 ? TA : TB;
    const failed = i % 5 === 0;
    await o`insert into hub.dify_runs (tenant_id, user_id, workflow_id, trigger, status, duration_ms, input_tokens,
        output_tokens, error_message, dify_workflow_run_id, dify_conversation_id, created_at)
      values (${t}, ${t === TA ? UA : UB}, ${WF}, ${i % 2 === 0 ? "command" : "agent"},
        ${failed ? "failed" : "ok"}, ${100 + i}, 10, 5, ${failed ? "HTTP 500 boom" : null}, ${`wr-${i}`},
        ${i % 2 === 0 ? null : `conv-${i}`}, now() - make_interval(mins => ${25 - i}))`;
  }
  await o`insert into hub.dify_runs (tenant_id, workflow_id, trigger, status) values
    (${TA}, ${OTHER}, 'command', 'ok'), (${TA}, ${OTHER}, 'command', 'ok'), (${TB}, ${OTHER}, 'agent', 'ok')`;
}

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  db = createDb(withCreds(urls().owner, "admin_api", "admin_api_dev_pw"), { max: 2 });
  await seed(owner);
});
afterAll(async () => {
  await db.close();
  await owner.end({ timeout: 1 });
});

const q = (o: Record<string, unknown> = {}) => ({ limit: 20, offset: 0, ...o }) as never;

describe("dify-workflows · lịch sử chạy", () => {
  it("chỉ lượt của workflow được hỏi; sắp mới → cũ; phân trang có total; trường đủ + link log Dify", async () => {
    const p1 = DifyRunsResponseSchema.parse(await listWorkflowRuns(call(), WF, q()));
    expect(p1.available).toBe(true);
    expect(p1.total).toBe(25);
    expect(p1.items).toHaveLength(20);
    expect(p1.items[0]).toMatchObject({
      tenant: { id: TB, name: "Globex" },
      user: { id: UB, name: "hoa" },
      trigger: "command",
      status: "ok",
      duration_ms: 124,
      tokens: 15,
      dify_workflow_run_id: "wr-24",
      dify_conversation_id: null,
      dify_url: `${CONSOLE}/app/${APP}/logs`,
    });
    const times = p1.items.map((r) => Date.parse(r.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const p2 = await listWorkflowRuns(call(), WF, q({ offset: 20 }));
    expect(p2.items).toHaveLength(5);
    expect(p2.total).toBe(25);
  });

  it("lọc tenant / status / ngày; thông báo lỗi và id hội thoại được trả; không đặt console ⇒ dify_url null", async () => {
    const acme = await listWorkflowRuns(call(null), WF, q({ tenant_id: TA }));
    expect(acme.total).toBe(15);
    expect(acme.items.every((r) => r.tenant.id === TA && r.dify_url === null)).toBe(true);
    const failed = await listWorkflowRuns(call(), WF, q({ status: "failed" }));
    expect(failed.total).toBe(5);
    expect(failed.items.every((r) => r.error_message === "HTTP 500 boom")).toBe(true);
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    expect(
      (await listWorkflowRuns(call(), WF, q({ from: today, to: today }))).total,
    ).toBeGreaterThan(0);
    expect((await listWorkflowRuns(call(), WF, q({ to: "2000-01-01" }))).total).toBe(0);
    const conv = (await listWorkflowRuns(call(), WF, q({ tenant_id: TA }))).items.find(
      (r) => r.dify_conversation_id,
    );
    expect(conv?.dify_conversation_id).toMatch(/^conv-/);
  });

  it("workflow không tồn tại → NOT_FOUND", async () => {
    const err = await listWorkflowRuns(call(), id(99), q()).catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe("NOT_FOUND");
  });

  it("list workflows có console_url theo loại app (workflow → /workflow, chat → /configuration), ẩn khi thiếu mã app/gốc", async () => {
    const withBase = (await listWorkflows(call(), { limit: 50, offset: 0 })).items;
    expect(withBase.find((w) => w.key === "translate")?.console_url).toBe(
      `${CONSOLE}/app/${APP}/workflow`,
    );
    expect(withBase.find((w) => w.key === "other")?.console_url).toBeNull();
    const none = (await listWorkflows(call(null), { limit: 50, offset: 0 })).items;
    expect(none.every((w) => w.console_url === null)).toBe(true);
  });

  it("usage lọc theo workflow: chỉ tính dòng usage có step_id của lượt Dify workflow đó; tenant_admin → FORBIDDEN", async () => {
    const run = id(41);
    const s1 = id(42);
    const s2 = id(43);
    await owner`insert into hub.dify_runs (tenant_id, workflow_id, run_id, step_id, trigger, status)
      values (${TA}, ${WF}, ${run}, ${s1}, 'command', 'ok'), (${TA}, ${OTHER}, ${run}, ${s2}, 'command', 'ok')`;
    await owner`insert into hub.usage_logs (tenant_id, run_id, step_id, provider_key, billing, input_tokens, output_tokens)
      values (${TA}, ${run}, ${s1}, 'dify', 'dify', 100, 20), (${TA}, ${run}, ${s2}, 'dify', 'dify', 7, 3)`;
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const base = { from: today, to: today, tenant_id: TA };
    const ctx = { db, now: () => new Date() };
    const mk = (role: "platform_admin" | "tenant_admin") => ({
      ctx,
      actor: { userId: UA, tenantId: TA, tenantKey: "acme", role, sid: null },
      scope:
        role === "platform_admin"
          ? ({ kind: "platform" } as const)
          : ({ kind: "tenant", tenantId: TA } as const),
    });
    const all = await getUsage(mk("platform_admin"), base);
    const one = await getUsage(mk("platform_admin"), { ...base, workflow_id: WF });
    expect(one.kpi.tokens).toBe(120);
    expect(all.kpi.tokens).toBeGreaterThan(one.kpi.tokens);
    const denied = await getUsage(mk("tenant_admin"), { ...base, workflow_id: WF }).catch(
      (e: unknown) => e,
    );
    expect((denied as { code?: string }).code).toBe("FORBIDDEN");
  });
});
