// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend §2): thao tác bước trên bản nháp + thông báo cho người dùng
// (câu lỗi inline đã dịch, vùng `aria-live`). Canvas, StepList và panel cùng dùng một bộ.
import type { DlcStepTemplate } from "@ai/contracts/hub-admin";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyBrief } from "@/components/shared/toast";
import { emptyStage, type StageDraft } from "../lib/def-form";
import { linkDlcReject } from "../lib/dlc-slot";
import { freshDlcStage, freshReviewStage, freshSlotStage } from "../lib/fresh-stages";
import type { EdgeRef } from "../lib/insert-on-edge";
import { waitBranchDefaults } from "../lib/module-cluster";
import { getStagesMax } from "../lib/stages-limit";
import { stepLabel } from "../lib/step-label";
import { columnNeighbor, type StepOpResult } from "../lib/step-ops";
import { useCanvasEdit } from "./use-canvas-edit";
import type { DraftState } from "./use-draft";

type Notice = { uid?: string; error: string };
const LIVE = "process.admin.canvas.live.";
const LINK = "process.admin.library.dlc.link.";
const CONNECT = "process.admin.canvas.connect.";

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
      setNotice({ uid, error: t(r.error, { step, max: getStagesMax() }) });
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

/** dlc-step-library · nối cổng "Từ chối" (luật ở `linkDlcReject`); sai đích ⇒ câu lỗi inline, xong ⇒ live. */
function linkRejectOf(d: DraftState, r: ReturnType<typeof useReport>) {
  return (from: string, to: string) => {
    const st = d.draftRef.current.stages;
    const out = linkDlcReject(st, from, to);
    if (!out) return;
    if ("error" in out) return r.setNotice({ uid: from, error: r.t(`${LINK}${out.error}`) });
    d.patchStage(out.index, { slotRaw: out.slot as unknown as Record<string, unknown> });
    r.setNotice(null);
    const name = (uid: string) => st.find((s) => s.uid === uid)?.name ?? "";
    r.setLive(r.t(`${LINK}done`, { from: name(from), to: name(to) }));
  };
}

export function useStageOps(d: DraftState) {
  const rep = useReport(d);
  const { notice, live, setNotice, setLive, find, report, t } = rep;
  const [arranged, setArranged] = useState(0);
  // CR-123 · p25: lỗi thao tác kéo-thả ⇒ toast (đọc được bằng trình đọc màn hình) + vùng aria-live; xong ⇒ chỉ aria-live.
  const say = {
    error: (m: string) => {
      notifyBrief(m);
      setLive(m);
    },
    live: setLive,
    clear: () => setNotice(null),
  };
  const edit = useCanvasEdit(d, say, t);
  const stageAt = (i: number) => d.draftRef.current.stages[i];
  /** CR-123 · u3a · vừa chèn xong cụm (Ký số): nhánh bị từ chối / huỷ / hết hạn của stage chờ ⇒ node Kết thúc · Từ chối nếu có. */
  const clusterDefaults = (waitUid: string) => {
    const i = find(waitUid);
    const patch = waitBranchDefaults(d.draftRef.current.stages, waitUid);
    if (i >= 0 && patch) d.patchStage(i, patch);
  };
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
    /** dlc-engine · thêm bước DLC (khe `dlc.*`) thành bước cuối; `tpl` = bước mẫu của thư viện (dlc-step-library), vắng ⇒ bước trống. */
    addDlc: (name: string, tpl?: DlcStepTemplate) =>
      addVia(() => d.addFresh((st) => freshDlcStage(st, name, tpl))),
    /** dlc-engine · thêm bước duyệt của khe (mang `slot.kind = review` ngay ⇒ không nối với bước DLC, KIND_MIX khi trộn). */
    addReview: () => addVia(() => d.addFresh(() => freshReviewStage())),
    /** CR-121 D-6b · thêm bước Thông báo / Chờ tới của khe (mang `slot.kind` ngay; Hub dựng stage engine khi lưu). */
    addSlotStep: (kind: "notify" | "wait_until", name: string) =>
      addVia(() => d.addFresh(() => freshSlotStage(kind, name))),
    /** CR-122 · U1 · thêm node từ bảng node (loại + tên nghiệp vụ) thành bước mới cuối. */
    addNode: (patch: Partial<StageDraft>, name: string) => {
      const uid = addVia(() => d.addFresh(() => ({ ...emptyStage(), ...patch, name })));
      if (uid) clusterDefaults(uid);
      return uid;
    },
    /** CR-123 · u3a · FR-14 · xoá node trên canvas/danh sách: stage thuộc node module ⇒ xoá CẢ cụm (p25: Delete đi qua đây). */
    remove: (uid: string) => {
      const i = find(uid);
      if (i >= 0) d.removeStage(i);
    },
    /** CR-123 · u3a · FR-14 · sao chép node: stage thuộc node module ⇒ sao chép CẢ cụm (p25: Ctrl+C/V đi qua đây). */
    duplicate: (uid: string) => {
      const i = find(uid);
      if (i >= 0) report(undefined, d.duplicateStage(i));
    },
    /** CR-122 · P8 · chèn các node (một node module có thể nhiều giai đoạn) vào GIỮA cạnh `edge`, nối tiếp nhau. */
    insertNodes: (items: { patch: Partial<StageDraft>; name: string }[], edge: EdgeRef) => {
      // nhánh Đúng/Sai của Nếu không được trỏ tới bước hành động thật (luật chung với ô chọn và nối tay)
      if (edge.side && items.some((i) => i.patch.real)) return say.error(t(`${CONNECT}ifReal`));
      let from = edge.from;
      for (const it of items) {
        const fresh = { ...emptyStage(), ...it.patch, name: it.name };
        const r = d.insertOnEdge(fresh, {
          from,
          to: edge.to,
          side: from === edge.from ? edge.side : undefined,
        });
        report(undefined, r);
        if ("error" in r) return;
        from = fresh.uid;
      }
      clusterDefaults(from);
    },
    /** dlc-step-library · kéo cổng "Từ chối" của bước `from` thả lên bước `to` (phải đứng trước) ⇒ `gate.back_to = [to]`. */
    linkReject: linkRejectOf(d, rep),
    ...edit,
    clearNotice: () => setNotice(null),
  };
}
export type StageOps = ReturnType<typeof useStageOps>;
