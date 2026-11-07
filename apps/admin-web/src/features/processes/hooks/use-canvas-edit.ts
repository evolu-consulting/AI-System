// CR-123 · p25 · FLOW3-FR-04..07 · thao tác sửa tay trên canvas (thả từ bảng mẫu, xoá, chép/dán, kéo nhóm, hoàn tác) nối vào bản nháp.
// Luật nằm ở `lib/canvas-edit` + `lib/canvas-connect` + `lib/step-ops`; hook này chỉ gọi, rồi báo kết quả: lỗi ⇒ không đổi gì + toast nêu lý do
// (kèm vùng aria-live), xong ⇒ câu ngắn vào vùng aria-live.

import { useRef } from "react";
import type { useTranslation } from "react-i18next";
import { connectPatch } from "../lib/canvas-connect";
import {
  type EditError,
  moveGroup,
  pasteStages,
  placeFresh,
  removeStages,
  resetEdges,
} from "../lib/canvas-edit";
import { emptyStage, type StageDraft } from "../lib/def-form";
import { expandToClusters } from "../lib/module-cluster";
import { getStagesMax } from "../lib/stages-limit";
import { stepLabel } from "../lib/step-label";
import { lastStep } from "../lib/step-ops";
import type { DraftState } from "./use-draft";

const EDIT = "process.admin.canvas.edit.";
const CONNECT = "process.admin.canvas.connect.";
type T = ReturnType<typeof useTranslation>["t"];
export type Say = {
  error: (msg: string) => void;
  live: (msg: string) => void;
  clear: () => void;
};
export type PickedItem = { patch: Partial<StageDraft>; name: string };
export type EdgeSel = { source: string; side?: "yes" | "no" | undefined };

export function useCanvasEdit(d: DraftState, say: Say, t: T) {
  const clip = useRef<StageDraft[]>([]);
  const stages = () => d.draftRef.current.stages;
  /** Lỗi của một phép (mã `EditError` hoặc khoá câu lỗi của `step-ops`) ⇒ toast. */
  const fail = (e: { error: string; step?: number }) => {
    const known = e.error in ERR_EDIT;
    const key = e.error === "ifReal" ? `${CONNECT}ifReal` : `${EDIT}err.${e.error}`;
    say.error(known ? t(key) : t(e.error, { step: stepLabel(e.step ?? 0), max: getStagesMax() }));
  };
  const connect = (c: { source: string; target: string; sourceHandle?: string | null }) => {
    const r = connectPatch(stages(), c);
    if (!r) return;
    if (!r.ok) return say.error(t(`${CONNECT}${r.error}`));
    d.patchStage(r.index, r.patch as Partial<StageDraft>, false);
    say.clear();
    say.live(t(`${CONNECT}done.${r.field}`));
  };
  return {
    /** CR-122 · p22 · kéo cổng ra của node sang node đích ⇒ đặt "Sau đó đi tiếp" / Đúng / Sai; sai luật ⇒ không đổi + toast. */
    connect,
    /** CR-123 · p25 · nối lại đầu đích của cạnh: cùng luật với kéo cổng ra (`connect`); đích không đổi ⇒ không làm gì. */
    reconnect: (
      e: {
        source: string;
        side?: "yes" | "no" | undefined;
        handle?: string | null | undefined;
        target: string;
      },
      to: string,
    ) => {
      if (e.target !== to)
        connect({ source: e.source, target: to, sourceHandle: e.side ?? e.handle ?? null });
    },
    /** Thả node mới vào cột `step` (0-based) tại độ cao `y`; đầy ⇒ báo lý do. */
    dropNodes: (items: PickedItem[], at: { step: number; y: number }) => {
      const fresh = items.map((i) => ({ ...emptyStage(), ...i.patch, name: i.name }));
      const r = placeFresh(stages(), fresh, at.step, at.y);
      if ("error" in r) return fail(r);
      d.setStages(r.stages, true, (fresh[0] as StageDraft).uid);
      say.live(t(`${EDIT}dropped`, { name: items[0]?.name ?? "" }));
    },
    /** Xoá node đã chọn (nối liền các cạnh vào/ra) và đặt lại các cạnh đã chọn về "Bước tiếp theo". */
    removeSelection: (picked: string[], edges: EdgeSel[]) => {
      const uids = expandToClusters(stages(), picked); // CR-123 · u3a: node module (Ký số) đi cả cụm
      const reset = resetEdges(stages(), edges, uids);
      let st = reset.stages;
      if (uids.length > 0) {
        const r = removeStages(st, uids);
        if (!("stages" in r)) return fail(r);
        st = r.stages;
      } else if (reset.resets === 0) return fail({ error: reset.error ?? "empty" });
      d.setStages(st, false);
      if (uids.includes(d.selected ?? "")) d.deselect();
      say.live(t(uids.length > 0 ? `${EDIT}removed` : `${EDIT}edgeReset`, { n: uids.length }));
    },
    copy: (sel: string[]) => {
      const uids = expandToClusters(stages(), sel); // CR-123 · u3a: node module (Ký số) đi cả cụm
      const picked = stages().filter((s) => uids.includes(s.uid));
      if (picked.length === 0) return say.error(t(`${EDIT}err.nothingSelected`));
      clip.current = picked;
      say.live(t(`${EDIT}copied`, { n: picked.length }));
    },
    /** Dán ngay sau bước của node đang chọn (không chọn gì ⇒ sau bước của node đã chép, còn không thì cuối cùng). */
    paste: (selected: string[]) => {
      if (clip.current.length === 0) return say.error(t(`${EDIT}err.nothingToPaste`));
      const st = stages();
      const near = (ids: readonly string[]) => st.filter((s) => ids.includes(s.uid));
      const base =
        near(selected).length > 0 ? near(selected) : near(clip.current.map((c) => c.uid));
      const after = base.length > 0 ? Math.max(...base.map((s) => s.step)) : lastStep(st);
      const r = pasteStages(st, clip.current, after, t(`${EDIT}copySuffix`));
      if ("error" in r) return fail(r);
      d.setStages(r.stages, false);
      say.live(t(`${EDIT}pasted`, { n: r.uids?.length ?? 0 }));
    },
    /** Kéo nhóm: dời cả nhóm `delta` bước (cột đầy ⇒ báo, không đổi). */
    moveGroup: (sel: string[], delta: number) => {
      const r = moveGroup(stages(), expandToClusters(stages(), sel), delta);
      if ("error" in r) return fail(r);
      d.setStages(r.stages, true);
    },
    undo: () => say.live(t(d.undo() ? `${EDIT}undone` : `${EDIT}nothingToUndo`)),
    redo: () => say.live(t(d.redo() ? `${EDIT}redone` : `${EDIT}nothingToRedo`)),
    fail,
  };
}

const ERR_EDIT: Record<EditError, true> = {
  locked: true,
  last: true,
  ifReal: true,
  empty: true,
  already: true,
};
