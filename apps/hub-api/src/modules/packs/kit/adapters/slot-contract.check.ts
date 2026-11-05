// CR-120 §2 · ADR-0036 · kiểm lúc khởi động: khe manifest thiếu `SlotSpec`/`FlowSlotAdapter` ⇒ log error (không chặn boot). Adapter
// đăng ký khoá khe vào `flowAdapterSlots` lúc dựng runtime của gói (vd `contracts/flow.mount.ts`).
import { APP_MANIFESTS } from "@ai/contracts";
import { logger } from "../../../../lib/logger";
import { flowRuntimeOn } from "../application/flow.ports";
import { type SlotContractGap, slotContractGaps } from "../domain/slot-contract.rules";
import { slotRegistry } from "./slot-registry";

/** Khoá khe đã có `FlowSlotAdapter` trong process (gói thêm khi dựng `flowRuntime`). */
export const flowAdapterSlots = new Set<string>();

export function currentSlotContractGaps(runtimeOn = flowRuntimeOn(undefined)): SlotContractGap[] {
  const specs = new Set(slotRegistry.list().map((s) => s.key));
  return slotContractGaps(Object.values(APP_MANIFESTS), specs, runtimeOn ? flowAdapterSlots : null);
}

/** Gọi MỘT lần sau khi mọi gói đã mount; trả số lỗ hổng. */
export function checkSlotContract(runtimeOn?: boolean): number {
  const gaps = currentSlotContractGaps(runtimeOn);
  for (const g of gaps)
    logger.error("slot-contract-gap", { app: g.app, slot: g.slot, missing: g.missing });
  return gaps.length;
}
