// CR-097 G1 · GD-FR-01…05 qua hub-api THẬT: nháp → ghi sổ (kho theo luật giao hàng HĐ + nghĩa vụ thanh toán) → mô tả → điều chỉnh có
// lý do (bản cũ giữ, kho/nghĩa vụ tính lại) → huỷ có lý do (hoàn kho, huỷ nghĩa vụ mở, không xoá). Quyền (viewer 403) + tenant khác 404.
// Chéo tenant từng bảng mới (transactions, transaction_lines, transaction_events) ở bộ RLS gói (`rls-packs-v2.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BASE, type CtxJ2, type Json, P, startJ2 } from "../V2-J2/_support/v2j2";

let c: CtxJ2;
beforeAll(async () => {
  c = await startJ2();
  await c.sql`truncate contracts.transactions, contracts.products cascade`;
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type Person = (typeof P)[keyof typeof P];
const call = (p: Person, method: string, path: string, body?: unknown) =>
  c.hubCall(p, method, `${BASE}${path}`, body);
const onHand = async (pid: string) =>
  ((await call(P.hoa, "GET", `/products/${pid}`)).json as Json).components[0].on_hand as string;

const draft = (deal: "buy" | "sell", pid: string, qty: string, price: number) => ({
  deal,
  occurred_on: "2026-10-01",
  partner_name: deal === "buy" ? "Công ty A" : "Khách B",
  partner_tax_id: deal === "buy" ? "0100684378" : "0100109106",
  lines: [{ name: "Băng keo 5cm", product_id: pid, qty, unit_price: price }],
});

describe("GD-FR-01…05 · đường chính giao dịch", () => {
  it("nháp → ghi sổ → mô tả → điều chỉnh → huỷ; kho + nghĩa vụ đúng; vết đủ", async () => {
    const made = await call(P.hoa, "POST", "/products", { name: "Băng keo 5cm", group: "goods" });
    expect(made.status).toBe(201);
    const pid = made.json.id as string;

    // GD-FR-01 · nháp (dòng hàng + dòng không SP), sửa tự do
    const buy = draft("buy", pid, "10", 5_000);
    buy.lines.push({ name: "Phí vận chuyển", qty: "1", unit_price: 20_000 } as never);
    const b0 = await call(P.hoa, "POST", "/transactions", buy);
    expect(b0.status).toBe(201);
    expect(b0.json).toMatchObject({ status: "draft", total: 70_000, rev: 0 });
    const bid = b0.json.id as string;
    const b1 = await call(P.hoa, "PATCH", `/transactions/${bid}`, {
      lines: [{ name: "Băng keo 5cm", product_id: pid, qty: "20", unit_price: 5_000 }],
    });
    expect(b1.json).toMatchObject({ status: "draft", total: 100_000 });
    expect(await onHand(pid)).toBe("0");

    // GD-FR-02 · ghi sổ mua ⇒ nhập kho 20 @ 5.000 + nghĩa vụ trả 100.000
    const bp = await call(P.hoa, "POST", `/transactions/${bid}/post`);
    expect(bp.status).toBe(200);
    expect(bp.json.stock).toMatchObject([
      { on_hand_before: "0", on_hand_after: "20", avg_cost_after: 5_000 },
    ]);
    expect(bp.json.transaction).toMatchObject({ status: "posted" });
    expect(bp.json.transaction.obligations).toMatchObject([
      { direction: "pay", amount: 100_000, status: "open", seq: 1 },
    ]);
    const mv = await c.sql<{ n: number; nc: number }[]>`select count(*)::int as n,
      count(contract_id)::int as nc from contracts.stock_moves where transaction_id = ${bid}`;
    expect(mv[0]).toEqual({ n: 1, nc: 0 });
    expect((await call(P.hoa, "PATCH", `/transactions/${bid}`, { note: "x" })).status).toBe(409);
    expect((await call(P.hoa, "DELETE", `/transactions/${bid}`)).status).toBe(409);

    // bán 5 ⇒ xuất theo BQ; bán vượt tồn ⇒ 409, không ghi gì
    const s0 = await call(P.hoa, "POST", "/transactions", draft("sell", pid, "5", 9_000));
    const sid = s0.json.id as string;
    expect((await call(P.hoa, "POST", `/transactions/${sid}/post`)).status).toBe(200);
    expect(await onHand(pid)).toBe("15");
    const over = await call(P.hoa, "POST", "/transactions", draft("sell", pid, "100", 9_000));
    expect((await call(P.hoa, "POST", `/transactions/${over.json.id}/post`)).status).toBe(409);
    expect((await call(P.hoa, "GET", `/transactions/${over.json.id}`)).json.status).toBe("draft");
    expect(await onHand(pid)).toBe("15");

    // GD-FR-03 · mô tả sửa trực tiếp, có vết
    const ds = await call(P.hoa, "PATCH", `/transactions/${sid}/describe`, {
      holder: "Lan",
      lot_label: "L-01",
    });
    expect(ds.json).toMatchObject({ holder: "Lan", lot_label: "L-01", rev: 0 });

    // GD-FR-04 · điều chỉnh SL 5 → 3: bản cũ giữ, kho 15 → 17, nghĩa vụ mở cũ huỷ + mới 27.000
    expect((await call(P.hoa, "POST", `/transactions/${sid}/adjust`, { lines: [] })).status).toBe(
      400,
    );
    const adj = await call(P.hoa, "POST", `/transactions/${sid}/adjust`, {
      reason: "khách trả bớt",
      lines: [{ name: "Băng keo 5cm", product_id: pid, qty: "3", unit_price: 9_000 }],
    });
    expect(adj.status).toBe(200);
    expect(adj.json.stock_reversed).toBe(1);
    expect(adj.json.transaction).toMatchObject({ rev: 1, total: 27_000 });
    expect(adj.json.transaction.lines).toMatchObject([{ qty: "3", amount: 27_000 }]);
    expect(
      adj.json.transaction.obligations.map((o: Json) => [o.status, o.amount, o.direction]),
    ).toEqual([
      ["cancelled", 45_000, "receive"],
      ["open", 27_000, "receive"],
    ]);
    expect(await onHand(pid)).toBe("17");
    const kept = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.transaction_lines
      where transaction_id = ${sid}`;
    expect(kept[0]?.n).toBe(2);

    // GD-FR-05 · huỷ mua khi hàng đã bán ⇒ 409 (không đảo được); huỷ bán rồi huỷ mua ⇒ kho về 0
    expect(
      (await call(P.hoa, "POST", `/transactions/${bid}/cancel`, { reason: "nhập nhầm" })).status,
    ).toBe(409);
    const cs = await call(P.hoa, "POST", `/transactions/${sid}/cancel`, {
      reason: "khách huỷ đơn",
    });
    expect(cs.status).toBe(200);
    expect(cs.json.transaction).toMatchObject({
      status: "cancelled",
      cancel_reason: "khách huỷ đơn",
    });
    expect(cs.json.transaction.obligations.every((o: Json) => o.status === "cancelled")).toBe(true);
    expect(await onHand(pid)).toBe("20");
    expect(
      (await call(P.hoa, "POST", `/transactions/${bid}/cancel`, { reason: "nhập nhầm" })).status,
    ).toBe(200);
    expect(await onHand(pid)).toBe("0");
    expect(
      (await call(P.hoa, "POST", `/transactions/${sid}/adjust`, { reason: "lại", lines: [] }))
        .status,
    ).toBe(409);
    const d = (await call(P.hoa, "GET", `/transactions/${sid}`)).json as Json;
    expect(d.events.map((e: Json) => e.type)).toEqual([
      "created",
      "posted",
      "described",
      "adjusted",
      "cancelled",
    ]);

    // danh sách + lọc; nháp xoá được
    const list = (await call(P.hoa, "GET", "/transactions?status=cancelled&limit=10")).json as Json;
    expect(list.total).toBe(2);
    expect((await call(P.hoa, "DELETE", `/transactions/${over.json.id}`)).status).toBe(204);
    expect((await call(P.hoa, "GET", `/transactions/${over.json.id}`)).status).toBe(404);
  });

  it("quyền: người xem không ghi được (403); tenant khác 404 cả đọc lẫn ghi", async () => {
    const t = await call(P.hoa, "POST", "/transactions", {
      deal: "sell",
      occurred_on: "2026-10-02",
      partner_name: "Khách lẻ",
      lines: [{ name: "Dịch vụ", qty: "1", unit_price: 100_000 }],
    });
    const id = t.json.id as string;
    expect((await call(P.tam, "POST", "/transactions", { deal: "sell" })).status).toBe(403);
    expect((await call(P.tam, "POST", `/transactions/${id}/post`)).status).toBe(403);
    expect((await call(P.an, "GET", `/transactions/${id}`)).status).toBe(404);
    expect((await call(P.an, "POST", `/transactions/${id}/post`)).status).toBe(404);
    expect(((await call(P.an, "GET", "/transactions")).json as Json).total).toBe(0);
  });
});
