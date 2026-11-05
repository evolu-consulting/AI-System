// CR-118 · UW-FR-10/11/13/14 · ADR-0035 · cổng "app chạy theo flow tại khe" của kit (lớp 2: chỉ kiểu + điều phối thuần).
// Mỗi gói cung cấp `FlowSlotAdapter` cho khe của mình (ref → lượt, quyền đọc thực thể, hành động của gói) — tra ref LUÔN
// trong tx tenant của gói (RLS), nên ref tenant khác/không thấy ⇒ `not_found` (không lộ tồn tại). Đối tác (user ngoài) KHÔNG
// BAO GIỜ là người xem/người làm bước ở khe (intake câu 17) ⇒ chặn ở `flowRuntime` trước khi gọi adapter.
import type { FlowActionRequest, FlowSummaryItem, FlowView } from "@ai/contracts/flow";
import { isExternal } from "./ext-org.ports";
import type { PackWho } from "./ports";

/** Lỗi do gói dịch (mã + HTTP) — route ném nguyên. */
export type FlowActError = {
  error: { code: string; status: 400 | 403 | 404 | 409 | 422 | 429 | 503 };
};
export type FlowActOutcome = { view: FlowView } | "not_found" | FlowActError;

export type FlowSlotAdapter = {
  slot: string;
  packKey: string;
  view(who: PackWho, ref: string): Promise<FlowView | null>;
  act(
    who: PackWho,
    ref: string,
    taskId: string,
    action: string,
    req: FlowActionRequest,
  ): Promise<FlowActOutcome>;
  /** Huy hiệu cho lô ≤ 100 ref: số SQL CỐ ĐỊNH mỗi lô (Luật 4c); ref không thấy ⇒ vắng. */
  summary(who: PackWho, refs: readonly string[]): Promise<FlowSummaryItem[]>;
};

export type FlowDenied = "no_slot" | "forbidden";
export type FlowRuntime = {
  view(who: PackWho, slot: string, ref: string): Promise<FlowView | null | FlowDenied>;
  act(
    who: PackWho,
    slot: string,
    ref: string,
    taskId: string,
    action: string,
    req: FlowActionRequest,
  ): Promise<FlowActOutcome | FlowDenied>;
  summary(
    who: PackWho,
    slot: string,
    refs: readonly string[],
  ): Promise<FlowSummaryItem[] | FlowDenied>;
};

/** Runtime của MỘT gói: chọn adapter theo khe; khe không thuộc gói ⇒ `no_slot`; đối tác ⇒ `forbidden`. */
export function flowRuntime(packKey: string, adapters: readonly FlowSlotAdapter[]): FlowRuntime {
  const by = new Map(adapters.filter((a) => a.packKey === packKey).map((a) => [a.slot, a]));
  const pick = (who: PackWho, slot: string): FlowSlotAdapter | FlowDenied => {
    if (isExternal(who)) return "forbidden";
    return by.get(slot) ?? "no_slot";
  };
  return {
    view: async (who, slot, ref) => {
      const a = pick(who, slot);
      return typeof a === "string" ? a : a.view(who, ref);
    },
    act: async (who, slot, ref, taskId, action, req) => {
      const a = pick(who, slot);
      return typeof a === "string" ? a : a.act(who, ref, taskId, action, req);
    },
    summary: async (who, slot, refs) => {
      const a = pick(who, slot);
      return typeof a === "string" ? a : a.summary(who, refs);
    },
  };
}

/** Cờ flow runtime (CR-120 · ADR-0036 §5): seam test ưu tiên; mặc định BẬT, chỉ `HUB_FLOW_RUNTIME=off` tắt (tắt ⇒ route không
 *  gắn ⇒ 404; cờ `/pack/me.flags["flow.runtime"]` tắt; web KHÔNG còn đường dự phòng về approvals cũ — CR-121 gỡ legacy-act). */
export const flowRuntimeOn = (seam: boolean | undefined, env = process.env.HUB_FLOW_RUNTIME) =>
  seam ?? env !== "off";
