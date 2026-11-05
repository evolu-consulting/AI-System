// CR-118 · cr118-flow-web · kiểu của renderer bước. `StepRenderers` BẮT BUỘC đủ mọi `FlowStepKind` ⇒ thêm loại bước vào contract mà
// quên renderer = lỗi typecheck (spec §5). Loại lạ (snapshot cũ) đi qua `GenericStep`, không qua map.
import type {
  FlowFormValues,
  FlowStepKind,
  FlowStepView,
  FlowStepViewOf,
  FlowTask,
  FlowView,
} from "@ai/contracts/flow";
import type { ComponentType, LazyExoticComponent } from "react";

export type StepContext = {
  slot: string;
  /** Mã thực thể của khe (id HĐ ở `contracts.approval`). */
  refId: string;
  view: FlowView;
  /** Mốc giờ (ms) của lần vẽ — cho nhãn "còn Nh"/"quá Nh". */
  now: number;
  /** Task ĐANG MỞ của người xem ở bước `key` (rỗng ⇒ chỉ xem). */
  taskOf(stepKey: string): FlowTask | null;
  /** Gửi form của task `taskId`; lỗi ném cho renderer báo (`FlowFormError` khi Hub báo sai giá trị). */
  submitForm?(taskId: string, values: FlowFormValues): Promise<void>;
};

export type StepProps<K extends FlowStepKind> = { step: FlowStepViewOf<K>; ctx: StepContext };
export type StepComponent<K extends FlowStepKind> =
  | ComponentType<StepProps<K>>
  | LazyExoticComponent<ComponentType<StepProps<K>>>;
/** Thiếu một loại ⇒ lỗi typecheck. */
export type StepRenderers = { [K in FlowStepKind]: StepComponent<K> };
/** Khe của gói có thể thay renderer của từng loại (đồng bộ, không lazy — gói đã nằm trong chunk route của nó). */
export type StepOverrides = { [K in FlowStepKind]?: StepComponent<K> };

/** Bước vẽ theo phần chung (loại lạ / GenericStep): chỉ đọc các trường nền. */
export type AnyStepProps = { step: FlowStepView; ctx: StepContext };

/** Hub báo giá trị form sai (`FORM_VALUES_INVALID`, `details.paths` = key trường). */
export class FlowFormError extends Error {
  readonly paths: readonly string[];
  constructor(paths: readonly string[]) {
    super("FORM_VALUES_INVALID");
    this.name = "FlowFormError";
    this.paths = paths;
  }
}
