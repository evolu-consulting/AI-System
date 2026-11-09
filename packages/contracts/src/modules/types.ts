// CR-125 · m1 · MOD-FR-01/05 · kiểu của sổ module tính năng: MỘT khai báo node (+ cổng zod) cho contracts / hub-api / admin-web.
// Chỉ dữ liệu + zod (luật `contracts-only-zod`), không I/O. Kiểu `AppNodeDecl` giữ nguyên ở app-manifest (import KIỂU, không vòng lặp).
import type { z } from "zod";
import type { AppEventDecl, AppNodeDecl, AppSignalDecl } from "../app-manifest/manifest";

/** Schema zod bất kỳ — để tầng application (hub-api) nhận kiểu schema mà không import thẳng zod. */
export type AnySchema = z.ZodTypeAny;

/** Gợi ý ô nhập cho panel chung (không phải code UI). */
export type PortWidget =
  | "person"
  | "people"
  | "department"
  /** CR-126 · nhóm (Group) phụ trách một bước — cùng ô chọn nhóm với `department`. */
  | "group"
  | "days"
  | "hours"
  | "text"
  | "longtext"
  | "enum"
  | "money"
  | "date";

/** Cổng = zod schema + gợi ý ô; MỘT nguồn: cổng cấu hình của node = schema args của tool. */
export type PortSchema<T extends z.ZodTypeAny = z.ZodTypeAny> = {
  schema: T;
  /** khoá trường ⇒ ô nhập; vắng ⇒ panel chung suy từ kiểu zod. */
  widgets?: Readonly<Record<string, PortWidget>>;
  /** CR-126 · khoá vẫn nằm trong schema/args (tương thích) nhưng KHÔNG hiện ở panel cấu hình (đã có ở form của node). */
  hidden?: readonly string[];
};

/** `base` = bước cơ bản của lõi (khớp def cũ theo `executor.kind`); `app` = node của một app (cần binding ở máy chủ). */
export type NodeKind = "base" | "app";

export type FeatureNodeDecl = AppNodeDecl & {
  kind: NodeKind;
  /** Bước cơ bản: `executor.kind` lõi (approve, if, notify, wait_until, wait_for, set+outcome = Kết thúc) — def cũ không có `stage.node` vẫn khớp theo đây. */
  baseExecutor?: string;
  /** Cổng cấu hình = args của stage `config.stage` (tool) — thay dần `AppNodeIo` cho phần cấu hình. */
  configPort?: PortSchema;
  /** true ⇒ chỉ ghi nhận (DLC của Rowan): sổ chỉ kiểm khoá trùng, không đòi binding/schema. */
  legacy?: boolean;
};

export type FeatureModule = {
  /** = `AppManifest.key` hoặc `core`. */
  app: string;
  nodes: readonly FeatureNodeDecl[];
  /** Sự kiện của app. m1: sự kiện vẫn khai ở `AppManifest.events` (ghép bằng `withEvents`); chuyển hẳn ở lát sau. */
  events: readonly AppEventDecl[];
  /** Tín hiệu chỉ để node chờ (`wait_event`); không cần binding — phải có node dùng, không thì `MOD_SIGNAL_ORPHAN`. Ghép bằng `withEvents`. */
  signals?: readonly AppSignalDecl[];
};

export const MODULE_ISSUE_CODES = [
  "MOD_DUP",
  "MOD_UNBOUND",
  "MOD_TOOL_MISSING",
  "MOD_PORT_MISMATCH",
  "MOD_EVENT_UNBOUND",
  "MOD_OUTCOME_UNBOUND",
  "MOD_OUTPUT_UNBOUND",
  "MOD_ORPHAN_BINDING",
  "MOD_SIGNAL_ORPHAN",
  "MOD_PANEL_ORPHAN",
  "MOD_INDEX_STALE",
] as const;
export type ModuleIssueCode = (typeof MODULE_ISSUE_CODES)[number];

export type ModuleIssue = {
  code: ModuleIssueCode;
  app: string;
  key: string;
  detail?: string;
  /** Câu lỗi tiếng Việt, có cách khắc phục. */
  message: string;
};

/** Tóm tắt binding máy chủ (chỉ khoá + tham chiếu schema) để `moduleIssues` đối chiếu mà không I/O. */
export type BoundSummary = {
  /** `outputs` = khoá đầu ra mà binding ghi được vào dữ liệu lượt chạy (CR-125 m8 · `MOD_OUTPUT_UNBOUND`). */
  nodes: ReadonlyMap<
    string,
    { tools: readonly string[]; argsSchema?: z.ZodTypeAny; outputs?: readonly string[] }
  >;
  tools: ReadonlySet<string>;
  /** `<app>\0<event>` */
  facts: ReadonlySet<string>;
  /** `<app>\0<event>` */
  outcomes: ReadonlySet<string>;
};
