// CR-097 D1 · dữ liệu minh hoạ tính năng mới của demo (thuần, không DB): khớp nhau, id ổn định, đúng ràng buộc đã biết của 0051/0052.
import { describe, expect, it } from "bun:test";
import { WIPE } from "./seed-demo-v2";
import { uid } from "./seed-demo-v2.build";
import { CONTRACTS } from "./seed-demo-v2.contracts";
import {
  CHAIN,
  D1_WIPE,
  d1EventRows,
  TX_IDS,
  txEventRows,
  txLineRows,
  txRows,
} from "./seed-demo-v2.d1";

const A = {
  owner: "00000000-0000-4000-8000-000000000001",
  editor: "00000000-0000-4000-8000-000000000002",
};
const T = "00000000-0000-4000-8000-0000000000aa";
const TODAY = "2026-10-27";

describe("D1 seed demo · mới", () => {
  it("giao dịch: một nháp (rev 0, chưa ghi sổ) + một đã ghi sổ; tổng = Σ dòng; dòng thuộc giao dịch", () => {
    const tx = txRows(T, A, TODAY);
    const lines = txLineRows(T);
    expect(tx.map((t) => t.status).sort()).toEqual(["draft", "posted"]);
    for (const t of tx) {
      const sum = lines
        .filter((l) => l.transaction_id === t.id)
        .reduce((n, l) => n + (l.amount as number), 0);
      expect(sum).toBe(t.total as number);
      expect((t.status === "draft") === (t.posted_at === null)).toBe(true);
      if (t.status === "draft") expect(t.rev).toBe(0);
    }
    for (const l of lines) {
      expect(l.amount).toBe((l.qty as number) * (l.unit_price as number));
      // CHECK transaction_lines_components_ck: có thành phần ⇒ phải có product_id
      if (l.component_ids !== null) expect(l.product_id).not.toBeNull();
    }
  });

  it("sự kiện giao dịch: mọi giao dịch có 'created'; đã ghi sổ có 'posted'", () => {
    const ev = txEventRows(T, A, TODAY);
    for (const id of Object.values(TX_IDS))
      expect(ev.some((e) => e.transaction_id === id && e.type === "created")).toBe(true);
    expect(ev.some((e) => e.transaction_id === TX_IDS.posted && e.type === "posted")).toBe(true);
  });

  it("chuỗi phiên bản: c6 tồn tại, mọi mốc đã xong (cutover không huỷ gì); id v2 ổn định", () => {
    const c = CONTRACTS.find((x) => x.key === CHAIN.base);
    expect(c).toBeDefined();
    expect(c?.ms.every((m) => m.done)).toBe(true);
    expect(uid("contract", CHAIN.next)).toBe(uid("contract", CHAIN.next));
    expect(uid("contract", CHAIN.next)).not.toBe(uid("contract", CHAIN.base));
  });

  it("sổ đối tác: Khách lẻ 2 khoản thu (< min_events 3 ⇒ tạm tính); cờ đỏ có lý do (CHECK 0052)", () => {
    const ev = d1EventRows(T, A, TODAY);
    const lekhach = ev.filter((e) => e.type === "received");
    expect(lekhach).toHaveLength(2);
    expect(lekhach.every((e) => e.role === "customer")).toBe(true);
    const flag = ev.filter((e) => e.type === "no_delivery");
    expect(flag).toHaveLength(1);
    expect(String(flag[0]?.note ?? "").trim().length).toBeGreaterThan(0);
    for (const e of ev) expect(e.tenant_id).toBe(T);
  });

  it("nạp lại xoá cả bảng giao dịch (idempotent)", () => {
    for (const t of D1_WIPE) expect(WIPE as readonly string[]).toContain(t);
  });
});
