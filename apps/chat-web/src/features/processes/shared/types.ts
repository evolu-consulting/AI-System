// CR-056 · P-a: kiểu dùng chung của quy trình ở chat-web (tái xuất từ contract để PF không import chéo).
import type {
  ProcessRunFullView,
  RoomMessage,
  RoomProcessKind,
  RoomProcessPart,
  TaskDetail,
  TaskResult,
} from "@ai/contracts/chat";

export type {
  OpenTask,
  ProcessOutput,
  ProcessRunFullView,
  ProcessRunSummary,
  ProcessRunTaskView,
  ProcessRunView,
  RoomProcessPart,
  StageView,
  TaskDetail,
} from "@ai/contracts/chat";

/** FD2: `on` bật; `off` (404/403) ẩn mọi lối vào; `unknown` (đang dò / lỗi mạng / 5xx) ẩn như `off`. */
export type EngineState = "on" | "off" | "unknown";

/** Props chung của ba thẻ việc (`ReviewTaskCard` PF1, `AskTaskCard` PF2, `DecisionCard` PF1). `view` vắng ở chế độ inline ngoài phòng. */
export type TaskCardProps = {
  runId: string;
  task: TaskDetail;
  view?: ProcessRunFullView;
  /** DM inline (NoticeCard, PF3): người xem tự xử lý xong ⇒ thẻ hiện "Bạn · <kết quả>" (E-P12). */
  onResolved?: (result: TaskResult) => void;
};

/** Props của mỗi loại tin trong thread (`ProcessThreadMessage` truyền xuống; PF hiện thực thân component). */
export type ThreadMessageProps<K extends RoomProcessKind> = {
  message: RoomMessage;
  part: Extract<RoomProcessPart, { kind: K }>;
  roomId: string;
  /** Người đang xem. */
  myId: string;
};
