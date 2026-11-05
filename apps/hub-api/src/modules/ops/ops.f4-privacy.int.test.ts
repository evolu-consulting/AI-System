// CR-121 F-4 · quyền hẹp sau review cuối đợt: (1) hub_ro không đọc `admin.tenants.profile` (PII, admin 0036);
// (2) hub_rw không đọc metadata Dify của mọi công ty — chỉ qua hàm DEFINER trả số đếm (hub 0102, view `dify_run_stats` đã gỡ);
// (3) FK `process_runs.rerun_of` đổi ON DELETE SET NULL (hub 0102). Role đặt bằng `set_config('role', …)` như đường chạy thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { asRole, cloneDb, openOwner, pgCode, type Sql } from "@ai/test-kit/db";

let o: Sql;
const T = "f4000000-0000-4000-8000-000000000001";
const W1 = "f4000000-0000-4000-8000-0000000000a1"; // ok → failed → failed: 3 lần gần nhất KHÔNG toàn lỗi
const W2 = "f4000000-0000-4000-8000-0000000000a2"; // failed ×3: chuỗi lỗi
const W3 = "f4000000-0000-4000-8000-0000000000a3"; // 1 lỗi cách đây 10 ngày: ngoài cửa sổ

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into hub.dify_runs (tenant_id, workflow_id, trigger, status, created_at)
    select ${T}::uuid, x.w::uuid, 'command', x.s, now() - x.h * interval '1 hour'
    from jsonb_to_recordset(${o.json([
      { w: W1, s: "ok", h: 3 },
      { w: W1, s: "failed", h: 2 },
      { w: W1, s: "failed", h: 1 },
      { w: W2, s: "failed", h: 3 },
      { w: W2, s: "failed", h: 2 },
      { w: W2, s: "failed", h: 1 },
      { w: W3, s: "failed", h: 240 },
    ])}) as x(w text, s text, h float8)`;
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("CR-121 F-4 · hub_ro × admin.tenants.profile (admin 0036)", () => {
  it("đọc cột profile (kể cả select *) bị từ chối, cột còn lại vẫn đọc được", async () => {
    const deny = (q: (tx: Sql) => Promise<unknown>) => pgCode(() => asRole("hub_ro", null, q));
    expect(await deny((tx) => tx`select profile from admin.tenants limit 1`)).toBe("42501");
    expect(await deny((tx) => tx`select * from admin.tenants limit 1`)).toBe("42501");
    expect(
      await deny(
        (tx) => tx`select id, key, name, active, timezone, default_app from admin.tenants limit 1`,
      ),
    ).toBeNull();
  });
});

describe("CR-121 F-4 · Dify chỉ qua hàm đếm (hub 0102)", () => {
  it("hub_rw không đọc dify_runs, view cũ đã gỡ, dify_run_counts chỉ trả số đếm đúng", async () => {
    const rw = (q: (tx: Sql) => Promise<unknown>) => pgCode(() => asRole("hub_rw", null, q));
    expect(await rw((tx) => tx`select 1 from hub.dify_runs limit 1`)).toBe("42501");
    expect(await rw((tx) => tx`select 1 from hub.dify_run_stats limit 1`)).toBe("42P01");
    const rows = await asRole(
      "hub_rw",
      null,
      (tx) =>
        tx<{ workflow_id: string; status: string; n: number }[]>`
          select workflow_id::text, status, n::int as n from hub.dify_run_counts(now() - interval '1 day')
          where workflow_id = any(${[W1, W2, W3]}::uuid[]) order by workflow_id, status`,
    );
    expect(rows.map((r) => [r.workflow_id, r.status, r.n])).toEqual([
      [W1, "failed", 2],
      [W1, "ok", 1],
      [W2, "failed", 3],
    ]); // W3 (10 ngày trước) ngoài cửa sổ
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["n", "status", "workflow_id"]);
    const [f] = await asRole(
      "hub_rw",
      null,
      (tx) =>
        tx<{ n: number }[]>`select hub.dify_failing_tool_count(now() - interval '1 day', 3) as n`,
    );
    expect(f?.n).toBe(1); // chỉ W2
  });

  it("hub_ro không gọi được hàm đếm (chỉ hub_rw được EXECUTE)", async () => {
    expect(
      await pgCode(() =>
        asRole(
          "hub_ro",
          null,
          (tx) => tx`select * from hub.dify_run_counts(now() - interval '1 day')`,
        ),
      ),
    ).toBe("42501");
  });
});

describe("CR-121 F-4 · process_runs.rerun_of (hub 0102)", () => {
  it("FK đổi sang ON DELETE SET NULL (đã VALIDATE)", async () => {
    const [r] = await o<{ del: string; validated: boolean }[]>`
      select confdeltype::text as del, convalidated as validated from pg_constraint
      where conname = 'process_runs_rerun_of_fk' and conrelid = 'hub.process_runs'::regclass`;
    expect(r).toEqual({ del: "n", validated: true });
  });
});
