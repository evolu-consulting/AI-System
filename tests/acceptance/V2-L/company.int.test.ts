// V2-L · CD-01 · V2-A (cờ duyệt) · CD-06 thử tính · CD-02..05 mặc định: một đường chính mỗi endpoint mới (Luật 0b) + một test chặn đọc
// chéo tenant cho bảng `company_settings`. Hub-api THẬT in-process. Đỏ NGAY nếu thiếu migration 0034.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2a,
  type CtxN1,
  call,
  ok,
  P,
  restoreApproval,
  startHd1,
  T,
} from "../V2-A/_support/v2a";

const C = "/company";
let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
  const [r] = await c.sql<
    { t: boolean }[]
  >`select to_regclass('contracts.company_settings') is not null as t`;
  expect({ v2l_migration_0034: r }).toEqual({ v2l_migration_0034: { t: true } });
}, 120_000);
afterAll(async () => {
  if (c) {
    await c.sql`delete from contracts.company_settings`;
    await restoreApproval(c.sql);
  }
  await c?.stop();
});

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const body = (o: Record<string, unknown> = {}) => ({
  name: "NITI GROUP",
  app_name: "Sổ Hợp Tác",
  logo: PNG,
  accent: "teal",
  theme: "dark",
  own_names: ["NITI GROUP", "Công ty CP Niti"],
  own_tax_ids: ["0312345678", "0312345678-001"],
  approval_enabled: false,
  ...o,
});

describe("V2-L · cài đặt công ty", () => {
  it("GET mặc định → quản lý PUT → đọc lại (mọi người); cờ duyệt đổi có nhật ký; sai ⇒ 400/403/422", async () => {
    await arrangeV2a(c);
    await c.sql`delete from contracts.company_settings`;
    const g = await ok(call(c, P.hoa, "GET", C));
    expect(g.company).toEqual({
      name: null,
      app_name: null,
      logo: null,
      accent: "indigo",
      theme: "auto",
      own_names: [],
      own_tax_ids: [],
    });
    expect(g.version).toBe(0);
    expect(g.approval_enabled).toBe(g.defaults.approval_enabled);

    expect((await call(c, P.tam, "PUT", C, body())).status).toBe(403);
    expect((await call(c, P.lan, "PUT", C, body({ accent: "pink" }))).status).toBe(400);
    expect(
      (
        await call(
          c,
          P.lan,
          "PUT",
          C,
          body({ logo: `data:image/png;base64,${"A".repeat(1_450_000)}` }),
        )
      ).status,
    ).toBe(400);
    expect((await call(c, P.lan, "PUT", C, body({ logo: "https://x.test/a.png" }))).status).toBe(
      400,
    );
    expect(
      (await call(c, P.lan, "PUT", C, body({ own_tax_ids: ["0312345678", "0312345678"] }))).status,
    ).toBe(422);

    const flipped = !g.approval_enabled;
    const s = await ok(call(c, P.lan, "PUT", C, body({ approval_enabled: flipped })));
    expect([s.company.accent, s.company.own_tax_ids.length, s.approval_enabled, s.version]).toEqual(
      ["teal", 2, flipped, 1],
    );
    const r = await ok(call(c, P.hoa, "GET", C));
    expect(r.company).toMatchObject({ name: "NITI GROUP", logo: PNG, theme: "dark" });
    expect(r.approval_enabled).toBe(flipped);
    const [a] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.approval_settings_audit
      where tenant_id = ${T.acme} and (after ->> 'approval_enabled')::boolean = ${flipped}`;
    expect(a?.n).toBe(1);
    const again = await ok(call(c, P.lan, "PUT", C, body({ approval_enabled: flipped, name: "" })));
    expect([again.company.name, again.version]).toEqual([null, 2]);
  });

  it("tenant khác không thấy cài đặt công ty của acme (RLS)", async () => {
    await call(c, P.lan, "PUT", C, body());
    const other = await ok(call(c, P.an, "GET", C));
    expect(other.company.name).toBeNull();
    expect(other.version).toBe(0);
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.company_settings where tenant_id = ${T.acme}`;
    expect(n?.n).toBe(1);
  });
});

describe("V2-L · thử tính điểm kinh doanh + mặc định uy tín", () => {
  it("POST /business/config/preview: điểm + đề xuất theo cấu hình đang chỉnh; ngưỡng sai 422", async () => {
    const cfg = (await ok(call(c, P.hoa, "GET", "/business/config"))).config;
    const sample = {
      kind: "stock",
      held: 120,
      l3: 90,
      p3: 60,
      cost: 90_000,
      price: 120_000,
      dte: 200,
    };
    const r = await ok(call(c, P.hoa, "POST", "/business/config/preview", { config: cfg, sample }));
    expect(r.score).toBeGreaterThan(0);
    expect(["buy", "hold", "dump"]).toContain(r.suggestion);
    expect(r.factors.map((f: { key: string }) => f.key)).toEqual(["rot", "margin", "trend"]);
    const bad = { config: { ...cfg, lo: 70, hi: 60 }, sample };
    expect((await call(c, P.hoa, "POST", "/business/config/preview", bad)).status).toBe(422);
  });

  it("GET /reputation/config kèm mặc định BA của 5 ô, cài đặt chung và Loại việc", async () => {
    const r = await ok(call(c, P.hoa, "GET", "/reputation/config"));
    expect(Object.keys(r.defaults.cells).sort()).toEqual([
      "goods:customer",
      "goods:supplier",
      "referral:commission_payer",
      "service:customer",
      "service:supplier",
    ]);
    expect(r.defaults.settings.good_from).toBe(85);
    expect(r.defaults.job_types.length).toBeGreaterThan(0);
  });
});
