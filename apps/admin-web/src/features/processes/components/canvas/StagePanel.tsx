// ADM-FR-71 · P-b2 (plan-frontend §1): panel bên `complementary` "Chi tiết giai đoạn" — form của MỘT giai đoạn đang chọn.
import { X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { isSystemStage } from "../../lib/system-nodes";
import { StageForm } from "../editor/StageForm";
import { useLibraryCanvas } from "../library/library-canvas-ctx";
import { SlotStageForm } from "../library/SlotStageForm";
import { PANEL_ID, type Workbench } from "./use-workbench";

type Props = {
  d: DraftState;
  w: Workbench;
  readOnly: boolean;
  refs: EditorRefs;
  /** `drawer` = ngăn phải đè lên canvas (view Canvas, không modal); `column` = cột bên (view Danh sách). */
  variant?: "column" | "drawer";
};

/** Esc đóng ngăn — bỏ qua khi Esc đã được popup khác (Select/Dialog của Radix gọi preventDefault) xử lý. */
function useEscClose(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active, onClose]);
}

export function StagePanel({ d, w, readOnly, refs, variant = "column" }: Props) {
  const { t } = useTranslation();
  const lib = useLibraryCanvas();
  const { sel, index, ops } = w;
  const drawer = variant === "drawer";
  useEscClose(drawer && w.open, w.close);
  if (drawer && !w.open) return null;
  return (
    <aside
      id={PANEL_ID}
      tabIndex={-1}
      aria-label={t("process.admin.canvas.region")}
      className={
        drawer
          ? "absolute inset-y-0 right-0 z-10 w-full overflow-y-auto border-l border-border bg-card p-3 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:slide-in-from-right md:w-[460px]"
          : "w-full shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring lg:max-h-[640px] lg:w-[420px] lg:overflow-y-auto"
      }
    >
      {drawer ? (
        <div className="mb-2 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("process.admin.canvas.drawer.close")}
            title={t("process.admin.canvas.drawer.close")}
            onClick={w.close}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      ) : null}
      {sel && isSystemStage(sel) ? (
        <p role="status" className="mb-2 text-label text-muted-foreground">
          {t("process.admin.library.system.locked")}
        </p>
      ) : null}
      {sel && lib && !readOnly && !isSystemStage(sel) ? (
        <SlotStageForm
          key={sel.uid}
          stage={sel}
          index={index}
          count={w.stages.length}
          groups={lib.groups}
          onChange={(p) => d.patchStage(index, p)}
          onMove={(dir) => ops.moveColumn(index, dir)}
          onRemove={() => w.remove(index)}
        />
      ) : sel ? (
        <StageForm
          key={sel.uid}
          stage={sel}
          index={index}
          all={w.stages}
          defSources={d.draft.sources}
          defInputs={d.draft.inputs}
          errors={d.errors}
          readOnly={readOnly || isSystemStage(sel)}
          refs={refs}
          stepNotice={ops.notice?.uid === sel.uid ? ops.notice.error : undefined}
          onChange={(p) => d.patchStage(index, p)}
          onMove={(dir) => ops.moveColumn(index, dir)}
          onStep={(step) => ops.setStep(index, step)}
          onSplit={() => ops.split(index)}
          onRemove={() => w.remove(index)}
        />
      ) : null}
    </aside>
  );
}
