// REP-v3 · CR-101b (BA v2.0 §5.1, Câu 2; R23, R57, R61, R63, R71) · làn đầy đủ: cờ `REPUTATION_ENGINE` qua hub-api thật.
// Cờ TẮT (mặc định): V2-E chỉ đọc (410), HD8 lưu được, xem trước "N đối tác đổi mức nếu bật" đếm đúng và KHÔNG ghi. Cờ BẬT: ghi sao →
// điểm V2-E đổi; HD8 `PUT /scoring` 410; chỉnh tay ±10 410; cờ đỏ U2 trên bảng V2-E + TQ-04; chốt tháng → lịch sử. Chéo tenant: tenant
// khác không thấy đối tác / số xem trước của tenant này. Cờ đọc mỗi yêu cầu ⇒ test đổi `process.env` giữa các lời gọi.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2e,
  type CtxN1,
  call,
  contract,
  enc,
  type Json,
  milestones,
  ok,
  P,
  R,
  startHd1,
  startLock,
  T,
} from "../V2-E/_support/v2e";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  delete process.env.REPUTATION_ENGINE;
  await c?.stop();
});
afterEach(() => {
  delete process.env.REPUTATION_ENGINE;
});
const on = () => {
  process.env.REPUTATION_ENGINE = "v2e";
};

const A = "tax:0309000001";
/** NCC A dịch vụ: Giao đúng hạn 88,2 + serial 100 ⇒ V2-E 94 TỐT; HD8 chưa có sự kiện sổ ⇒ chưa có mức (MỚI). */
async function world() {
  await arrangeV2e(c);
  const a = await contract(c.sql, {
    deal: "buy",
    tax: "0309000001",
    name: "NCC An",
    group: "service",
  });
  await milestones(c.sql, a, A, [
    { kind: "delivery", done: -60, late: 5, fault: "partner" },
    { kind: "delivery", done: -240, late: 10, fault: "partner" },
    { kind: "delivery", done: -420, late: 3, fault: "ours" },
    { kind: "serial", done: -30 },
  ]);
}
const rate = (stars: number, reason?: string) => ({
  party: A,
  role: "supplier",
  group: "service",
  criterion: "on_time_delivery",
  stars,
  ...(reason ? { reason } : {}),
});
const rowA = async (p = P.hoa) =>
  (await ok(call(c, p, "GET", `${R}/partners?role=supplier`))).find((r: Json) => r.party === A);
const writes = async () => {
  const [n] = await c.sql<
    { n: number }[]
  >`select (select count(*) from contracts.score_ratings)::int
    + (select count(*) from contracts.score_configs_v2)::int + (select count(*) from contracts.score_locks)::int as n`;
  return n?.n;
};

describe("cờ TẮT (mặc định) · V2-E chỉ đọc + xem trước", () => {
  it("ghi /reputation 410; config báo engine hd8; xem trước: quản lý thấy 1 đối tác đổi mức, không ghi gì", async () => {
    await world();
    const r = await call(c, P.hoa, "POST", `${R}/ratings`, rate(1, "giao trễ liên tục"));
    expect([r.status, r.json?.error?.code]).toEqual([410, "REPUTATION_READ_ONLY"]);
    expect((await ok(call(c, P.hoa, "GET", `${R}/config`))).engine).toBe("hd8");
    expect((await call(c, P.hoa, "GET", `${R}/switch-preview`)).status).toBe(403);
    const pv = await ok(call(c, P.lan, "GET", `${R}/switch-preview`));
    const a = pv.items.find((i: Json) => i.party === A && i.role === "supplier");
    expect([pv.engine, pv.changed, pv.partners]).toEqual(["hd8", 1, 1]);
    expect([a.hd8.level, a.v2e.level, a.v2e.score]).toEqual(["new", "good", 94]);
    expect(pv.moves).toEqual([{ from: "new", to: "good", n: 1 }]);
    expect(await writes()).toBe(0);
  });
});

describe("cờ BẬT · V2-E hiện hành", () => {
  it("ghi sao lệch > 25 có lý do ⇒ điểm V2-E đổi (s = 20%); HD8 PUT /scoring 410; chỉnh tay ±10 410", async () => {
    await world();
    on();
    expect((await ok(call(c, P.hoa, "GET", `${R}/config`))).engine).toBe("v2e");
    expect((await rowA()).score).toBe(94);
    const noReason = await call(c, P.hoa, "POST", `${R}/ratings`, rate(1));
    expect(noReason.status).toBe(422);
    expect(
      (await call(c, P.hoa, "POST", `${R}/ratings`, rate(1, "giao trễ liên tục"))).status,
    ).toBe(201);
    const a = await rowA();
    expect([a.score, a.level, a.red_flag]).toEqual([79, "fair", false]); // 0,8 × 94,1 + 0,2 × 20
    const cfg = await ok(call(c, P.lan, "GET", "/scoring/customer"));
    const put = await call(c, P.lan, "PUT", "/scoring/customer", {
      criteria: cfg.criteria,
      rules: cfg.rules,
    });
    expect([put.status, put.json?.error?.code]).toEqual([410, "SCORING_READ_ONLY"]);
    const adj = await call(c, P.lan, "POST", "/partner-events", {
      party: A,
      role: "supplier",
      type: "manual_adjust",
      delta: 5,
      note: "thưởng",
    });
    expect([adj.status, adj.json?.error?.code]).toEqual([410, "ADJUST_REMOVED"]);
    delete process.env.REPUTATION_ENGINE; // tắt lại ⇒ ghi sao 410 ngay (không cần dựng lại)
    expect((await call(c, P.hoa, "POST", `${R}/ratings`, rate(5))).status).toBe(410);
  });

  it("cờ đỏ U2 trên bảng V2-E (không đổi điểm) + TQ-04 /attention; chốt tháng → lịch sử 3 tháng", async () => {
    await world();
    on();
    await ok(
      call(c, P.hoa, "POST", "/partner-events", {
        party: A,
        role: "supplier",
        type: "fraud",
        note: "Giả mạo chữ ký",
      }),
    );
    const a = await rowA();
    expect([a.score, a.level, a.red_flag, a.red_flags]).toEqual([
      94,
      "good",
      true,
      [{ type: "fraud", n: 1 }],
    ]);
    const att = await ok(call(c, P.hoa, "GET", `${R}/attention`));
    expect(att.map((x: Json) => [x.party, x.role, x.reasons])).toEqual([
      [A, "supplier", ["red_flag"]],
    ]);
    const lock = startLock(new Date().toISOString());
    try {
      expect(await lock.s.once(T.acme)).toBe(12);
    } finally {
      await lock.stop();
    }
    const h = await ok(
      call(c, P.tam, "GET", `${R}/history?party=${enc(A)}&role=supplier&months=3`),
    );
    expect([h.points.length, h.thresholds, h.current.score]).toEqual([
      3,
      { good_from: 85, fair_from: 70 },
      94,
    ]);
  });

  it("chéo tenant: tenant khác không thấy đối tác, cờ, số xem trước của tenant này", async () => {
    await world();
    on();
    expect((await ok(call(c, P.an, "GET", `${R}/partners`))).some((r: Json) => r.party === A)).toBe(
      false,
    );
    expect((await ok(call(c, P.an, "GET", `${R}/attention`))).length).toBe(0);
    const pv = await call(c, P.an, "GET", `${R}/switch-preview`);
    expect(pv.status === 403 || (pv.status === 200 && pv.json.total === 0)).toBe(true);
    expect((await call(c, P.an, "POST", `${R}/ratings`, rate(1, "x"))).status).toBe(404);
  });
});
