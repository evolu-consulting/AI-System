// Nhánh tích hợp của các lát (slice:new/merge, openspec, test:affected, depcruise:affected, res:check, slice:pool).
// Người dùng chốt 2026-11-16: làm thẳng trên `staging` (bỏ staging-improve); lên prod = merge staging → main. Đổi tạm bằng env `SLICE_BASE`.
export const SLICE_BASE = process.env.SLICE_BASE ?? "staging";
