// ADM-FR-71 · P-b2 (plan-frontend FB3/FB7): trạng thái của StageWorkbench — giai đoạn đang chọn, chế độ xem, xoá có xác nhận,
// mô hình hiển thị ổn định tham chiếu (gõ ở panel không dựng lại canvas).
import { useRef, useState } from "react";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { useStageOps } from "../../hooks/use-stage-ops";
import { type StageView, sameView, stageViews } from "./stage-view";

export const PANEL_ID = "stage-panel";
export type Mode = "canvas" | "list";

function useStableViews(next: StageView[]): StageView[] {
  const prev = useRef(next);
  const same =
    prev.current.length === next.length &&
    next.every((v, i) => sameView(v, prev.current[i] as StageView));
  if (!same) prev.current = next;
  return prev.current;
}

export function useWorkbench(d: DraftState, refs: EditorRefs) {
  const ops = useStageOps(d);
  const [removing, setRemoving] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(() => (window.innerWidth < 768 ? "list" : "canvas"));
  const stages = d.draft.stages;
  const sel = stages.find((s) => s.uid === d.selected) ?? stages[0];
  const views = useStableViews(stageViews(stages, d.errors, refs));

  /**
   * Chọn giai đoạn; bằng bàn phím (Enter/Space) ⇒ đưa focus vào ô "Tên giai đoạn".
   * Màn < 1024 px (panel xếp DƯỚI danh sách, quyết định FB-3 — UAT L4): cuộn panel vào khung nhìn + focus vùng panel.
   */
  const select = (uid: string, byKeyboard: boolean) => {
    d.select(uid);
    const stacked = window.matchMedia("(max-width: 1023px)").matches;
    if (byKeyboard) requestAnimationFrame(() => document.getElementById(`${uid}-name`)?.focus());
    else if (stacked)
      requestAnimationFrame(() => {
        const panel = document.getElementById(PANEL_ID);
        panel?.scrollIntoView({ block: "start", behavior: "auto" });
        panel?.focus({ preventScroll: true });
      });
  };
  const remove = (i: number) => {
    const next = stages[i + 1] ?? stages[i - 1];
    if (next) d.select(next.uid);
    d.removeStage(i);
  };
  return {
    ops,
    mode,
    setMode,
    stages,
    sel,
    index: sel ? stages.indexOf(sel) : -1,
    views,
    select,
    remove,
    removing: stages.find((s) => s.uid === removing),
    askRemove: (uid: string) => stages.length > 1 && setRemoving(uid),
    closeRemove: () => setRemoving(null),
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
