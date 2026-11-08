// CR-126 · tách từ ProcessCanvas (giữ file ≤ 400 dòng): cạnh cuối cùng của sơ đồ (bước + nhảy), chưa tô kiểu.
import { stepEdges } from "@ai/flow-canvas/pure";
import { applyJumps } from "../../lib/jump-edges";
import type { TriggerInfo } from "./canvas-parts";
import { isTerminalView } from "./FlowNodeBody";
import type { StageView } from "./stage-view";

export function linkedEdges(views: readonly StageView[], trig: TriggerInfo) {
  const byUid = new Map(views.map((v) => [v.uid, v]));
  // CR-122 · C: flow có "Bắt đầu khi" bỏ cạnh quay lại tới bước đầu (không còn tiêu đề cột để neo)
  const lay = stepEdges(
    views.map((v) => ({ ...v, terminal: isTerminalView(v) })),
    { back: !trig },
  );
  // dlc-engine · bước DLC và bước duyệt không nối với nhau (một sơ đồ chỉ một loại bước).
  const fam = (id: string) => byUid.get(id)?.family ?? null;
  const jumped = applyJumps(
    views.map((v) => ({
      uid: v.uid,
      step: v.step,
      isIf: v.ifs != null,
      nextStep: v.src.nextStep,
      terminal: v.src.outcome !== undefined || v.src.executor === "wait_event",
    })),
    lay,
  );
  return jumped.filter((e) => {
    const [a, b] = [fam(e.source), fam(e.target)];
    return a === null || b === null || a === b;
  });
}
