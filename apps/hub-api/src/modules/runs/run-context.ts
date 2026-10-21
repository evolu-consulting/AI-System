// HUB-FR-41 · kiểu ngữ cảnh run cho vòng chạy (RunDriver) — tách khỏi runs.service.ts cho gọn file ≤ 400 dòng (one-agent).
import type { HistoryItem } from "@ai/contracts/hub";
import type { Logger } from "../../lib/logger";
import type { NoMatchPolicy } from "../agents/default-agent.rules";
import type { RunFile } from "../attachments/run-files.rules";
import type { ConfigSnapshot, PickedOrchestrator } from "../config/config.rules";
import type { DirectRunStart } from "../mention/mention.service";
import type { SseWriter } from "./sse/sse-writer";
/** Ngữ cảnh một run cho vòng chạy: ghi sự kiện qua `writer`, kết thúc bằng `writer.finish`, dừng khi `writer.signal`. */
export type RunContext = {
  writer: SseWriter;
  /** Ảnh cấu hình chụp lúc tạo run (H1-R15, HUB-BR-06). */
  snapshot: ConfigSnapshot;
  content: string;
  /**
   * H2b P7 · Orchestrator chọn lúc tạo run (`pickOrchestrator`, gọi cả cho `direct` để lấy `history_n`, P10); null = không
   * có bản hợp lệ nào. Driver không chọn lại.
   */
  orchestrator: PickedOrchestrator | null;
  /** H2b P10 · run `direct`: agent + nội dung R04 (driver `directDriver`); vắng = không phải run `direct`. */
  direct?: DirectRunStart;
  /** H2b R09 · run `orchestrated` nhiều tag: key agent được tag (thu hẹp `<agents>` + `canDelegate`); vắng = đủ AU. */
  scope?: ReadonlySet<string>;
  /** H2c-R14, P9 · tập file của run (`runs.attachment_ids`, chốt ở `createRunTx`); `[]` khi không file. */
  files: RunFile[];
  /**
   * X2b D7 · ngữ cảnh phòng (cũ→mới, chụp trong tx gọi, cắt tại tin gọi): có ⇒ Orchestrator / `directDriver` dùng
   * **thay** `flowHistory` (không đọc `hub.messages`); vắng = C1.
   */
  roomHistory?: readonly HistoryItem[];
  /** CR-054 · tin không tag → Orchestrator là agent mặc định: xử lý khi không khớp (vắng = như trước, `answer`). */
  noMatch?: NoMatchPolicy;
  /** one-agent · khối ngữ cảnh (nơi gửi, màn hình, bản ghi đã kiểm RLS) nối sau system prompt của agent run `direct`. */
  systemNote?: string;
  log: Logger;
};

/** Chỗ cắm B8 (Orchestrator, dùng runner B7). Không chờ: chạy nền, tự `finish`. */
export interface RunDriver {
  start(ctx: RunContext): void;
}
