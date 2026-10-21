// V2-GAPS · DT-01 (điện thoại + liên hệ lưu trên danh bạ, migration 0037) + C10 ("Uy tín của mình") — hub-api THẬT, một int đường chính
// mỗi endpoint mới (`PUT /partners/profile`, `GET /reputation/mine`) + chặn đọc/ghi chéo tenant cho cột mới.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2e,
  type CtxN1,
  call,
  contract,
  milestones,
  ok,
  P,
  startHd1,
} from "../V2-E/_support/v2e";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const enc = encodeURIComponent;
const A = "tax:0301000001";
const B = "tax:0301000002";

describe("V2-GAPS · liên hệ đối tác + uy tín của mình", () => {
  it("PUT /partners/profile lưu điện thoại + liên hệ (trống ⇒ rơi về người đại diện); tenant khác 404 và không đọc được", async () => {
    await arrangeV2e(c);
    await contract(c.sql, {
      deal: "buy",
      tax: "0301000001",
      name: "NCC Minh An",
      group: "service",
    });
    const saved = await ok(
      call(c, P.hoa, "PUT", "/partners/profile", {
        party: A,
        phone: " 0903 111 222 ",
        contact: "Chị Lan",
      }),
    );
    expect(saved).toMatchObject({ party: A, phone: "0903 111 222", contact: "Chị Lan" });
    const [row] = await c.sql<
      { phone: string; contact_person: string }[]
    >`select phone, contact_person from contracts.companies where party_key = ${A}`;
    expect(row).toEqual({ phone: "0903 111 222", contact_person: "Chị Lan" });
    // liên hệ trống ⇒ về null (không có người đại diện ở HĐ) — điện thoại giữ theo thân gửi
    expect(
      await ok(call(c, P.hoa, "PUT", "/partners/profile", { party: A, phone: "", contact: "" })),
    ).toMatchObject({
      phone: null,
      contact: null,
    });
    await ok(
      call(c, P.hoa, "PUT", "/partners/profile", {
        party: A,
        phone: "0903 111 222",
        contact: "Chị Lan",
      }),
    );

    // tenant khác: không thấy, không sửa được; dữ liệu giữ nguyên
    for (const [m, path, body] of [
      ["GET", `/partners/profile?party=${enc(A)}`, undefined],
      ["PUT", "/partners/profile", { party: A, phone: "x", contact: "x" }],
    ] as const) {
      const r = await call(c, P.an, m, path, body);
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
    }
    const [after] = await c.sql<
      { phone: string }[]
    >`select phone from contracts.companies where party_key = ${A}`;
    expect(after?.phone).toBe("0903 111 222");
  });

  it("GET /reputation/mine gom việc của mình: đúng hạn / trễ, lỗi do ai, đối tác bị ghi lỗi", async () => {
    await arrangeV2e(c);
    const s = await contract(c.sql, {
      deal: "sell",
      tax: "0301000002",
      name: "Khách Bình",
      group: "goods",
    });
    await milestones(c.sql, s, B, [
      { kind: "delivery", owner: "ours", done: -10 },
      { kind: "delivery", owner: "ours", done: -5, late: 3, fault: "partner" },
      { kind: "delivery", owner: "partner", done: -5, late: 9, fault: "partner" },
    ]);
    const m = (await ok(call(c, P.hoa, "GET", "/reputation/mine?days=90"))) as {
      total: number;
      late: number;
      on_time_pct: number;
      by_fault: { partner: number };
      blamed: { party: string; late: number }[];
    };
    expect(m).toMatchObject({ total: 2, late: 1, on_time_pct: 50, by_fault: { partner: 1 } });
    expect(m.blamed).toMatchObject([{ party: B, late: 1 }]);
    // tenant khác không thấy việc của mình
    const o = (await ok(call(c, P.an, "GET", "/reputation/mine"))) as { total: number };
    expect(o.total).toBe(0);
  });
});
