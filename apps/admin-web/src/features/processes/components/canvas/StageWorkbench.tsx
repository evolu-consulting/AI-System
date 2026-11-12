// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend §1, FB3/FB7): bàn làm việc giai đoạn — thanh công cụ + tab Canvas/Danh sách
// + panel bên chứa form của MỘT giai đoạn đang chọn (mặc định giai đoạn 1).
import type { LayoutDir } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { useStagesMax } from "../../hooks/use-stages-max";
import { isDlcStep } from "../../lib/dlc-slot";
import { useFitMin, useFlowCtx, useRegisterSelect } from "../flow/flow-ctx";
import { FlowToolbar } from "../flow/NodePalette";
import { useLibraryCanvas } from "../library/library-canvas-ctx";
import { SlotCanvasToolbar } from "../library/SlotCanvasToolbar";
import { OutlineView } from "../outline/OutlineView";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasTools } from "./CanvasTools";
import { CanvasView } from "./CanvasView";
import { StagePanel } from "./StagePanel";
import { StepList } from "./StepList";
import { withoutSlotLinks } from "./stage-view";
import { type Mode, useWorkbench } from "./use-workbench";

/** Bề rộng ngăn chi tiết (px, khớp `md:w-[460px]` ở StagePanel). */
const DRAWER_W = 460;
type Props = { d: DraftState; readOnly: boolean; refs: EditorRefs };

function Empty({ onAdd, readOnly }: { onAdd: () => void; readOnly: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border p-4">
      <p className="text-body text-muted-foreground">{t("process.admin.canvas.empty")}</p>
      {readOnly ? null : (
        <Button type="button" variant="outline" size="sm" autoFocus onClick={onAdd}>
          {t("process.admin.canvas.toolbar.addStep")}
        </Button>
      )}
    </div>
  );
}

/** CR-125 · x9 · hướng bố cục của canvas: Thư viện khe (có `lib`) luôn Ngang; trình sửa flow theo lựa chọn đã lưu. */
const dirOf = (lib: unknown, dir: LayoutDir): LayoutDir => (lib ? "RIGHT" : dir);

/** dlc-step-library · Canvas thư viện có bước DLC + sửa được ⇒ kéo cổng "Từ chối" nối được. */
const linkableOf = (lib: unknown, readOnly: boolean, stages: DraftState["draft"]["stages"]) =>
  !!lib && !readOnly && stages.some(isDlcStep);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 · U2 — dựng form nhiều ô, tách ở đợt dọn sau
export function StageWorkbench({ d, readOnly, refs }: Props) {
  const { t } = useTranslation();
  const w = useWorkbench(d, refs);
  const lib = useLibraryCanvas();
  const stagesMax = useStagesMax();
  const { ops } = w;
  const fitMin = useFitMin(!!lib);
  useRegisterSelect((uid) => w.select(uid, true));
  const flow = useFlowCtx();
  // CR-105 UX: quy trình khe không vẽ "Quay lại"/"Rẽ nhánh" — trừ cổng "Từ chối" của bước DLC (dlc-step-library).
  const views = lib ? withoutSlotLinks(w.views) : w.views;
  const addStage = () => ops.add();
  const addReview = () => ops.addReview();
  const dlcSteps = lib?.dlcSteps;
  const addDlc = (id?: string) =>
    ops.addDlc(
      t("process.admin.library.dlc.newName", { n: w.stages.length + 1 }),
      dlcSteps?.find((x) => x.id === id),
    );
  const viewProps = {
    views,
    selected: w.sel?.uid,
    readOnly,
    ops,
    fitKey: ops.arranged,
    fitMin,
    linkable: linkableOf(lib, readOnly, w.stages),
    onSelect: w.select,
    onRemove: w.askRemove,
  };
  // CR-127 · U2 · quy trình theo sự kiện (có node Bắt đầu): MỘT màn danh sách dọc, không còn Sơ đồ/Danh sách + Ngang/Dọc + kéo thả.
  if (flow && !lib) return <OutlineView d={d} w={w} readOnly={readOnly} refs={refs} />;
  return (
    <div className="space-y-3">
      <Tabs value={lib ? "canvas" : w.mode} onValueChange={(v) => w.setMode(v as Mode)}>
        <div className="flex flex-wrap items-center gap-2">
          {readOnly ? (
            <p className="text-caption text-muted-foreground">
              {t("process.admin.canvas.readOnly")}
            </p>
          ) : (
            <FlowToolbar
              ops={ops}
              count={w.stages.length}
              max={stagesMax}
              dnd={w.mode === "canvas" && !lib}
            >
              {lib ? (
                <SlotCanvasToolbar
                  count={w.stages.length}
                  templates={dlcSteps}
                  onAdd={addReview}
                  onAddDlc={addDlc}
                  onAddSlot={(kind) =>
                    ops.addSlotStep(
                      kind,
                      t(
                        `process.admin.library.form.${kind === "notify" ? "notify" : "wait"}.defaultName`,
                      ),
                    )
                  }
                  onArrange={ops.arrange}
                />
              ) : (
                <CanvasToolbar
                  count={w.stages.length}
                  onAddStep={() => ops.addStep(w.sel?.step ?? -1)}
                  onArrange={ops.arrange}
                />
              )}
            </FlowToolbar>
          )}
          <CanvasTools d={d} w={w} readOnly={readOnly} lib={!!lib} />
        </div>
        {ops.notice ? (
          <p role="alert" className="mt-2 text-label text-destructive">
            {ops.notice.error}
          </p>
        ) : null}
        <div role="status" aria-live="polite" className="sr-only">
          {ops.live}
        </div>
        <div className="mt-3">
          {w.stages.length === 0 ? (
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="min-w-0 flex-1">
                <Empty onAdd={addStage} readOnly={readOnly} />
              </div>
              <StagePanel d={d} w={w} readOnly={readOnly} refs={refs} />
            </div>
          ) : (
            <>
              {/* fnr-editor-drawer: Canvas toàn khung; chi tiết là ngăn phải ĐÈ lên canvas (không modal, canvas vẫn thao tác được). */}
              <TabsContent value="canvas">
                <div className="relative">
                  <CanvasView
                    {...viewProps}
                    dir={dirOf(lib, ops.layoutDir)}
                    selected={w.open ? w.sel?.uid : undefined}
                    inset={w.open && window.innerWidth >= 768 ? DRAWER_W : 0}
                  />
                  <StagePanel d={d} w={w} readOnly={readOnly} refs={refs} variant="drawer" />
                </div>
              </TabsContent>
              <TabsContent value="list">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <div className="min-w-0 flex-1">
                    <StepList {...viewProps} />
                  </div>
                  <StagePanel d={d} w={w} readOnly={readOnly} refs={refs} />
                </div>
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
      <ConfirmDialog
        open={w.removing !== undefined}
        onOpenChange={(o) => !o && w.closeRemove()}
        title={t("process.admin.canvas.confirmRemove.title", { name: w.removing?.name ?? "" })}
        description={t("process.admin.canvas.confirmRemove.body")}
        confirmLabel={t("process.admin.editor.remove")}
        destructive
        onConfirm={() => w.remove(w.stages.findIndex((s) => s.uid === w.removing?.uid))}
      />
    </div>
  );
}
