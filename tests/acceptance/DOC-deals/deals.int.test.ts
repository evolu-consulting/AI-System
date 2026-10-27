// CR-101 DOC-deals · R1, R5–R10, R37 · X1–X3 · Câu 1, 3, 4 qua hub-api THẬT — đường chính: tạo giao dịch (lưu là có hiệu lực, KHÔNG
// khoá, mốc mặc định) → xác nhận mốc giao (kho đổi) → sửa trực tiếp (máy ghi lịch sử) → nâng thành HĐ (file ký + số; id/mốc/kho giữ,
// khoá ngay) · "đã giao / đã thanh toán ngay" khi lưu → xoá V2-M (chỉ owner, kho đảo) · lớp tương thích `/transactions` (đọc; ghi 410)
// · chéo tenant cho `contract_edit_log` (bảng mới). Viết TRƯỚC code của phần kho/tenant. Hạ tầng V2-D (HD1 + FileBox giả).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CBASE, pdf } from "../HD1/_support/hd1";
import {
  arrangeV2d,
  type CtxN1,
  call,
  comp,
  d,
  type Json,
  ok,
  P,
  product,
  settleRaw,
  startHd1,
  T,
} from "../V2-D/_support/v2d";

let c: CtxN1;
type Person = (typeof P)[keyof typeof P];
let pid = "";
let cid = "";

beforeAll(async () => {
  c = await startHd1();
  await arrangeV2d(c);
  await c.sql`truncate contracts.contract_edit_log`;
  const p = await product(c.sql, { name: "Băng keo 5cm", grp: "goods" });
  pid = p.id;
  cid = p.comps[0] as string;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const code = (r: { json: Json }) => r.json?.error?.code ?? null;
const body = (deal: "buy" | "sell", qty: number, extra: Json = {}) => ({
  deal,
  source: "invoice",
  title: deal === "buy" ? "Mua băng keo" : "Bán băng keo",
  partner_name: deal === "buy" ? "Công ty A" : "Khách B",
  start_date: d(0),
  total_value: qty * 5_000,
  items: [{ name: "Băng keo 5cm", qty, unit_price: 5_000, product_id: pid }],
  ...extra,
});
const milestones = (id: string) =>
  c.sql<
    { id: string; kind: string; status: string }[]
  >`select id::text, kind, status from contracts.obligations
    where contract_id = ${id} order by seq`;
const onHand = async () => (await comp(c.sql, cid))?.onHand;

async function promote(p: Person, id: string, form: Record<string, string>, file = true) {
  const fd = new FormData();
  if (file)
    fd.set("file", new File([pdf() as unknown as BlobPart], "ky.pdf", { type: "application/pdf" }));
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  const res = await fetch(`${c.hub.base}${CBASE}/${id}/promote`, {
    method: "POST",
    headers: { authorization: `Bearer ${await c.tok(p)}` },
    body: fd,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

let A = "";

describe("CR-101 DOC-deals · đường chính giao dịch", () => {
  it("tạo → xác nhận giao (kho) → sửa trực tiếp (lịch sử) → nâng thành HĐ (giữ id/mốc/kho, khoá)", async () => {
    expect((await call(c, P.tam, "POST", "/contracts/deals", body("buy", 10))).status).toBe(403);
    const made = await ok(call(c, P.hoa, "POST", "/contracts/deals", body("buy", 10)));
    expect(made).toMatchObject({
      doc_type: "deal",
      status: "active",
      settled: [],
      settle_error: null,
    });
    A = made.id as string;
    const [row] = await c.sql<
      { doc_type: string; source: string; locked: boolean }[]
    >`select doc_type, source,
      locked_at is not null as locked from contracts.contracts where id = ${A}`;
    expect(row).toEqual({ doc_type: "deal", source: "invoice", locked: false });
    const ms = await milestones(A);
    expect(ms.map((m) => [m.kind, m.status])).toEqual([
      ["delivery", "open"],
      ["payment", "open"],
    ]);

    // Câu 4: kho chạy khi xác nhận mốc giao.
    expect(await onHand()).toBe(0);
    await ok(settleRaw(c, (ms[0] as { id: string }).id));
    expect(await onHand()).toBe(10);

    // X2: sửa trực tiếp (không khoá) ⇒ máy ghi lịch sử.
    const det = await ok(call(c, P.hoa, "GET", `/contracts/${A}`));
    await ok(
      call(c, P.hoa, "PATCH", `/contracts/${A}/fields`, {
        version: det.version,
        fields: { total_value: 60_000 },
      }),
    );
    const log = await ok(call(c, P.hoa, "GET", `/contracts/${A}/edit-log`));
    expect(log.items).toContainEqual(
      expect.objectContaining({
        field: "fields.total_value",
        old_value: 50_000,
        new_value: 60_000,
        actor_user_id: P.hoa.id,
      }),
    );

    // R10: nâng — thiếu số ⇒ 400; đủ ⇒ giữ id, mốc, kho; khoá ngay.
    expect((await promote(P.hoa, A, {})).status).toBe(400);
    const up = await promote(P.hoa, A, { number: "HĐ-2026/01" });
    expect(up.status).toBe(200);
    expect(up.json).toMatchObject({ id: A, doc_type: "contract", locked: true });
    const [after] = await c.sql<
      { doc_type: string; number: string; locked: boolean; file: boolean }[]
    >`select doc_type,
      number, locked_at is not null as locked, file_id is not null as file from contracts.contracts where id = ${A}`;
    expect(after).toEqual({ doc_type: "contract", number: "HĐ-2026/01", locked: true, file: true });
    expect((await milestones(A)).map((m) => m.id)).toEqual(ms.map((m) => m.id));
    expect(await onHand()).toBe(10);
    const again = await call(c, P.hoa, "PATCH", `/contracts/${A}/fields`, {
      version: up.json.version,
      fields: { total_value: 1 },
    });
    expect(again.status).toBe(409);
    expect(code(await promote(P.hoa, A, { number: "X" }))).toBe("NOT_A_DEAL");
  });

  it("đã giao / đã thanh toán ngay khi lưu (Câu 4) → xoá V2-M (chỉ owner) đảo kho", async () => {
    const before = await onHand();
    const s = await ok(
      call(c, P.hoa, "POST", "/contracts/deals", body("sell", 4, { settled_now: true })),
    );
    expect(s.settled).toHaveLength(2);
    expect(s.settle_error).toBeNull();
    expect((await milestones(s.id)).map((m) => m.status)).toEqual(["done", "done"]);
    expect(await onHand()).toBe((before as number) - 4);
    expect((await call(c, P.hoa, "DELETE", `/contracts/${s.id}`)).status).toBe(403);
    await ok(call(c, P.lan, "DELETE", `/contracts/${s.id}`));
    expect(await onHand()).toBe(before);
  });

  it("lớp tương thích /transactions: GET map chứng từ giao dịch; ghi ⇒ 410 USE_CONTRACTS", async () => {
    const x = await ok(
      call(c, P.hoa, "POST", "/contracts/deals", {
        deal: "sell",
        source: "verbal",
        title: "Bán dịch vụ",
        partner_name: "Khách lẻ",
        start_date: d(-1),
        total_value: 300_000,
        items: [{ name: "Lắp đặt", qty: 1, unit_price: 300_000 }],
      }),
    );
    const list = await ok(call(c, P.hoa, "GET", "/transactions?limit=10"));
    expect(list.items).toContainEqual(
      expect.objectContaining({
        id: x.id,
        deal: "sell",
        status: "posted",
        total: 300_000,
        partner_name: "Khách lẻ",
      }),
    );
    const one = await ok(call(c, P.hoa, "GET", `/transactions/${x.id}`));
    expect(one.lines).toMatchObject([{ name: "Lắp đặt", qty: "1", amount: 300_000 }]);
    for (const [m, p] of [
      ["POST", "/transactions"],
      ["PATCH", `/transactions/${x.id}`],
      ["POST", `/transactions/${x.id}/post`],
      ["DELETE", `/transactions/${x.id}`],
    ] as const)
      expect(code(await call(c, P.hoa, m, p, {}))).toBe("USE_CONTRACTS");
  });

  it("chéo tenant: lịch sử sửa của acme không lộ sang beta (API 404, RLS 0 hàng)", async () => {
    expect((await call(c, P.an, "GET", `/contracts/${A}/edit-log`)).status).toBe(404);
    const n = await c.sql.begin(async (tx) => {
      await tx`set local role contracts_rw`;
      await tx`select set_config('app.tenant_id', ${T.beta}, true), set_config('app.user_id', ${P.an.id}, true)`;
      const [r] = await tx<
        { n: number }[]
      >`select count(*)::int as n from contracts.contract_edit_log`;
      return r?.n;
    });
    expect(n).toBe(0);
    const [own] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.contract_edit_log
      where tenant_id = ${T.acme}`;
    expect(own?.n).toBeGreaterThan(0);
  });
});
