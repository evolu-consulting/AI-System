// V2-E · DT-03/04 · HD-06 · §5.1i/j · CR-096 Q1 (làn đầy đủ: quyền, RLS, chỉ thêm): đánh giá sao trộn s = 20% + bắt lý do khi lệch
// > 25 điểm + lượt mới nhất mỗi người; ghi việc theo danh mục; chốt tháng không tính lại khi đổi cấu hình; lịch sử 3/6/12 tháng; M1
// (chế độ org) trên đánh giá + điểm chốt; engine HD8 chỉ đọc (410). Không đầu vào nào ra 500.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { HUB_API_URL } from "../H1/_fixtures";
import {
  arrangeV2e,
  board,
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
} from "./_support/v2e";

let c: CtxN1;
let db: ReturnType<typeof connectDb>;
beforeAll(async () => {
  c = await startHd1();
  db = connectDb(HUB_API_URL, 2);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

const A = "tax:0302000001";
const rate = (stars: number, reason?: string) => ({
  party: A,
  role: "supplier",
  group: "service",
  criterion: "on_time_delivery",
  stars,
  ...(reason ? { reason } : {}),
});

/** NCC A dịch vụ: Giao đúng hạn 88,2 (3 mốc mẫu) + serial 100 ⇒ dữ liệu 94,1. */
async function world() {
  await arrangeV2e(c);
  const a = await contract(c.sql, {
    deal: "buy",
    tax: "0302000001",
    name: "NCC An",
    group: "service",
  });
  await milestones(c.sql, a, A, [
    { kind: "delivery", done: -60, late: 5, fault: "partner" },
    { kind: "delivery", done: -240, late: 10, fault: "partner" },
    { kind: "delivery", done: -420, late: 3, fault: "ours" },
    { kind: "serial", done: -30 },
  ]);
  return a;
}
const scoreA = async () => (await board(c)).find((r: Json) => r.party === A).score;

describe("V2-E DT-04 · đánh giá thủ công 1–5 sao", () => {
  it("lệch > 25 điểm cần lý do; trộn (1 − s)·dữ liệu + s·sao×20; nhiều người ⇒ TB lượt mới nhất mỗi người; viewer 403", async () => {
    await world();
    expect((await call(c, P.tam, "POST", `${R}/ratings`, rate(1, "x"))).status).toBe(403);
    const noWhy = await call(c, P.hoa, "POST", `${R}/ratings`, rate(1));
    expect([noWhy.status, noWhy.json?.error?.message]).toEqual([
      422,
      "Đánh giá lệch hơn 25 điểm so với dữ liệu (88) — cần ghi lý do",
    ]);
    const r1 = await ok(call(c, P.hoa, "POST", `${R}/ratings`, rate(1, "giao trễ liên tục")));
    expect([r1.stars, r1.reason]).toEqual([1, "giao trễ liên tục"]);
    expect(await scoreA()).toBe(79); // 0,8 × 94,1 + 0,2 × 20
    await ok(call(c, P.lan, "POST", `${R}/ratings`, rate(3, "tạm")));
    expect(await scoreA()).toBe(83); // sao TB (1 + 3) / 2 = 2
    await ok(call(c, P.hoa, "POST", `${R}/ratings`, rate(5))); // 100 vs 88: lệch 12 ⇒ không cần lý do
    expect(await scoreA()).toBe(91); // lượt mới nhất: Hoà 5, Lan 3 ⇒ 4
    const rt = await ok(call(c, P.tam, "GET", `${R}/ratings?party=${enc(A)}&role=supplier`));
    expect(rt.current.map((x: Json) => x.stars).sort()).toEqual([3, 5]);
    expect(rt.history.length).toBe(3);
    const wrong = await call(c, P.hoa, "POST", `${R}/ratings`, {
      ...rate(3),
      criterion: "quality_x",
    });
    expect([wrong.status, wrong.json?.error?.message]).toEqual([
      422,
      "Tiêu chí không có trong cách tính điểm",
    ]);
    expect(
      (await call(c, P.hoa, "POST", `${R}/ratings`, { ...rate(3), group: "goods", reason: "x" }))
        .status,
    ).toBe(404);
    expect((await call(c, P.an, "POST", `${R}/ratings`, rate(3, "x"))).status).toBe(404);
  });
});

describe("V2-E HD-06 · ghi việc theo danh mục Loại việc", () => {
  it("việc có điểm vào tiêu chí gắn; loại lạ 422; viewer 403; đối tác tenant khác 404", async () => {
    await world();
    const job = {
      party: A,
      role: "supplier",
      group: "service",
      job_type: "incident_slow",
      note: "sửa chậm 3 ngày",
    };
    expect((await call(c, P.tam, "POST", `${R}/jobs`, job)).status).toBe(403);
    const bad = await call(c, P.hoa, "POST", `${R}/jobs`, { ...job, job_type: "khong_co" });
    expect([bad.status, bad.json?.error?.message]).toEqual([
      422,
      "Loại việc không có trong danh mục",
    ]);
    expect((await call(c, P.an, "POST", `${R}/jobs`, job)).status).toBe(404);
    const e = await ok(call(c, P.hoa, "POST", `${R}/jobs`, job));
    expect([e.job_type, e.group, e.note]).toEqual(["incident_slow", "service", "sửa chậm 3 ngày"]);
    // Xử lý sự cố = 40 ⇒ dữ liệu (25·88,2 + 25·100 + 25·40) / 75 = 76
    expect(await scoreA()).toBe(76);
    const one = await ok(call(c, P.hoa, "GET", `${R}/partner?party=${enc(A)}&role=supplier`));
    expect(
      one.items
        .filter((i: Json) => i.source === "job")
        .map((i: Json) => [i.criterion, i.score, i.label]),
    ).toEqual([["incident", 40, "Xử lý sự cố chậm"]]);
  });
});

describe("V2-E §5.1j · chốt tháng + lịch sử 3/6/12 tháng", () => {
  it("vòng chốt điền 12 kỳ; đổi cấu hình chỉ đổi điểm hiện tại; chạy lại không tính lại", async () => {
    await world();
    const lock = startLock(new Date().toISOString());
    try {
      expect(await lock.s.once(T.acme)).toBe(12);
      const [n0] = await c.sql<
        { n: number }[]
      >`select count(*)::int as n from contracts.score_locks where party_key = ${A}`;
      expect(n0?.n).toBe(24); // 12 kỳ × (ô dịch vụ + điểm vai)
      const h = await ok(
        call(c, P.tam, "GET", `${R}/history?party=${enc(A)}&role=supplier&months=3`),
      );
      expect(h.points.length).toBe(3);
      const last = h.points.at(-1);
      expect([last.score, last.level]).toEqual([94, "good"]);
      expect([h.current.score, h.current.level, h.thresholds]).toEqual([
        94,
        "good",
        { good_from: 85, fair_from: 70 },
      ]);
      const cfg = await ok(call(c, P.lan, "GET", `${R}/config`));
      await ok(call(c, P.lan, "PUT", `${R}/config/settings`, { ...cfg.settings, good_from: 95 }));
      const h2 = await ok(
        call(c, P.tam, "GET", `${R}/history?party=${enc(A)}&role=supplier&months=12`),
      );
      expect(h2.points.length).toBe(12);
      expect(h2.points.at(-1).level).toBe("good"); // kỳ đã chốt giữ nguyên
      expect(h2.current.level).toBe("fair"); // điểm hiện tại theo cài đặt mới
      expect(await lock.s.once(T.acme)).toBe(0);
      const [n1] = await c.sql<
        { n: number }[]
      >`select count(*)::int as n from contracts.score_locks where party_key = ${A}`;
      expect(n1?.n).toBe(24);
      const upd =
        await c.sql`select 1 from contracts.score_locks where party_key = ${A} and level = 'fair'`;
      expect(upd.length).toBe(0);
    } finally {
      await lock.stop();
    }
  });

  it("role gói: người dùng không ghi được điểm chốt; không sửa/xoá đánh giá (chỉ thêm)", async () => {
    await world();
    await ok(call(c, P.hoa, "POST", `${R}/ratings`, rate(5)));
    const asHoa = <X>(fn: Parameters<typeof withPackScope<X>>[2]) =>
      withPackScope(db, { packKey: "contracts", tenantId: T.acme, userId: P.hoa.id }, fn);
    const err = async (q: string) =>
      asHoa(async (tx) => tx.execute(q as never)).then(
        () => "ok",
        (e: { cause?: { code?: string }; code?: string }) => e.cause?.code ?? e.code ?? "err",
      );
    expect(
      await err(
        `insert into contracts.score_locks (tenant_id, period, party_key, role, grp, level, jobs) values ('${T.acme}', '2026-01-01', '${A}', 'supplier', 'all', 'good', 9)`,
      ),
    ).toBe("42501");
    expect(await err("update contracts.score_ratings set stars = 1")).toBe("42501");
    expect(await err("delete from contracts.score_ratings")).toBe("42501");
  });
});

describe("V2-E · M1 (chế độ org): thành viên chỉ thấy điểm/đánh giá của đối tác mình thấy", () => {
  it("HĐ của Lan ⇒ Hoà không thấy đối tác trên bảng điểm, không chấm được; HĐ của Hoà thì thấy", async () => {
    await world();
    const mine = await contract(c.sql, {
      deal: "buy",
      tax: "0302000009",
      name: "NCC Của Hoà",
      group: "goods",
    });
    await c.sql`update contracts.contracts set owner_user_id = ${P.hoa.id} where id = ${mine}`;
    await ok(call(c, P.lan, "PUT", "/visibility", { mode: "org" }));
    try {
      expect((await board(c, "", P.hoa)).map((r: Json) => r.party)).toEqual(["tax:0302000009"]);
      expect((await call(c, P.hoa, "POST", `${R}/ratings`, rate(5))).status).toBe(404);
      expect(
        (await call(c, P.hoa, "GET", `${R}/partner?party=${enc(A)}&role=supplier`)).status,
      ).toBe(404);
      expect((await board(c, "", P.lan)).length).toBe(2);
    } finally {
      await c.sql`update contracts.visibility_settings set mode = 'tenant'`;
    }
  });
});

describe("CR-096 Q1 · engine HD8 chỉ đọc", () => {
  it("PUT /scoring/:role và PUT /partners/ratings ⇒ 410; đọc cũ vẫn chạy", async () => {
    await world();
    const cfg = await ok(call(c, P.lan, "GET", "/scoring/customer"));
    const put = await call(c, P.lan, "PUT", "/scoring/customer", {
      criteria: cfg.criteria,
      rules: cfg.rules,
    });
    expect([put.status, put.json?.error?.code]).toEqual([410, "SCORING_READ_ONLY"]);
    const r = await call(c, P.hoa, "PUT", "/partners/ratings", {
      party: A,
      role: "supplier",
      criterion: "x",
      value: 50,
    });
    expect(r.status).toBe(410);
    expect((await call(c, P.hoa, "GET", "/partners")).status).toBe(200);
  });
});

describe("V2-E · không đầu vào nào ra 500", () => {
  it("thân/tham số rác ⇒ 4xx", async () => {
    await world();
    const cases: [string, string, unknown?][] = [
      ["GET", `${R}/partners?role=x`],
      ["GET", `${R}/partner?party=&role=supplier`],
      ["GET", `${R}/partner?party=${enc("tax:0\u00001")}&role=supplier`],
      ["GET", `${R}/partner?party=tax%3A1&role=nope`],
      ["GET", `${R}/history?party=tax%3A1&role=supplier&months=5`],
      ["POST", `${R}/ratings`, { ...rate(6), reason: "x" }],
      ["POST", `${R}/ratings`, "not json"],
      ["POST", `${R}/jobs`, { party: A, role: "supplier", group: "service", job_type: "A B" }],
      [
        "POST",
        `${R}/jobs`,
        { party: A, role: "supplier", group: "service", job_type: "x", at: "2026-02-30" },
      ],
      ["POST", `${R}/config/preview`, { cell: { group: "goods", role: "supplier", config: {} } }],
      ["PUT", `${R}/config/cells/x/y`, {}],
      ["PUT", `${R}/config/settings`, { good_from: 1e9 }],
      [
        "PUT",
        `${R}/config/job-types`,
        { items: [{ key: "Ă", name: "", criterion: "q", score: 101 }] },
      ],
    ];
    for (const [m, p, b] of cases) {
      const r = await call(c, P.lan, m, p, b);
      expect({ m, p, s: r.status >= 400 && r.status < 500 }).toEqual({ m, p, s: true });
    }
  });
});
