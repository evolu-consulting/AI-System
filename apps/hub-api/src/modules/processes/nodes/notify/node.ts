// CR-121 D-6 · node `notify` (họ work, không AI/agent): Hub ghi thông báo vào hàng gửi (outbox `hub.notifications`) cùng tx rồi
// xong bước ngay. Phần thuần: luật def (NOTIFY_INVALID) + ép trường khi lưu. Phần chạy: `./launch.ts`.
import { NODE_FAMILY_OF } from "@ai/contracts/hub-admin";
import type { NodeSpec } from "../types";
import { ensureNotifyStage, notifyDefIssues } from "./notify.rules";

export const notifyNode: NodeSpec<"notify"> = {
  kind: "notify",
  family: NODE_FAMILY_OF.notify,
  produces: "none",
  realAction: false,
  handoff: false,
  defIssues: notifyDefIssues,
  normalize: ensureNotifyStage,
};
