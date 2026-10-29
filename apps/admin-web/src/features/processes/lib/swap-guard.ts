// CR-103 · R3 fnr-swap: bọc `canSwap` (contracts) cho draft editor — dựng def từ các stage đã đủ để chuyển, bỏ stage dở dang.
import {
  type CanSwap,
  canSwap,
  type ExecutorKind,
  type ProcessStageDef,
} from "@ai/contracts/hub-admin";
import { draftKindOf } from "../nodes/registry";
import type { StageDraft } from "./draft-types";
import { stageToInput } from "./stage-convert";

/** Stage `index` đổi sang loại `to` được không. Stage chưa chọn loại / chưa chuyển được sang def ⇒ ok (server kiểm lại khi lưu). */
export function swapCheck(all: readonly StageDraft[], index: number, to: ExecutorKind): CanSwap {
  const cur = all[index];
  if (!cur || draftKindOf(cur.executor) === null) return { ok: true };
  const stages: ProcessStageDef[] = [];
  let at = -1;
  all.forEach((s, i) => {
    try {
      stages.push(stageToInput(s));
      if (i === index) at = stages.length - 1;
    } catch {
      /* stage dở dang: bỏ qua */
    }
  });
  return at < 0 ? { ok: true } : canSwap({ stages }, at, to);
}
