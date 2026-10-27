// CR-097 D1 · dữ liệu minh hoạ tính năng mới của demo (thuần, không DB): khớp nhau, id ổn định, đúng ràng buộc đã biết của 0052/0056.
import { describe, expect, it } from "bun:test";
import { WIPE } from "./seed-demo-v2";
import { uid } from "./seed-demo-v2.build";
import { CONTRACTS } from "./seed-demo-v2.contracts";
import { CHAIN, DEAL_IDS, d1EventRows, dealSeeds } from "./seed-demo-v2.d1";

const A = {
  owner: "00000000-0000-4000-8000-000000000001",
  editor: "00000000-0000-4000-8000-000000000002",
};
const T = "00000000-0000-4000-8000-0000000000aa";
const TODAY = "2026-10-27";

describe("D1 seed demo · mới", () => {
  it("giao dịch (CR-101): chứng từ deal, mốc giao/tiền, tổng = SL × đơn giá, thành phần ⇒ có SP; một đã giao", () => {
    const s = dealSeeds(T, A, TODAY);
    expect(s.map((x) => x.contract.id)).toEqual(Object.values(DEAL_IDS));
    for (const x of s) {
      const total = (x.item.qty as number) * (x.item.unit_price as number);
      expect((x.contract.fields as Record<string, { value: unknown }>).total_value?.value).toBe(
        total,
      );
      expect(x.milestones.map((m) => m.kind)).toEqual(["delivery", "payment"]);
      expect(x.milestones.every((m) => m.contract_id === x.contract.id)).toBe(true);
      if (x.item.component_ids !== null) expect(x.item.product_id).not.toBeNull();
      for (const m of x.milestones)
        expect((m.status === "done") === (m.done_at !== null)).toBe(true);
    }
    expect(s.flatMap((x) => x.milestones).filter((m) => m.status === "done")).toHaveLength(1);
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

  it("nạp lại không ghi bảng G1 chỉ đọc (0056); xoá lịch sử sửa giao dịch", () => {
    for (const t of ["transactions", "transaction_lines", "transaction_events"])
      expect(WIPE as readonly string[]).not.toContain(t);
    expect(WIPE as readonly string[]).toContain("contract_edit_log");
  });
});
