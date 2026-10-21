// GAP-D2 · #24 nhiều người liên hệ (`GET/PUT /partners/contacts`, migration 0044 + backfill) · #25 huỷ việc kèm lý do
// (`POST /partner-events/:id/void`) — hub-api THẬT, một int đường chính mỗi endpoint mới + chặn đọc/ghi chéo tenant cho bảng mới.
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

describe("GAP-D2 · liên hệ nhiều người + huỷ việc có lý do", () => {
  it("PUT /partners/contacts thay cả danh sách (thứ tự giữ, trống ⇒ null), hồ sơ lấy người đầu; tenant khác 404 và không đọc được", async () => {
    await arrangeV2e(c);
    await contract(c.sql, {
      deal: "buy",
      tax: "0301000001",
      name: "NCC Minh An",
      group: "service",
    });
    const put = (as: typeof P.hoa, contacts: unknown[]) =>
      call(c, as, "PUT", "/partners/contacts", { party: A, contacts });
    const saved = (await ok(
      put(P.hoa, [
        {
          name: " Chị Lan ",
          role: "Kinh doanh",
          phone: "0903 111 222",
          email: "lan@x.vn",
          our_owner: "Hoa",
        },
        { name: "Anh Minh", role: "", phone: "", email: "", our_owner: "" },
      ]),
    )) as { id: string; name: string; role: string | null; our_owner: string | null }[];
    expect(saved.map((r) => [r.name, r.role, r.our_owner])).toEqual([
      ["Chị Lan", "Kinh doanh", "Hoa"],
      ["Anh Minh", null, null],
    ]);
    expect(await ok(call(c, P.hoa, "GET", `/partners/contacts?party=${enc(A)}`))).toEqual(saved);
    expect(await ok(call(c, P.hoa, "GET", `/partners/profile?party=${enc(A)}`))).toMatchObject({
      phone: "0903 111 222",
      contact: "Chị Lan",
    });
    // thay lại: danh sách mới thế chỗ hoàn toàn; rỗng ⇒ xoá hết
    expect(((await ok(put(P.hoa, [{ name: "Chỉ một" }]))) as unknown[]).length).toBe(1);
    expect(await ok(put(P.hoa, []))).toEqual([]);
    await ok(put(P.hoa, [{ name: "Chị Lan", phone: "0903" }]));

    // thân sai ⇒ 400 (tên trống); tenant khác: không thấy, không ghi được, dữ liệu giữ nguyên
    expect((await put(P.hoa, [{ name: "  " }])).status).toBe(400);
    for (const [m, path, body] of [
      ["GET", `/partners/contacts?party=${enc(A)}`, undefined],
      ["PUT", "/partners/contacts", { party: A, contacts: [{ name: "Kẻ lạ" }] }],
    ] as const) {
      const r = await call(c, P.an, m, path, body);
      expect({ path, status: r.status }).toEqual({ path, status: 404 });
    }
    const rows = await c.sql<
      { name: string }[]
    >`select name from contracts.partner_contacts where party_key = ${A}`;
    expect(rows.map((r) => r.name)).toEqual(["Chị Lan"]);
  });

  it("POST /partner-events/:id/void lưu lý do (thân {} cũ vẫn nhận); tenant khác 404 và không ghi lý do", async () => {
    await arrangeV2e(c);
    const id = await contract(c.sql, {
      deal: "buy",
      tax: "0301000001",
      name: "NCC Minh An",
      group: "goods",
    });
    await milestones(c.sql, id, A, [{ kind: "delivery", done: -5 }]);
    const rec = async () =>
      (await ok(
        call(c, P.hoa, "POST", "/partner-events", {
          party: A,
          role: "supplier",
          type: "complaint",
          note: "hàng lỗi",
        }),
      )) as { id: string };
    const [e1, e2] = [await rec(), await rec()];

    const cross = await call(c, P.an, "POST", `/partner-events/${e1.id}/void`, {
      reason: "xoá lén",
    });
    expect(cross.status).toBe(404);
    expect(
      await c.sql`select 1 from contracts.partner_event_voids where event_id = ${e1.id}::bigint`,
    ).toHaveLength(0);

    expect(
      await ok(
        call(c, P.hoa, "POST", `/partner-events/${e1.id}/void`, { reason: " Ghi nhầm đối tác " }),
      ),
    ).toMatchObject({
      voided: true,
    });
    await ok(call(c, P.hoa, "POST", `/partner-events/${e2.id}/void`, {}));
    const v = await c.sql<
      { event_id: string; reason: string | null }[]
    >`select event_id::text, reason
      from contracts.partner_event_voids order by event_id`;
    expect(v.map((r) => r.reason)).toEqual(["Ghi nhầm đối tác", null]);
    expect(
      (await call(c, P.hoa, "POST", `/partner-events/${e1.id}/void`, { reason: "x".repeat(501) }))
        .status,
    ).toBe(400);
  });
});
