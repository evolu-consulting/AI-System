// CR-125 · m2 · MOD-FR-01/02/04 · cổng của SỔ MODULE phía máy chủ: mỗi node/sự kiện khai ở `@ai/contracts/modules` có ĐÚNG MỘT chỗ
// đăng ký xử lý (tool, bộ đọc dữ kiện, xử lý kết quả, validator cấu hình, `options_path`). Lớp 2 — chỉ kiểu; không I/O.
import type { AnySchema, FeatureModule, ModuleIssue } from "@ai/contracts/modules";
import type { FactsReader, OutcomeHandler } from "./flow-events.ports";

/** Validator cấu hình node (cùng kiểu `nodeConfigRegistry`), khai ở đây để kit không vòng tham chiếu. */
export type NodeBindingValidator = (
  tenantId: string,
  stage: { index: number; node: string; executor: unknown },
) => Promise<readonly { path: string; code: string }[]>;

/** Xử lý máy chủ của MỘT node (khoá `<app>.<node>`). Gọi nhiều lần cùng khoá ⇒ gộp (hợp tập tool, trường sau thắng). */
export type NodeBinding = {
  key: string;
  /** Bước cơ bản của lõi: `executor.kind` engine đang chạy (ghi nhận; không đổi cách engine chạy). */
  executor?: string;
  /** Khoá tool các stage của node gọi (kiểm `MOD_TOOL_MISSING` với tool đã `bindTool`). */
  tools?: readonly string[];
  /** Schema args của tool để so với `configPort.schema` của node (MOD-FR-04 · `MOD_PORT_MISMATCH`). */
  argsSchema?: AnySchema;
  /**
   * CR-125 · m8 · khoá đầu ra mà xử lý máy chủ THẬT SỰ ghi vào dữ liệu lượt chạy (`process_outputs.fields` của bước) khi node chạy.
   * Phải khớp `outputs` (không `pending`) của khai báo — lệch ⇒ `MOD_OUTPUT_UNBOUND` lúc khởi động.
   */
  outputs?: readonly string[];
  /** Validator theo KHOÁ NODE ⇒ `nodeConfigRegistry.register`. */
  validate?: NodeBindingValidator;
  /** Validator theo KHOÁ TOOL ⇒ `nodeConfigRegistry.registerTool` (def gọi thẳng tool không mang `node` cũng bị kiểm). */
  toolValidators?: Readonly<Record<string, NodeBindingValidator>>;
  /** Đường nạp lựa chọn cho panel (khớp `config.options_path` của khai báo). */
  optionsPath?: string;
};

/** Xử lý của sự kiện app: bộ đọc dữ kiện và/hoặc xử lý kết quả (khoá `<packKey>` × `events` của chính đối tượng). */
export type EventBinding<TX = never> = {
  facts?: FactsReader;
  outcome?: OutcomeHandler<TX>;
};

export type ModuleVerifyOpts = {
  /** App đang gắn ở lần mount này (vắng ⇒ mọi app). Khai báo + binding của app ngoài tập bị bỏ qua. */
  apps?: readonly string[];
  log?: (message: string, meta?: Record<string, unknown>) => void;
};

export type ModuleRegistry = {
  bindNode(b: NodeBinding): void;
  /** Ghi nhận tool đã đăng ký vào `PackToolRegistry` (không đăng ký hộ — đường cũ giữ nguyên). */
  bindTool(t: { pack: string; name: string }): void;
  bindEvent<TX = never>(b: EventBinding<TX>): void;
  bindingOf(nodeKey: string): NodeBinding | undefined;
  /** Chỉ tính, không ném. */
  issues(mods: readonly FeatureModule[], opts?: ModuleVerifyOpts): ModuleIssue[];
  /** Có lỗi ⇒ log `error` + ném `Khởi động dừng: N lỗi module` kèm từng dòng. */
  verify(mods: readonly FeatureModule[], opts?: ModuleVerifyOpts): void;
};
