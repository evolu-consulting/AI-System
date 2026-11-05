// CR-120 · "Đã chuyển: <bước>" sau Xác nhận và lưu (thuần).
import { describe, expect, test } from "bun:test";
import type { ContractApproval } from "@ai/contracts/pack-contracts";
import { isDraftConfirm, movedToStep } from "./moved-to";

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
