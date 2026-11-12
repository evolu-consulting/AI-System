// CR-127 · E10 · spec §5.9 · binding máy chủ của node «contracts.milestone-confirm» (Xác nhận mốc). Node KHÔNG có tool: stage chờ sự kiện
// do engine bắn khi việc nhóm đóng (vòng `task-signal`); gói chỉ ghi tín hiệu qua `FlowTaskSignal.complete` (X5). `mountContractSchedules`
// (schedule-sources.mount.ts — nơi có nguồn `milestone.due`) gọi file này; `moduleRegistry.verify` kiểm lúc khởi động.
import type { NodeBinding } from "../../../kit/public";

export const MILESTONE_CONFIRM_KEY = "contracts.milestone-confirm";

export const milestoneConfirmBinding = (): NodeBinding => ({
  key: MILESTONE_CONFIRM_KEY,
  tools: [],
  // Stage chờ ghi `event` (đã xác nhận / mốc dời / hết hạn).
  outputs: ["event"],
});
