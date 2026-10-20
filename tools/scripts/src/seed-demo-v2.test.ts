// V2-O · bộ mẫu v2 của tenant demo: luật chặn tenant + tính nhất quán của dữ liệu dựng (thuần, không DB).
import { describe, expect, it } from "bun:test";
import { assertDemo } from "./seed-demo-v2";
import {
  itemRows,
  milestoneItemRows,
  obligationRows,
  shiftOf,
  uid,
  vnDate,
} from "./seed-demo-v2.build";
import { productRows } from "./seed-demo-v2.build-people";
import { CONTRACTS } from "./seed-demo-v2.contracts";
import { stockPlan } from "./seed-demo-v2.stock";

const A = {
  owner: "00000000-0000-4000-8000-000000000001",
  editor: "00000000-0000-4000-8000-000000000002",
};
const T = "00000000-0000-4000-8000-0000000000aa";
const TODAY = "2026-10-21";

describe("V2-O seed-demo-v2", () => {
  it("chỉ chấp nhận khoá demo — nitigroup và khoá khác bị từ chối", () => {
    expect(() => assertDemo("demo")).not.toThrow();
    for (const k of ["nitigroup", "Demo", "demo ", "", undefined])
      expect(() => assertDemo(k)).toThrow(/chỉ nạp cho tenant/);
  });

  it("ngày mockup dịch theo hôm nay; id ổn định giữa các lần dựng", () => {
    expect(shiftOf("2024-10-19")).toBe(0);
    expect(vnDate("19/10/2024", shiftOf(TODAY))).toBe(TODAY);
    expect(uid("contract", "c1")).toBe(uid("contract", "c1"));
  });
});

describe("V2-O seed-demo-v2 · dữ liệu dựng", () => {
  it("dòng HĐ, mốc, SL giao khớp nhau; mọi mốc giao đã làm có dòng sổ kho", () => {
    const items = new Set(itemRows(T).map((r) => r.id));
    const ms = new Set(obligationRows(A, T, 0).map((r) => r.id));
    const mi = milestoneItemRows(A, T);
    expect(mi.length).toBeGreaterThan(0);
    for (const r of mi) {
      expect(items.has(r.contract_item_id as string)).toBe(true);
      expect(ms.has(r.milestone_id as string)).toBe(true);
    }
    const moved = new Set(stockPlan(A, T, TODAY).moves.map((m) => m.milestone_id));
    for (const r of mi.filter((x) => x.delivered != null))
      expect(moved.has(r.milestone_id as string)).toBe(true);
  });

  it("kho: băng keo 320 cuộn BQ 3.700, thùng phi 5, hoá đơn 110 gói; tồn ≥ 0 và Σ lô = tồn", () => {
    const s = stockPlan(A, T, TODAY);
    const comp = (k: string) => s.comps.get(uid("comp", k));
    expect(comp("bangkeo")).toMatchObject({ onHand: 320, avg: 3700, value: 1184000 });
    expect(comp("thungphi")?.onHand).toBe(5);
    expect(comp("hdon")?.onHand).toBe(110);
    for (const [id, c] of s.comps) {
      const lots = s.lots
        .filter((l) => l.component_id === id)
        .reduce((n, l) => n + (l.remaining as number), 0);
      expect(lots).toBe(c.onHand);
    }
    const cat = productRows(T, s, A);
    expect(cat.products.length).toBe(7);
    expect(new Set(cat.products.map((p) => p.grp))).toEqual(
      new Set(["service", "goods", "referral"]),
    );
  });

  it("số tiền: HĐ mua NCCA 236 tr = 150×1,25 tr + 50×0,97 tr; hoa hồng treo 2,4 tr", () => {
    const c1 = CONTRACTS.find((c) => c.key === "c1");
    expect(c1?.items.reduce((n, i) => n + i.qty * (i.price ?? 0), 0)).toBe(c1?.value as number);
    const pvi = CONTRACTS.find((c) => c.key === "c14");
    expect(pvi?.ms.filter((m) => !m.done).reduce((n, m) => n + (m.amount ?? 0), 0)).toBe(2400000);
  });
});
