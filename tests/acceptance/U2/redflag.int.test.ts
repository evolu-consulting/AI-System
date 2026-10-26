// CR-097 U2 · R36 · R39 · UT-FR-13 · cờ đỏ + "MỚI · tạm tính" qua hub-api thật (đường chính + chặn chéo tenant). VIẾT, CHƯA CHẠY (Luật 0b:
// int chạy một lần ở cuối đợt). Ghi cờ: quyền `write` + lý do bắt buộc; gỡ cờ: chỉ `admin` + lý do; cờ tách khỏi điểm; tenant khác không thấy/ghi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  ago,
  arrangeHd8,
  type CtxN1,
  call,
  deal,
  type Json,
  ok,
  P,
  record,
  startHd1,
  T,
} from "../HD8/_support/hd8";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const GOOD = "tax:0388888888";
const NEWP = "tax:0399999999";
const NONE = "tax:0300000001";
const byParty = (rows: Json[], party: string): Json =>
  rows.find((p: Json) => p.party === party) as Json;

async function world() {
  await arrangeHd8(c);
  await deal(c.sql, { sale: true, partner: "Khách Đủ Việc", tax: "0388888888", number: "U2-1" });
  await deal(c.sql, { sale: true, partner: "Khách Mới", tax: "0399999999", number: "U2-2" });
  await deal(c.sql, { sale: true, partner: "Khách Chưa Việc", tax: "0300000001", number: "U2-3" });
  for (let i = 0; i < 5; i++)
    await record(c.sql, T.acme, GOOD, "customer", "received", ago(10 + 20 * i));
  for (let i = 0; i < 2; i++)
    await record(c.sql, T.acme, NEWP, "customer", "received", ago(5 + 10 * i));
}

describe("U2-R36 · MỚI · tạm tính", () => {
  it("1…min_events−1 việc ⇒ score null + provisional + điểm tạm; 0 việc ⇒ không tạm; đủ việc ⇒ điểm thường", async () => {
    await world();
    const rows: Json[] = await ok(call(c, P.lan, "GET", "/partners"));
    const good = byParty(rows, GOOD);
    const mid = byParty(rows, NEWP);
    const none = byParty(rows, NONE);
    expect([good.provisional, good.provisional_score, typeof good.score]).toEqual([
      false,
      null,
      "number",
    ]);
    expect([mid.score, mid.provisional, typeof mid.provisional_score]).toEqual([
      null,
      true,
      "number",
    ]);
    expect([none.score, none.provisional, none.provisional_score]).toEqual([null, false, null]);
  });
});

describe("U2-R39 · cờ đỏ (không giao / gian lận)", () => {
  it("ghi cần lý do; cờ hiện bất kể min_events, không đổi điểm; gỡ cờ chỉ admin + lý do", async () => {
    await world();
    const before: Json[] = await ok(call(c, P.lan, "GET", "/partners"));
    const body = { party: GOOD, role: "customer", type: "fraud" };
    expect((await call(c, P.tam, "POST", "/partner-events", { ...body, note: "x" })).status).toBe(
      403,
    );
    const bad = await call(c, P.hoa, "POST", "/partner-events", body);
    expect([bad.status, bad.json?.error?.code]).toEqual([422, "SEVERE_REASON"]);
    const ev = await ok(
      call(c, P.hoa, "POST", "/partner-events", { ...body, note: "Giả mạo chữ ký" }),
    );
    expect([ev.type, ev.note]).toEqual(["fraud", "Giả mạo chữ ký"]);
    // đối tác MỚI (chưa đủ việc) cũng bị cờ
    await ok(
      call(c, P.hoa, "POST", "/partner-events", {
        party: NEWP,
        role: "customer",
        type: "no_delivery",
        note: "Không giao đợt 1",
      }),
    );

    const after: Json[] = await ok(call(c, P.lan, "GET", "/partners"));
    const g = byParty(after, GOOD);
    expect([g.red_flag, g.red_flags, g.score]).toEqual([
      true,
      [{ type: "fraud", n: 1 }],
      byParty(before, GOOD).score,
    ]);
    expect(byParty(after, NEWP).red_flag).toBe(true);
    expect(byParty(after, NONE).red_flag).toBe(false);

    // gỡ cờ
    expect(
      (await call(c, P.hoa, "POST", `/partner-events/${ev.id}/void`, { reason: "nhầm" })).status,
    ).toBe(403);
    const noReason = await call(c, P.lan, "POST", `/partner-events/${ev.id}/void`, {});
    expect([noReason.status, noReason.json?.error?.code]).toEqual([422, "SEVERE_REASON"]);
    await ok(
      call(c, P.lan, "POST", `/partner-events/${ev.id}/void`, { reason: "Đã xác minh nhầm lẫn" }),
    );
    const cleared: Json[] = await ok(call(c, P.lan, "GET", "/partners"));
    expect(byParty(cleared, GOOD).red_flag).toBe(false);
    const [v] =
      await c.sql`select reason, by_user from contracts.partner_event_voids where event_id = ${ev.id}`;
    expect([v?.reason, v?.by_user]).toEqual(["Đã xác minh nhầm lẫn", P.lan.id]);
  });

  it("chéo tenant: tenant khác không thấy cờ, không ghi được lên đối tác của tenant này", async () => {
    await world();
    await ok(
      call(c, P.hoa, "POST", "/partner-events", {
        party: GOOD,
        role: "customer",
        type: "fraud",
        note: "gian lận",
      }),
    );
    expect(await ok(call(c, P.an, "GET", "/partners"))).toEqual([]);
    expect(
      await ok(call(c, P.an, "GET", `/partner-events?party=${encodeURIComponent(GOOD)}`)),
    ).toEqual([]);
    const x = await call(c, P.an, "POST", "/partner-events", {
      party: GOOD,
      role: "customer",
      type: "no_delivery",
      note: "thử",
    });
    expect(x.status).toBe(404);
    const [n] = await c.sql`select count(*)::int as n from contracts.partner_events
      where tenant_id = ${T.beta} and type in ('fraud', 'no_delivery')`;
    expect(n?.n).toBe(0);
  });
});
