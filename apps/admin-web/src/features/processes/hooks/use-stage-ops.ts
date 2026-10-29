// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend §2): thao tác bước trên bản nháp + thông báo cho người dùng
// (câu lỗi inline đã dịch, vùng `aria-live`). Canvas, StepList và panel cùng dùng một bộ.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { StageDraft } from "../lib/def-form";
import { stepLabel } from "../lib/step-label";
import { columnNeighbor, type StepOpResult } from "../lib/step-ops";
import type { DraftState } from "./use-draft";

type Notice = { uid?: string; error: string };
const LIVE = "process.admin.canvas.live.";

type Report = (uid: string | undefined, r: StepOpResult<unknown>, before?: number) => void;

/** Báo kết quả một phép: lỗi ⇒ `notice` + live "rejected"; đổi bước ⇒ live "moved". */
function useReport(d: DraftState) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [live, setLive] = useState("");
  const find = (uid: string) => d.draftRef.current.stages.findIndex((s) => s.uid === uid);
  const report: Report = (uid, r, before) => {
    if ("error" in r) {
      const step = stepLabel(r.step ?? 0);
      setNotice({ uid, error: t(r.error, { step }) });
      setLive(r.step === undefined ? "" : t(`${LIVE}rejected`, { step }));
      return;
    }
    setNotice(null);
    const i = uid ? find(uid) : -1;
    const now = d.draftRef.current.stages[i]?.step;
    if (i >= 0 && now !== undefined && now !== before)
      setLive(t(`${LIVE}moved`, { n: i + 1, step: stepLabel(now) }));
  };
  return { notice, live, setNotice, setLive, find, report, t };
}

export function useStageOps(d: DraftState) {
  const { notice, live, setNotice, setLive, find, report, t } = useReport(d);
  const [arranged, setArranged] = useState(0);
  const stageAt = (i: number) => d.draftRef.current.stages[i];
  const setStep = (i: number, step: number) => {
    const s = stageAt(i);
    if (s) report(s.uid, d.moveToStep(i, step), s.step);
  };
  const split = (i: number) => {
    const s = stageAt(i);
    if (s) report(s.uid, d.splitToNewStep(i), s.step);
  };
  const moveColumn = (i: number, dir: -1 | 1) => {
    const s = stageAt(i);
    if (!s || columnNeighbor(d.draftRef.current.stages, i, dir) < 0) return;
    d.moveInColumn(i, dir);
    setNotice(null);
    setLive(t(`${LIVE}reordered`, { n: find(s.uid) + 1, step: stepLabel(s.step) }));
  };
  /** Chạy phép thêm, báo kết quả, trả `uid` giai đoạn mới hoặc `null`. */
  const addVia = (run: () => StepOpResult<StageDraft>) => {
    const before = new Set(d.draftRef.current.stages.map((s) => s.uid));
    const r = run();
    report(undefined, r);
    return "stages" in r ? (r.stages.find((s) => !before.has(s.uid))?.uid ?? null) : null;
  };
  return {
    notice,
    live,
    setStep,
    split,
    moveColumn,
    /** fnr-canvas · lưu vị trí dọc node (kéo tự do) / bỏ hết vị trí đã lưu ("Sắp xếp"). */
    setY: (uid: string, y: number | undefined) => d.setUiY(uid, y),
    arranged,
    arrange: () => {
      d.clearUiY();
      setNotice(null);
      setArranged((n) => n + 1);
    },
    /** Thêm giai đoạn vào bước `step` (0-based), bỏ trống ⇒ thành bước mới cuối. */
    add: (step?: number) => addVia(() => d.addStage(step)),
    /** Chèn bước mới ngay sau bước `step`. */
    addStep: (step: number) => addVia(() => d.addStepAfter(step)),
    clearNotice: () => setNotice(null),
  };
}
export type StageOps = ReturnType<typeof useStageOps>;
