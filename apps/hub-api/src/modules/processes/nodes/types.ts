// CR-103 · R1 fnr-registry · design §1: hình một loại node (phần THUẦN — kiểm def, chuẩn hoá khi lưu, cờ năng lực).
// Phần chạy (launch) ở `runs/launch-common.ts` (`NodeLauncher`). Lõi chỉ đọc qua `nodes/registry` (+ `registry.launch`).
import type {
  ExecutorKind,
  NodeFamily,
  ProcessDefInput,
  ProcessDefRule,
} from "@ai/contracts/hub-admin";
import type { DefRefs, RefMiss } from "../defs/def-refs";

export type DefStage = ProcessDefInput["stages"][number];
export type DefExecutor<K extends ExecutorKind> = Extract<DefStage["executor"], { kind: K }>;
export type DefIssue = { path: string; rule: ProcessDefRule };

export type NodeSpec<K extends ExecutorKind = ExecutorKind> = {
  kind: K;
  family: NodeFamily;
  /** field output node chắc chắn cung cấp: "declared" = theo `output.fields` của stage (R3 `canSwap` dùng). */
  produces: "declared" | "none";
  /** D4 · C50 · D2-49 · stage `real_action` của loại này đi qua cổng hành động thật (`realActionPre`). */
  realAction: boolean;
  /** HUB-FR-136 · stage có mục "Bàn giao" do Hub thêm khi lưu (`ensureHandoff`). */
  handoff: boolean;
  /** Stage chạy bằng đúng MỘT agent ⇒ agent_id (phiên CLI, preconfirm, audit, đích KH). Vắng ⇒ không phải agent đơn. */
  agentId?(ex: { kind: string }): string | null;
  /** REF_INVALID: tham chiếu của executor không có trong `refs` (xét TRƯỚC Group kiểm / người trả lời). */
  refMiss?(ex: DefExecutor<K>, path: string, refs: DefRefs): RefMiss | null;
  /** Luật INVALID chéo stage của loại (gọi theo thứ tự `NODE_LIST`, sau `processDefStageIssues`). */
  defIssues?(d: ProcessDefInput, refs: DefRefs): DefIssue[];
  /** Hub ép trường khi lưu def (sau `ensureHandoff`). Thuần, idempotent. */
  normalize?<S extends DefStage>(s: S): S;
  /** Key tool cần nạp vào `DefRefs.tools` trước khi kiểm. */
  toolKey?(ex: DefExecutor<K>): string;
};
