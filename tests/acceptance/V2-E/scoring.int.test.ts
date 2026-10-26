// V2-E · BA v2 §5.1 (4 bước) · DT-01/02 · CD-02..05 · CR-096 Q1: uy tín v2 qua hub-api thật — công thức BA trên 3 việc mẫu theo độ
// cũ, chỉ lỗi đối tác trừ điểm, khoảng tính theo nhóm, MỚI < 3 việc, điểm vai theo giá trị nhóm, chi tiết từng việc, cấu hình chỉ
// quản lý + thử tính không ghi + đổi cấu hình đổi điểm hiện tại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2e,
  board,
  type CtxN1,
  call,
  contract,
  type Json,
  milestones,
  ok,
  P,
  partner,
  R,
  startHd1,
} from "./_support/v2e";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const A = "tax:0301000001";
const B = "tax:0301000002";
const C = "tax:0301000003";
const D = "tax:0301000004";

/** NCC A (dịch vụ có hạn): 3 mốc giao 2 / 8 / 14 tháng trước — trễ 5 ngày lỗi đối tác, trễ 10 ngày lỗi đối tác, trễ 3 ngày lỗi mình
 * ⇒ điểm việc 90 / 80 / 100, h = 1 / 0,5 / 0,2 ⇒ Giao đúng hạn = (90 + 40 + 20) / 1,7 = 88,2; + 1 mốc cấp serial đúng hạn (100) + 1
 * mốc việc của mình (chỉ là giao dịch). */
async function world() {
  await arrangeV2e(c);
  const a = await contract(c.sql, {
    deal: "buy",
    tax: "0301000001",
    name: "NCC Minh An",
    group: "service",
  });
  await milestones(c.sql, a, A, [
    { kind: "delivery", done: -60, late: 5, fault: "partner" },
    { kind: "delivery", done: -240, late: 10, fault: "partner" },
    { kind: "delivery", done: -420, late: 3, fault: "ours" },
    { kind: "serial", done: -30 },
    { kind: "other", owner: "ours", done: -20 },
  ]);
  const b = await contract(c.sql, {
    deal: "sell",
    tax: "0301000002",
    name: "Khách Bình",
    group: "goods",
  });
  await milestones(c.sql, b, B, [
    { kind: "payment", done: -10 },
    { kind: "payment", done: -400 }, // ngoài khoảng 12 tháng của hàng hoá
  ]);
  await contract(c.sql, { deal: "referral", tax: "0301000003", name: "Bên HH Cúc" });
  return { a };
}

describe("V2-E §5.1 · công thức BA qua API", () => {
  it("3 việc mẫu theo độ cũ; chỉ lỗi đối tác trừ; điểm dữ liệu bỏ tiêu chí trống; mức TỐT ≥ 85", async () => {
    await world();
    const rows = await board(c);
    const a = rows.find((r: Json) => r.party === A);
    expect([a.name, a.role, a.score, a.level, a.jobs]).toEqual([
      "NCC Minh An",
      "supplier",
      94,
      "good",
      4,
    ]);
    const g = a.groups[0];
    expect([g.group, g.data_score, g.stars]).toEqual(["service", 94, null]);
    const one = await partner(c, A, "supplier", P.tam);
    const cr = Object.fromEntries(one.groups[0].criteria.map((x: Json) => [x.key, x.score]));
    expect(cr).toEqual({
      on_time_delivery: 88,
      serial: 100,
      incident: null,
      price_hold: null,
      quality: null,
    });
    const items = one.items.filter((i: Json) => i.criterion === "on_time_delivery");
    expect(items.map((i: Json) => [i.score, i.h, i.late_days, i.fault])).toEqual([
      [90, 1, 5, "partner"],
      [80, 0.5, 10, "partner"],
      [100, 0.2, 3, "ours"],
    ]);
  });

  it("khoảng tính theo nhóm (hàng hoá 12 th); < 3 việc ⇒ MỚI; HĐ chưa có mốc ⇒ MỚI, chưa có điểm; vai bên trả HH", async () => {
    await world();
    const rows = await board(c);
    const b = rows.find((r: Json) => r.party === B);
    expect([b.role, b.score, b.level, b.jobs]).toEqual(["customer", 100, "new", 1]);
    const cc = rows.find((r: Json) => r.party === C);
    expect([cc.role, cc.score, cc.level, cc.groups[0].group]).toEqual([
      "commission_payer",
      null,
      "new",
      "referral",
    ]);
    expect((await board(c, "?role=customer")).map((r: Json) => r.party)).toEqual([B]);
    expect((await call(c, P.an, "GET", `${R}/partners`)).json).toEqual([]);
    expect((await call(c, P.cuc, "GET", `${R}/partners`)).status).toBe(403);
  });

  it("điểm vai = bình quân điểm nhóm theo giá trị giao dịch", async () => {
    await arrangeV2e(c);
    const s = await contract(c.sql, {
      deal: "buy",
      tax: "0301000004",
      group: "service",
      value: 300_000_000,
    });
    const g = await contract(c.sql, {
      deal: "buy",
      tax: "0301000004",
      group: "goods",
      value: 100_000_000,
    });
    await milestones(
      c.sql,
      s,
      D,
      [0, 1, 2].map((i) => ({ kind: "delivery" as const, done: -5 - i })),
    );
    await milestones(
      c.sql,
      g,
      D,
      [0, 1, 2].map((i) => ({
        kind: "delivery" as const,
        done: -5 - i,
        late: 25,
        fault: "partner" as const,
      })),
    );
    const [d] = await board(c);
    expect(d.groups.map((x: Json) => [x.group, x.score, x.value])).toEqual([
      ["service", 100, 300_000_000],
      ["goods", 50, 100_000_000],
    ]);
    expect([d.score, d.level, d.jobs]).toEqual([88, "good", 6]);
  });
});

const cellBody = (cfg: Json, f: (x: Json) => Json = (x) => x) => ({
  criteria: cfg.criteria.map((x: Json) =>
    f({ key: x.key, label: x.label, kind: x.kind, weight: x.weight, enabled: x.enabled }),
  ),
  window_months: cfg.window_months,
  decay: cfg.decay,
  late_per_day: cfg.late_per_day,
});

describe("V2-E CD-02..05 · cấu hình chỉ quản lý; thử tính không ghi; đổi cấu hình chỉ đổi điểm hiện tại", () => {
  it("CR-097a chỉ đọc: mặc định BA v2; editor 403; lưu ⇒ 410; thử tính vẫn chạy, không ghi; điểm cũ giữ nguyên", async () => {
    await world();
    const cfg = await ok(call(c, P.tam, "GET", `${R}/config`));
    expect(cfg.cells["goods:customer"].criteria.map((x: Json) => [x.key, x.weight])).toEqual([
      ["on_time_payment", 45],
      ["debt", 25],
      ["reminders", 15],
      ["complaints", 15],
    ]);
    expect([
      cfg.cells["service:supplier"].window_months,
      cfg.settings.good_from,
      cfg.settings.manual_share,
    ]).toEqual([24, 85, 20]);
    const svc = cfg.cells["service:supplier"];
    // tắt serial, dồn trọng số vào giao đúng hạn, trừ 5 điểm/ngày trễ ⇒ A: (75 + 50·0,5 + 100·0,2) / 1,7 = 70,6 ⇒ 71 (KHÁ)
    const draft = {
      ...cellBody(svc, (x) =>
        x.key === "serial"
          ? { ...x, enabled: false, weight: 0 }
          : x.key === "on_time_delivery"
            ? { ...x, weight: 50 }
            : x,
      ),
      late_per_day: 5,
    };
    const path = `${R}/config/cells/service/supplier`;
    expect((await call(c, P.hoa, "PUT", path, draft)).status).toBe(403);
    expect((await call(c, P.tam, "PUT", path, draft)).status).toBe(403);
    const bad = await call(
      c,
      P.lan,
      "PUT",
      path,
      cellBody(svc, (x) => (x.key === "serial" ? { ...x, weight: 1 } : x)),
    );
    expect([bad.status, bad.json?.error?.code]).toEqual([410, "REPUTATION_READ_ONLY"]); // CR-097a: đóng băng
    expect(
      (await call(c, P.lan, "PUT", `${R}/config/cells/goods/commission_payer`, draft)).status,
    ).toBe(410); // CR-097a: mọi ghi /reputation → 410 trước cả kiểm ô hợp lệ
    const pv = await ok(
      call(c, P.hoa, "POST", `${R}/config/preview`, {
        cell: { group: "service", role: "supplier", config: draft },
      }),
    );
    expect(pv.changes).toEqual([
      {
        party: A,
        name: "NCC Minh An",
        role: "supplier",
        old: 94,
        new: 71,
        old_level: "good",
        new_level: "fair",
      },
    ]);
    expect(pv.sample.jobs.map((j: Json) => j.h)).toEqual([1, 0.5, 0.2]);
    expect((await ok(call(c, P.lan, "GET", `${R}/config`))).versions["service:supplier"]).toBe(0);
    const saved = await call(c, P.lan, "PUT", path, draft);
    expect([saved.status, saved.json?.error?.code]).toEqual([410, "REPUTATION_READ_ONLY"]);
    expect((await ok(call(c, P.lan, "GET", `${R}/config`))).versions["service:supplier"]).toBe(0);
    const a = (await board(c)).find((r: Json) => r.party === A);
    expect([a.score, a.level]).toEqual([94, "good"]); // điểm cũ không đổi (chỉ đọc)
  });

  it("cài đặt chung + danh mục loại việc: thân sai ⇒ 400, thân đúng ⇒ 410 (chỉ đọc)", async () => {
    await world();
    const cfg = await ok(call(c, P.lan, "GET", `${R}/config`));
    const s = { ...cfg.settings, good_from: 95 };
    expect(
      (await call(c, P.lan, "PUT", `${R}/config/settings`, { ...s, manual_share: 60 })).status,
    ).toBe(400);
    const put = await call(c, P.lan, "PUT", `${R}/config/settings`, s);
    expect([put.status, put.json?.error?.code]).toEqual([410, "REPUTATION_READ_ONLY"]);
    expect((await board(c)).find((r: Json) => r.party === A).level).toBe("good"); // không đổi
    const items = cfg.job_types.map(({ ord: _o, ...j }: Json) => j);
    const jt = await call(c, P.lan, "PUT", `${R}/config/job-types`, {
      items: [
        ...items,
        { key: "late_docs", name: "Chậm giấy tờ", criterion: "quality", score: 50 },
      ],
    });
    expect(jt.status).toBe(410);
  });
});
