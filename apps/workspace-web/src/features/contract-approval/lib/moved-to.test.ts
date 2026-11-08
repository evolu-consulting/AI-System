// CR-120 · "Đã chuyển: <bước>" sau Xác nhận và lưu (thuần).
import { describe, expect, test } from "bun:test";
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { isDraftConfirm, movedToDueHours, movedToStep } from "./moved-to";

const step = (idx: number, name: string, status: string) => ({ idx, name, status });
const card = (steps: ReturnType<typeof step>[]) =>
  ({ mode: "engine", step: "level1", steps }) as unknown as ContractApproval;

describe("movedToStep / isDraftConfirm", () => {
  test("bước soạn đang mở ⇒ chưa chuyển (null) và là 'Xác nhận và lưu'", () => {
    const a = card([step(0, "Xác nhận và lưu", "open"), step(1, "Phòng Kế toán duyệt", "pending")]);
    expect(movedToStep(a)).toBeNull();
    expect(isDraftConfirm(a)).toBe(true);
  });

  test("bước soạn đã Đạt, bước kế mở ⇒ tên bước kế", () => {
    const a = card([step(0, "Xác nhận và lưu", "passed"), step(1, "Phòng Kế toán duyệt", "open")]);
    expect(movedToStep(a)).toBe("Phòng Kế toán duyệt");
    expect(isDraftConfirm(a)).toBe(false);
  });

  test("engine đang chuyển (chưa bước nào mở) hoặc không có thẻ ⇒ null", () => {
    expect(movedToStep(card([step(0, "A", "passed"), step(1, "B", "pending")]))).toBeNull();
    expect(movedToStep(undefined)).toBeNull();
    expect(isDraftConfirm(undefined)).toBe(false);
  });
});

// CR-125 · UX H5: "Đã gửi <bước> · hạn N giờ" — hạn lấy từ bước vừa mở.
describe("movedToDueHours", () => {
  const now = Date.parse("2026-11-08T00:00:00Z");
  const withDue = (due: string | null) =>
    ({
      mode: "engine",
      step: "level1",
      steps: [
        { idx: 0, name: "Xác nhận", status: "passed", due_at: null },
        { idx: 1, name: "Trưởng phòng duyệt", status: "open", due_at: due },
      ],
    }) as unknown as ContractApproval;

  test("hạn của bước vừa mở", () => {
    expect(movedToDueHours(withDue("2026-11-09T00:00:00Z"), now)).toBe(24);
    expect(movedToDueHours(withDue(null), now)).toBeNull();
    expect(movedToDueHours(withDue("2026-11-07T00:00:00Z"), now)).toBeNull();
  });
});
