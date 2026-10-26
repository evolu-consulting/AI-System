// V2-E · DT-03/04 · HD-06 · §5.1i/j · CR-096 Q1 (làn đầy đủ: quyền, RLS, chỉ thêm): đánh giá sao trộn s = 20% + bắt lý do khi lệch
// > 25 điểm + lượt mới nhất mỗi người; ghi việc theo danh mục; chốt tháng không tính lại khi đổi cấu hình; lịch sử 3/6/12 tháng; M1
// (chế độ org) trên đánh giá + điểm chốt; engine HD8 chỉ đọc (410). Không đầu vào nào ra 500.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { HUB_API_URL } from "../H1/_fixtures";
import {
  arrangeV2e,
  type CtxN1,
  call,
  contract,
  enc,
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

describe("CR-097a · uy tín v2 chỉ đọc: sao + ghi việc đóng", () => {
  it("viewer 403; thân sai 400; đúng thân ⇒ 410 và không ghi gì; đọc đánh giá cũ vẫn chạy", async () => {
    await world();
    const job = { party: A, role: "supplier", group: "service", job_type: "incident_slow" };
    expect((await call(c, P.tam, "POST", `${R}/ratings`, rate(1, "x"))).status).toBe(403);
    expect((await call(c, P.tam, "POST", `${R}/jobs`, job)).status).toBe(403);
    expect((await call(c, P.hoa, "POST", `${R}/ratings`, { ...rate(6), reason: "x" })).status).toBe(
      400,
    );
    const r = await call(c, P.hoa, "POST", `${R}/ratings`, rate(1, "giao trễ liên tục"));
    expect([r.status, r.json?.error?.code]).toEqual([410, "REPUTATION_READ_ONLY"]);
    expect((await call(c, P.hoa, "POST", `${R}/jobs`, job)).status).toBe(410);
    const [n] = await c.sql<
      { n: number }[]
    >`select (select count(*) from contracts.score_ratings)::int + (select count(*) from contracts.partner_events where type = 'job')::int as n`;
    expect(n?.n).toBe(0);
    const rt = await ok(call(c, P.tam, "GET", `${R}/ratings?party=${enc(A)}&role=supplier`));
    expect(rt.history).toEqual([]);
    expect((await call(c, P.hoa, "GET", `${R}/partner?party=${enc(A)}&role=supplier`)).status).toBe(
      200,
    );
  });
});

describe("V2-E §5.1j · chốt tháng + lịch sử 3/6/12 tháng", () => {
  it("vòng chốt điền 12 kỳ; chạy lại không tính lại", async () => {
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
      const h2 = await ok(
        call(c, P.tam, "GET", `${R}/history?party=${enc(A)}&role=supplier&months=12`),
      );
      expect(h2.points.length).toBe(12);
      expect(h2.points.at(-1).level).toBe("good"); // kỳ đã chốt giữ nguyên
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
