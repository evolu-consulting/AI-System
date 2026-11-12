// Nhánh tích hợp của các lát (slice:new/merge, openspec, test:affected, depcruise:affected, res:check, slice:pool).
// Người dùng chốt 2026-11-12: `staging-improve` là bản mới nhất. Đổi tạm bằng env `SLICE_BASE`.
export const SLICE_BASE = process.env.SLICE_BASE ?? "staging-improve";
