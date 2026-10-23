// CR-097 K2 (tiếp) · HD-FR-102/103 · R18: sau khi xác nhận v2, các màn đọc coi v1 (đã bị thay) là KHÔNG còn chạy — Cần xử lý
// (`/my-work/todo`) và Việc của tôi (`/my-work`) không còn việc của v1 (hết hạn HĐ, thiếu tệp, hạn chót, mốc đã huỷ); mốc thật của v1
// được giữ (hạn trước ngày hiệu lực v2) vẫn hiện. Tổng quan (`/overview`) không cộng đôi: mốc huỷ do cutover ra khỏi tổng, mốc trống
// còn lại của v1 giữ đúng suất chia cũ (5.4a). Hạ tầng HD1 + V2-K (AI đọc giả bằng SQL). acme: lan = owner.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CBASE, type Json, pdf } from "../HD1/_support/hd1";
import {
  arrangeV2k,
  type CtxN1,
  call,
  contract,
  d,
  milestone,
  monthDay,
  ok,
  overview,
  P,
  startHd1,
  T,
  todo,
} from "../V2-K/_support/v2k";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  if (c) await c.sql`delete from contracts.approval_settings where tenant_id = ${T.acme}`;
  await c?.stop();
});

async function uploadVersion(id: string): Promise<string> {
  const fd = new FormData();
  fd.set("file", new File([pdf() as unknown as BlobPart], "v2.pdf", { type: "application/pdf" }));
  const res = await fetch(`${c.hub.base}${CBASE}/${id}/versions`, {
    method: "POST",
    headers: { authorization: `Bearer ${await c.tok(P.lan)}` },
    body: fd,
  });
  const j = (await res.json()) as Json;
  expect({ status: res.status }).toEqual({ status: 201 });
  return j.id as string;
}

type Item = { kind: string; contract_id: string | null; key?: string; id?: string };
const ofContract = (items: Item[], id: string) =>
  items
    .filter((i) => i.contract_id === id)
    .map((i) => i.kind)
    .sort();

describe("K2 · màn đọc bỏ bản đã bị thay", () => {
  it("v2 xác nhận ⇒ Cần xử lý / Việc của tôi chỉ còn mốc thật của v1; Tổng quan không cộng đôi", async () => {
    await arrangeV2k(c);
    await c.sql`insert into contracts.approval_settings (tenant_id, approval_enabled) values (${T.acme}, false)
      on conflict (tenant_id) do update set approval_enabled = false`;
    const v1 = await contract(c.sql, { deal: "sell", value: 100_000_000, end: d(10), notice: 30 });
    // Ngày hiệu lực v2 = mùng 15 ⇒ m1, m3 (trước) giữ; m2, m4 (sau) huỷ. Base 100 tr − 30 tr cố định = 70 tr / 2 mốc trống.
    const m1 = await milestone(c.sql, v1, {
      kind: "collect",
      due: monthDay(0),
      amount: 10_000_000,
    });
    const m2 = await milestone(c.sql, v1, {
      kind: "collect",
      due: monthDay(27),
      amount: 20_000_000,
    });
    await milestone(c.sql, v1, { kind: "collect", due: monthDay(1) });
    await milestone(c.sql, v1, { kind: "collect", due: monthDay(20) });

    const before = await overview(c, "?period=month");
    expect(before.revenue.expected).toBe(100_000_000);
    const t0 = (await todo(c)).items as Item[];
    expect(ofContract(t0, v1)).toContain("contract_expiring");
    const w0 = (await ok(call(c, P.lan, "GET", "/my-work"))).items as Item[];
    expect(ofContract(w0, v1)).toContain("deadline");

    const v2 = await uploadVersion(v1);
    await c.sql`update contracts.contracts set status = 'needs_review', version = version + 1,
      fields = jsonb_build_object('start_date', jsonb_build_object('value', ${monthDay(14)}::text, 'quote', ''),
        'total_value', jsonb_build_object('value', 100000000, 'quote', ''))
      where id = ${v2}`;
    const ver = (await ok(call(c, P.lan, "GET", `/contracts/${v2}`))).version;
    await ok(call(c, P.lan, "POST", `/contracts/${v2}/review`, { version: ver }));
    // Lịch mốc riêng của v2 không thuộc ca này (mốc mặc định HD7) ⇒ bỏ để so tổng của v1.
    await c.sql`delete from contracts.obligations where contract_id = ${v2}`;

    const t1 = (await todo(c)).items as Item[];
    expect(ofContract(t1, v1)).toEqual(["overdue", "overdue"]); // m1, m3 (thật, hạn trước ngày hiệu lực) — không hết hạn HĐ / thiếu tệp
    expect(JSON.stringify(t1)).not.toContain(m2);
    const w1 = (await ok(call(c, P.lan, "GET", "/my-work"))).items as Item[];
    expect(ofContract(w1, v1).filter((k) => k !== "obligation")).toEqual([]);
    expect(JSON.stringify(w1)).toContain(m1);
    expect(JSON.stringify(w1)).not.toContain(m2);

    const after = await overview(c, "?period=month");
    // m1 10 tr + m3 35 tr (suất cũ) — m2, m4 đã huỷ; không phình m3 thành 70 tr.
    expect(after.revenue.expected).toBe(45_000_000);
  }, 90_000);
});
