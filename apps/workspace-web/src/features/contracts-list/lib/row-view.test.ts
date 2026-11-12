// V2-F · HD-03: ô của dòng danh sách — loại, đối tác theo loại, giai đoạn + bước hiện tại (đỏ khi quá hạn); tóm tắt chi tiết.
import { describe, expect, it } from "bun:test";
import type { ContractProgress } from "@ai/contracts/pack-contracts";
import { summaryRows } from "../../contract-review/lib/summary";
import { daysLeftOf, dealOfRow, partnerOfRow, statusView, waitingView } from "./row-view";

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
  it("ô Trạng thái: chip hiệu lực chỉ khi DONE; tạm khoá; AI đang đọc/lỗi không phải trạng thái", () => {
    const r = { status: "done", effect: "expiring", hold: null, extract_state: "ready" } as const;
    expect(statusView(r, 12)).toEqual({
      effect: { effect: "expiring", tone: "soon", daysLeft: 12 },
      held: false,
      extract: null,
    });
    expect(statusView({ ...r, status: "processing" }, 12).effect).toBeNull();
    expect(statusView({ ...r, status: "draft", extract_state: "reading" }, null).extract).toBe(
      "reading",
    );
    expect(statusView({ ...r, status: "draft", extract_state: "failed" }, null).extract).toBe(
      "failed",
    );
    expect(statusView({ ...r, hold: { by: "u", reason: "x" } }, null).held).toBe(true);
  });
  it("Đang chờ: không có lượt duyệt mở ⇒ null; quá hạn khi hạn đã qua", () => {
    const now = new Date("2026-11-10T10:00:00Z");
    expect(waitingView(null, now)).toBeNull();
    expect(waitingView(undefined, now)).toBeNull();
    expect(
      waitingView({ step: "Kế toán", who: "Lan", due_at: "2026-11-11T10:00:00Z" }, now),
    ).toEqual({
      step: "Kế toán",
      who: "Lan",
      due: "2026-11-11",
      overdue: false,
    });
    expect(
      waitingView({ step: "Ký số", who: null, due_at: "2026-11-09T10:00:00Z" }, now)?.overdue,
    ).toBe(true);
    expect(waitingView({ step: null, who: null, due_at: null }, now)?.overdue).toBe(false);
  });
  it("daysLeftOf: số ngày lịch tới ngày hết hạn", () => {
    expect(daysLeftOf("2026-11-22", new Date(2026, 10, 10))).toBe(12);
    expect(daysLeftOf(null)).toBeNull();
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
