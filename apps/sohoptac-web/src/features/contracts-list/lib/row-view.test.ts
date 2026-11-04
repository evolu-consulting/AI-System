// V2-F · HD-03: ô của dòng danh sách — loại, đối tác theo loại, giai đoạn + bước hiện tại (đỏ khi quá hạn); tóm tắt chi tiết.
import { describe, expect, it } from "bun:test";
import type { ContractProgress } from "@ai/contracts";
import { summaryRows } from "../../contract-review/lib/summary";
import { dealOfRow, partnerOfRow, stageView } from "./row-view";

const prog = (o: Partial<ContractProgress>): ContractProgress => ({
  id: "i",
  deal: "sell",
  start_date: "2026-01-01",
  stage: "in_progress",
  next: { id: "n", kind: "collect", title: "Thu tiền", due_date: "2026-10-01", overdue: true },
  ...o,
});

describe("danh sách HĐ v2", () => {
  it("loại: progress thắng; HĐ cũ suy từ hướng; không rõ ⇒ null", () => {
    expect(dealOfRow({ direction: "purchase" }, prog({ deal: "referral" }))).toBe("referral");
    expect(dealOfRow({ direction: "purchase" }, undefined)).toBe("buy");
    expect(dealOfRow({ direction: "sale" }, undefined)).toBe("sell");
    expect(dealOfRow({ direction: null }, undefined)).toBeNull();
  });
  it("đối tác: Mua ⇒ bên bán; Bán/Giới thiệu ⇒ bên mua", () => {
    const r = { seller: "A", buyer: "B" };
    expect(partnerOfRow(r, "buy")).toBe("A");
    expect(partnerOfRow(r, "sell")).toBe("B");
    expect(partnerOfRow(r, "referral")).toBe("B");
  });
  it("giai đoạn: quá hạn đỏ + bước hiện tại; chưa theo dõi ⇒ nhãn trạng thái", () => {
    expect(stageView({ status: "active" }, prog({}))).toEqual({
      kind: "stage",
      stage: "in_progress",
      overdue: true,
      step: "Thu tiền",
    });
    expect(stageView({ status: "active" }, prog({ stage: "done", next: null }))).toEqual({
      kind: "stage",
      stage: "done",
      overdue: false,
      step: null,
    });
    expect(stageView({ status: "needs_review" }, prog({}))).toEqual({ kind: "status" });
    expect(stageView({ status: "active" }, undefined)).toEqual({ kind: "status" });
  });
});

describe("tóm tắt HĐ", () => {
  it("các điểm chính suy từ dữ liệu; Giới thiệu hiện hoa hồng thay giá trị", () => {
    const tx = {
      labels: {
        deal: "Loại",
        partner: "Đối tác",
        commission: "Hoa hồng",
        value: "Giá trị",
        period: "Hiệu lực",
        progress: "Tiến độ",
        next: "Bước",
        lines: "Dòng",
      },
      dealName: (d: string) => d,
      progress: (a: number, b: number) => `${a}/${b}`,
    };
    const base = {
      deal: "sell",
      direction: "sale",
      items: [],
      milestones: [],
      next_milestone_id: null,
      commission_pct: null,
      commission_fixed: null,
      fields: {
        total_value: { value: 1_000_000 },
        start_date: { value: "2026-01-01" },
        end_date: { value: null },
      },
      // biome-ignore lint/suspicious/noExplicitAny: dữ liệu thử rút gọn
    } as any;
    const rows = Object.fromEntries(summaryRows(base, "Cty B", tx));
    expect(rows["Giá trị"]).toBe("1.000.000 đ");
    expect(rows["Hiệu lực"]).toBe("01/01/2026 → —");
    expect(rows["Tiến độ"]).toBe("0/0");
    const ref = Object.fromEntries(
      summaryRows({ ...base, deal: "referral", commission_pct: 8 }, "Cty B", tx),
    );
    expect(ref["Hoa hồng"]).toBe("8%");
    expect(ref["Giá trị"]).toBeUndefined();
  });
});
