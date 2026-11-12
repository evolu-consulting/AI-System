// CR-127 · E10 · spec §5.9 · BR-31 · khai báo node «Xác nhận mốc» (việc nhóm). Engine mở `review_tasks kind='milestone'`
// (`subject_ref` = id mốc = `ref` của lượt `milestone.due`) khi tới stage chờ; task đóng khi mốc xong bằng bất kỳ đường nào: gói
// contracts chỉ ghi tín hiệu `hub.task_signal` (port kit `FlowTaskSignal.complete`), vòng `task-signal` của engine khoá run → task,
// đóng task rồi bắn sự kiện dưới đây cho stage chờ. Giao việc mặc định: phòng của người phụ trách HĐ (phòng đầu tiên theo thứ tự
// thành viên), không phòng ⇒ đích danh người phụ trách (#60).
import type { FeatureNodeDecl } from "../../types";

/** Sự kiện engine bắn khi task Xác nhận mốc đóng (mốc xong / mốc bị dời ⇒ huỷ task cũ). */
export const MILESTONE_TASK_DONE_EVENT = "milestone.confirmed";
export const MILESTONE_TASK_CANCELLED_EVENT = "milestone.task_cancelled";
/** Lưới an toàn: mốc không ai xác nhận sau 90 ngày ⇒ đi cổng «Hết hạn». */
export const MILESTONE_TASK_TIMEOUT_H = 2160;

export const MILESTONE_CONFIRM_NODE: FeatureNodeDecl = {
  key: "contracts.milestone-confirm",
  label: { vi: "Xác nhận mốc", en: "Confirm milestone" },
  group: "people", // CR-127 · U2 · nhóm «Người làm» trên menu «+»
  menu: { section: "business", order: 40 },
  kind: "app",
  feature: "contracts-write",
  exits: [
    { key: "done", label: { vi: "Đã xác nhận", en: "Confirmed" } },
    {
      key: "cancelled",
      label: { vi: "Mốc đã dời", en: "Milestone moved" },
      on: [MILESTONE_TASK_CANCELLED_EVENT],
    },
    { key: "expired", label: { vi: "Hết hạn", en: "Expired" }, on: ["timeout"] },
  ],
  stages: [
    {
      executor: {
        kind: "wait_event",
        event: MILESTONE_TASK_DONE_EVENT,
        also_events: [MILESTONE_TASK_CANCELLED_EVENT],
        timeout_h: MILESTONE_TASK_TIMEOUT_H,
      },
    },
  ],
  inputs: [],
  outputs: [
    {
      key: "event",
      type: "string",
      required: true,
      label: { vi: "Kết quả xác nhận mốc", en: "Milestone outcome" },
    },
  ],
};
