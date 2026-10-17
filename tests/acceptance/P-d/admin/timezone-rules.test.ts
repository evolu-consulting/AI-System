// AC-A14 · ADM-FR-72 · ADM-FR-60 · TZ-R01…R05 · spec-tz-tools §1 · plan-contract §5 · test-plan §5 PD-C07: contract múi giờ
// tenant (`packages/contracts/src/tenants.ts`, `transfer.ts`). Nạp lỏng (`loadTenantsContract`/`tryLoad`) ⇒ export vắng = đỏ ở expect.
import { describe, expect, it } from "bun:test";
import { fn, loadTenantsContract, tryLoad } from "../_support/modules";
import { fieldOf, ok, schemaOf } from "../rules/_contracts";

const t = await loadTenantsContract();
const transfer = await tryLoad("packages/contracts/src/transfer.ts");

const TS = "2026-10-18T02:00:00.000Z";
const TZ_GOOD = ["Europe/Berlin", "Asia/Ho_Chi_Minh", "America/New_York", "UTC"];
const TZ_BAD = ["Asia/Saigon", "Mars/Base", "", "x".repeat(65), "europe/berlin"];

const createReq = (o: Record<string, unknown> = {}) => ({
  key: "acme-tz",
  name: "Acme TZ",
  first_admin: {
    username: "an.tz",
    display_name: "An TZ",
    email: "an.tz@acme.test",
  },
  ...o,
});
const tenant = (o: Record<string, unknown> = {}) => ({
  id: "d1a00000-0000-4000-8000-000000000001",
  key: "acme-tz",
  name: "Acme TZ",
  active: true,
  status: "active",
  max_concurrent_sub: null,
  user_count: 1,
  created_at: TS,
  updated_at: TS,
  version: 1,
  updated_by: null,
  ...o,
});

describe("PD-C07 · múi giờ tenant — contract [AC-A14, TZ-R01…R05]", () => {
  it("AC-A14 · TZ-R01 · PD-C07 · TENANT_TZ_DEFAULT = Asia/Ho_Chi_Minh", () => {
    expect(t.TENANT_TZ_DEFAULT).toBe("Asia/Ho_Chi_Minh");
  });
  it("AC-A14 · TZ-R02 · PD-C07 · isSupportedTimeZone: tên IANA chuẩn true; alias Asia/Saigon, Mars/Base, rỗng, 65 ký tự false", () => {
    const f = fn(t, "isSupportedTimeZone");
    expect(TZ_GOOD.map((z) => [z, f(z)])).toEqual(TZ_GOOD.map((z) => [z, true]));
    expect(TZ_BAD.map((z) => [z, f(z)])).toEqual(TZ_BAD.map((z) => [z, false]));
  });
  it("AC-A14 · TZ-R02 · PD-C07 · TimezoneInputSchema: Europe/Berlin nhận; Asia/Saigon, Mars/Base, '', 65 ký tự chặn; TimezoneSchema (response) chỉ kiểm độ dài 1…64", () => {
    const s = schemaOf(t, "TimezoneInputSchema");
    expect(TZ_GOOD.map((z) => [z, ok(s, z)])).toEqual(TZ_GOOD.map((z) => [z, true]));
    expect(TZ_BAD.map((z) => [z, ok(s, z)])).toEqual(TZ_BAD.map((z) => [z, false]));
    const r = schemaOf(t, "TimezoneSchema");
    expect(["Asia/Saigon", "", "x".repeat(64), "x".repeat(65)].map((z) => ok(r, z))).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });
  it("AC-A14 · TZ-R03 · PD-C07 · TenantCreateRequestSchema: vắng timezone ⇒ mặc định Asia/Ho_Chi_Minh; Europe/Berlin giữ; Asia/Saigon chặn", () => {
    const s = schemaOf(t, "TenantCreateRequestSchema");
    const r = s.safeParse(createReq());
    expect(r.success).toBe(true);
    expect(r.data?.timezone).toBe("Asia/Ho_Chi_Minh");
    expect(s.safeParse(createReq({ timezone: "Europe/Berlin" })).data?.timezone).toBe(
      "Europe/Berlin",
    );
    expect([
      ok(s, createReq({ timezone: "Asia/Saigon" })),
      ok(s, createReq({ timezone: "" })),
    ]).toEqual([false, false]);
  });
  it("AC-A14 · TZ-R03 · PD-C07 · TenantUpdateRequestSchema: timezone tuỳ chọn, kiểm như input", () => {
    const s = schemaOf(t, "TenantUpdateRequestSchema");
    expect([
      ok(s, { version: 1 }),
      ok(s, { version: 1, timezone: "Europe/Berlin" }),
      ok(s, { version: 1, timezone: "Mars/Base" }),
    ]).toEqual([true, true, false]);
  });
  it("AC-A14 · TZ-R01 · PD-C07 · TenantSchema / TenantDetailSchema có timezone (bắt buộc ở response)", () => {
    const s = schemaOf(t, "TenantSchema");
    expect([ok(s, tenant({ timezone: "Asia/Ho_Chi_Minh" })), ok(s, tenant())]).toEqual([
      true,
      false,
    ]);
    const tz = fieldOf(schemaOf(t, "TenantDetailSchema"), "timezone");
    expect([ok(tz, "Europe/Berlin"), ok(tz, undefined)]).toEqual([true, false]);
  });
  it("AC-A14 · TZ-R05 · PD-C07 · transfer TenantElSchema.timezone tuỳ chọn (vắng ⇒ giữ), sai ⇒ chặn", () => {
    const tz = fieldOf(schemaOf(transfer, "TenantElSchema"), "timezone");
    expect([ok(tz, undefined), ok(tz, "Europe/Berlin"), ok(tz, "Asia/Saigon")]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
