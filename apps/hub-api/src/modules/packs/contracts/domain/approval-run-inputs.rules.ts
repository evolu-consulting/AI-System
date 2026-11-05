// CR-121 F-5 · input run lấy từ HĐ (tiêu đề, loại, đối tác, giá trị, số HĐ, người phụ trách, ngày) — cùng một hàm cho lúc mở run và
// lúc cập nhật sau "Xác nhận và lưu" (HĐ lúc mở run còn tên file/chưa có số). Thuần, lớp 1. Rỗng ⇒ quy trình không có bước dùng input HĐ.
import type { FlowStep } from "./approval-flow.types";
import { difyRunInputs, hasDifyStep } from "./approval-flow-dify.rules";
import { hasNotifyOrWait, notifyRunInputs } from "./approval-flow-notify.rules";

export type ContractInputFacts = {
  title: string;
  deal: string | null;
  totalValue: unknown;
  partner: string;
  number?: string | null | undefined;
  owner?: string | null | undefined;
  endDate?: string | null | undefined;
  actionDeadline?: string | null | undefined;
};

/** Quy trình có bước đọc input HĐ (Dify / Thông báo / Chờ tới). */
export const usesContractInputs = (steps: readonly FlowStep[]): boolean =>
  hasDifyStep(steps) || hasNotifyOrWait(steps);

/** Input HĐ (không gồm tham số `select` của Dify — theo catalog, chỉ dựng lúc mở run). */
export function contractRunInputs(steps: readonly FlowStep[], f: ContractInputFacts) {
  if (!usesContractInputs(steps)) return [];
  return [
    ...difyRunInputs(f),
    ...(hasNotifyOrWait(steps)
      ? notifyRunInputs({
          number: f.number ?? null,
          owner: f.owner ?? null,
          endDate: f.endDate ?? null,
          actionDeadline: f.actionDeadline ?? null,
        })
      : []),
  ];
}
