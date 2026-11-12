// CR-127 · X5 · spec §5.9 · BR-40: luật «đang xử lý» của việc Xác nhận mốc, áp trong `recordFulfillment` (một đường ghi duy nhất).
// Thuần (không I/O): đầu vào = người giữ việc mở của mốc (`FlowTaskSignal.holder`), người ghi, có đặc quyền (người phụ trách HĐ / quản trị công ty).
export type MilestoneHolder = {
  taskId: string;
  claimedBy: string | null;
  assigneeIds: readonly string[];
};
export type ClaimVerdict =
  | { ok: true }
  | { ok: false; kind: "claimed"; by: string }
  | { ok: false; kind: "not_claimed" };

/**
 * Không có việc mở ⇒ đường cũ (ai có quyền ghi thì ghi). Có việc: người đã nhận / người phụ trách / quản trị công ty ⇒ được; việc đã có
 * người nhận mà người ghi là người khác ⇒ `claimed`; chưa ai nhận ⇒ thành viên nhóm phải Nhận việc trước (`not_claimed`).
 */
export function claimVerdict(
  holders: readonly MilestoneHolder[],
  userId: string,
  privileged: boolean,
): ClaimVerdict {
  if (holders.length === 0 || privileged) return { ok: true };
  if (holders.some((h) => h.claimedBy === userId)) return { ok: true };
  const other = holders.find((h) => h.claimedBy !== null);
  if (other?.claimedBy) return { ok: false, kind: "claimed", by: other.claimedBy };
  return { ok: false, kind: "not_claimed" };
}
