// AC-H46 · AC-A14 · HUB-FR-144 · ADM-FR-72 · TZ-R04 · K5 · test-plan-int §6 PD-I67 (`GET /process-editor/context`, plan-contract
// §4) + §8 PD-I87 (Hub đọc múi giờ tenant LÚC TẠO hẹn `wait_until`: sửa múi giờ ⇒ hẹn mới theo múi mới, hẹn cũ giữ).
// Đổi `admin.tenants.timezone` bằng owner như Admin (`adminChange`: UPDATE + bump + NOTIFY) — chỉ sau `needPdSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { adminChange } from "../../H1/_fixtures";
import {
  type CtxPd,
  createDef,
  type Json,
  needPdSchema,
  needWaitUntil,
  openTimers,
  PD_DEFS,
  startPd,
  startRun,
  T,
  waitFor,
} from "../_support/pd";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const setTz = (tid: string, tz: string) =>
  adminChange(
    c.sql,
    "tenant",
    tid,
    (tx) => tx`update admin.tenants set timezone = ${tz} where id = ${tid}`,
  );
const ctx = (r: "Adm" | "Db" | "P" | "A", qs = "") =>
  c.call(r, "GET", `/process-editor/context${qs}`);
const body = (res: { status: number; json: Json }) => ({
  status: res.status,
  json: res.status === 200 ? res.json : { code: res.json?.error?.code ?? null },
});

describe("AC-H46 · HUB-FR-144 · ngữ cảnh editor (múi giờ tenant)", () => {
  it("AC-H46 · PD-I67 · tadmin acme / tadmin_beta / padmin ?tenant_id=beta / padmin không tenant (mẫu) / lan ⇒ tz acme / tz beta / tz beta / TENANT_TZ_DEFAULT / 403", async () => {
    needPdSchema(c.pd);
    await setTz(T.beta, "Europe/Berlin");
    await setTz(T.platform, "Asia/Tokyo"); // padmin không tenant ⇒ mẫu ⇒ mặc định, KHÔNG phải tz tenant platform
    expect(body(await ctx("Adm"))).toEqual({ status: 200, json: { timezone: "Asia/Ho_Chi_Minh" } });
    expect(body(await ctx("Db"))).toEqual({ status: 200, json: { timezone: "Europe/Berlin" } });
    expect(body(await ctx("P", `?tenant_id=${T.beta}`))).toEqual({
      status: 200,
      json: { timezone: "Europe/Berlin" },
    });
    expect(body(await ctx("P"))).toEqual({ status: 200, json: { timezone: "Asia/Ho_Chi_Minh" } });
    expect(body(await ctx("A"))).toEqual({ status: 403, json: { code: "FORBIDDEN" } });
  });

  it("AC-H46 · PD-I67 · tadmin_beta truyền ?tenant_id=acme ⇒ vẫn tz tenant mình (không đọc tenant khác); tham số lạ ⇒ 400", async () => {
    needPdSchema(c.pd);
    await setTz(T.beta, "Europe/Berlin");
    expect(body(await ctx("Db", `?tenant_id=${T.acme}`))).toEqual({
      status: 200,
      json: { timezone: "Europe/Berlin" },
    });
    expect((await ctx("Adm", "?foo=1")).status).toBe(400);
  });
});

describe("AC-A14 · ADM-FR-72 · Hub dùng múi giờ tenant khi tạo hẹn", () => {
  it("AC-A14 · PD-I87 · sửa acme sang Europe/Berlin ⇒ hẹn wait_until MỚI theo Berlin (07:00Z), hẹn cũ giữ 02:00Z Asia/Ho_Chi_Minh", async () => {
    needPdSchema(c.pd);
    await needWaitUntil(c);
    await setTz(T.acme, "Asia/Ho_Chi_Minh");
    c.clk.set(new Date("2026-03-25T00:00:00.000Z"));
    await createDef(c, PD_DEFS.waitInput());
    const han = [{ type: "date", key: "han", value: "2026-04-01" }];
    const run1 = await startRun(c, "pd-wait-input", { inputs: han });
    const t1 = await waitFor(
      () => openTimers(c.sql, run1),
      (v) => v.length > 0,
      8_000,
    );
    const shape = (t: Json | undefined) => ({
      due: t ? new Date(t.due_at).toISOString() : null,
      tz: t?.timezone ?? null,
    });
    expect(shape(t1[0])).toEqual({ due: "2026-03-29T02:00:00.000Z", tz: "Asia/Ho_Chi_Minh" });
    await setTz(T.acme, "Europe/Berlin");
    const run2 = await startRun(c, "pd-wait-input", { inputs: han });
    const t2 = await waitFor(
      () => openTimers(c.sql, run2),
      (v) => v.length > 0,
      8_000,
    );
    expect(shape(t2[0])).toEqual({ due: "2026-03-29T07:00:00.000Z", tz: "Europe/Berlin" });
    expect(shape((await openTimers(c.sql, run1))[0])).toEqual({
      due: "2026-03-29T02:00:00.000Z",
      tz: "Asia/Ho_Chi_Minh",
    });
  }, 60_000);
});
