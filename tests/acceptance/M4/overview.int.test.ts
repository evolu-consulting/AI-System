// ADM-FR-40, ADM-FR-51 · ui 7.2 · M4-R06, R09, R12 · Q5 · GET /admin/overview (test-plan O1–O6; M4-AC12, M4-AC13).
// Số kỳ vọng tính lại từ DB bằng owner ngay trước khi gọi (token login làm đổi last_login_at). Xanh ở T6.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  createM4Env,
  expectErr4,
  ID,
  ID3,
  inPrevMonth,
  insertUsage,
  type M4Env,
  num,
  parse4,
  resetNow,
  setQuota,
  TENANT_ID,
  verOf,
  vnMonth,
} from "./_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
});

const n = (q: string) => num(env.owner, q);
const binhOv = async () => {
  const call = env.by("acme", "binh");
  await env.token("acme", "binh");
  return call("GET", "/admin/overview");
};

describe("ui 7.2 · tổng quan tenant", () => {
  it("ADM-FR-51 · ui 7.2 · O1 · binh → kind tenant acme; active_users, groups đúng; never_logged_in ≤5, created_at giảm, chưa đăng nhập; _total đúng", async () => {
    await env.token("acme", "binh");
    const active = await n(
      `select count(*)::int as n from admin.users where tenant_id = '${A}' and active`,
    );
    const groups = await n(`select count(*)::int as n from admin.groups where tenant_id = '${A}'`);
    const never = await env.owner<{ username: string }[]>`select username from admin.users
      where tenant_id = ${A} and active and last_login_at is null order by created_at desc, id`;
    const res = await binhOv();
    expect(res.status).toBe(200);
    const b = parse4("OverviewResponseSchema", res.json);
    expect(b.kind).toBe("tenant");
    expect(b.tenant).toEqual({ id: A, key: "acme", name: "Acme Corp" });
    expect([b.active_users, b.groups]).toEqual([active, groups]);
    expect(b.never_logged_in_total).toBe(never.length);
    expect(b.never_logged_in.length).toBe(Math.min(5, never.length));
    const names = b.never_logged_in.map((u: { username: string }) => u.username);
    expect(names).not.toContain("binh");
    for (const u of names) expect(never.map((x) => x.username)).toContain(u);
    const at = b.never_logged_in.map((u: { created_at: string }) => Date.parse(u.created_at));
    expect([...at].sort((x, y) => y - x)).toEqual(at);
  });

  it("ADM-FR-40 · M4-R06 · O2 · binh 850/1000 → banner {warn,85}, quotas[0].level warn; runs_month 850, runs_prev_month từ tháng trước", async () => {
    await setQuota(env.owner, A, null, { runs: 1000 });
    await insertUsage(env.owner, 850, { tenant: A, runFrom: 0 });
    await insertUsage(env.owner, 7, { tenant: A, runFrom: 5000, at: inPrevMonth() });
    await insertUsage(env.owner, 30, { tenant: G, runFrom: 6000 });
    const b = parse4("OverviewResponseSchema", (await binhOv()).json);
    expect(b.banner).toEqual({ level: "warn", pct: 85, feature_key: null });
    expect(b.quotas[0]).toMatchObject({ feature_id: null, level: "warn", pct: 85 });
    expect([b.runs_month, b.runs_prev_month, b.has_usage_data]).toEqual([850, 7, true]);
  });

  it("ADM-FR-42 · M4-R09 · M4-AC13 · O3 · usage_logs rỗng → runs_month null, runs_prev_month null, has_usage_data false", async () => {
    const b = parse4("OverviewResponseSchema", (await binhOv()).json);
    expect([b.runs_month, b.runs_prev_month, b.has_usage_data]).toEqual([null, null, false]);
    expect(b.banner).toBeNull();
  });

  it("ADM-FR-51 · M4-R12 · O4 · recent_changes ≤8, chỉ tenant_id acme (sau khi admin sửa command + tạo group globex)", async () => {
    const v = await verOf(env, "commands", ID.command.tomTat);
    expect(
      (
        await env.as("PATCH", `/admin/commands/${ID.command.tomTat}`, {
          version: v,
          description: { vi: "O4" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await env.as("POST", `/admin/groups?tenant_id=${G}`, {
          key: "o4-globex",
          name: { vi: "O4" },
        })
      ).status,
    ).toBe(201);
    const binh = env.by("acme", "binh");
    for (const key of ["o4-a", "o4-b"])
      expect((await binh("POST", "/admin/groups", { key, name: { vi: key } })).status).toBe(201);
    const b = parse4("OverviewResponseSchema", (await binhOv()).json);
    expect(b.recent_changes.length).toBeGreaterThanOrEqual(2);
    expect(b.recent_changes.length).toBeLessThanOrEqual(8);
    expect(b.recent_changes.every((r: { tenant_id: string | null }) => r.tenant_id === A)).toBe(
      true,
    );
    expect(b.recent_changes[0].entity_name).toBe("o4-b");
  });

  it("ADM-BR-09 · M4-AC12 · O6 · an (member) → 403", async () => {
    expectErr4(await env.by("acme", "an")("GET", "/admin/overview"), "FORBIDDEN");
  });
});

describe("ui 7.2 · Q5 · tổng quan platform", () => {
  it("ADM-FR-40 · Q5 · O5 · admin → platform: đếm khớp DB; unavailable đủ 2; quota_tenants pct = max (40/90 → 90) giảm dần; runs_24h bỏ hàng 25 giờ trước, globex pct theo tháng VN (80|85); recent_changes có hàng NULL", async () => {
    await setQuota(env.owner, A, null, { runs: 100 });
    await setQuota(env.owner, A, ID.feature.keToan, { runs: 10 });
    await setQuota(env.owner, G, null, { runs: 100 });
    await insertUsage(env.owner, 40, { tenant: A, runFrom: 0 });
    await insertUsage(env.owner, 9, { tenant: A, feature: ID.feature.keToan, runFrom: 100 });
    await insertUsage(env.owner, 80, { tenant: G, runFrom: 200 });
    // 5 run lúc now − 25 h: ngoài runs_24h; pct theo tháng VN (plan §5.5) nên chỉ tính khi cùng tháng.
    const old25 = new Date(Date.now() - 25 * 3600_000);
    await insertUsage(env.owner, 5, { tenant: G, runFrom: 300, at: old25 });
    const globexPct = 80 + (vnMonth(old25) === vnMonth(new Date()) ? 5 : 0);
    const v = await verOf(env, "features", ID3.feature.phapChe);
    expect(
      (
        await env.as("PATCH", `/admin/features/${ID3.feature.phapChe}`, {
          version: v,
          status: "beta",
        })
      ).status,
    ).toBe(200);
    // plan-contract §2.3 chưa nói tenant `platform` có được đếm không → chấp nhận cả hai (Cần bổ sung: backend-lead)
    const tenantsExcl = await n(
      `select count(*)::int as n from admin.tenants where active and key <> 'platform'`,
    );
    const want = {
      commands_enabled: await n("select count(*)::int as n from admin.commands where enabled"),
      workflows_total: await n("select count(*)::int as n from admin.workflows"),
      workflows_unattached: await n(
        "select count(*)::int as n from admin.workflows w where not exists (select 1 from admin.commands c where c.workflow_id = w.id)",
      ),
    };
    const res = await env.as("GET", "/admin/overview");
    expect(res.status).toBe(200);
    const b = parse4("OverviewResponseSchema", res.json);
    expect(b.kind).toBe("platform");
    expect(b).toMatchObject(want);
    expect([tenantsExcl, tenantsExcl + 1]).toContain(b.tenants_active);
    expect(typeof b.users_active).toBe("number");
    expect([...b.unavailable].sort()).toEqual(["agent_studio", "command_errors"]);
    expect(b.runs_24h).toBe(49 + 80);
    expect(b.has_usage_data).toBe(true);
    const qt = b.quota_tenants as { tenant_key: string; pct: number; level: string }[];
    expect(qt.map((t) => [t.tenant_key, t.pct, t.level])).toEqual([
      ["acme", 90, "warn"],
      ["globex", globexPct, "warn"],
    ]);
    expect(b.recent_changes.length).toBeLessThanOrEqual(8);
    expect(b.recent_changes.some((r: { tenant_id: string | null }) => r.tenant_id === null)).toBe(
      true,
    );
  });
});
