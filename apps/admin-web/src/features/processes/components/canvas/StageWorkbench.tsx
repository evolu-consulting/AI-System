// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend §1, FB3/FB7): bàn làm việc giai đoạn — thanh công cụ + tab Canvas/Danh sách
// + panel bên chứa form của MỘT giai đoạn đang chọn (mặc định giai đoạn 1).
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasView } from "./CanvasView";
import { ShortcutsHint } from "./ShortcutsHint";
import { StagePanel } from "./StagePanel";
import { StepList } from "./StepList";
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
          {t("process.admin.canvas.toolbar.addStage")}
        </Button>
      )}
    </div>
  );
}

export function StageWorkbench({ d, readOnly, refs }: Props) {
  const { t } = useTranslation();
  const w = useWorkbench(d, refs);
  const { ops, views } = w;
  const addStage = () => ops.add();
  const viewProps = {
    views,
    selected: w.sel?.uid,
    readOnly,
    ops,
    fitKey: ops.arranged,
    onSelect: w.select,
    onRemove: w.askRemove,
  };
  return (
    <div className="space-y-3">
      <Tabs value={w.mode} onValueChange={(v) => w.setMode(v as Mode)}>
        <div className="flex flex-wrap items-center gap-2">
          {readOnly ? (
            <p className="text-caption text-muted-foreground">
              {t("process.admin.canvas.readOnly")}
            </p>
          ) : (
            <CanvasToolbar
              count={w.stages.length}
              onAddStage={addStage}
              onAddStep={() => ops.addStep(w.sel?.step ?? -1)}
              onArrange={ops.arrange}
            />
          )}
          <div className="ml-auto flex items-center gap-1">
            <TabsList aria-label={t("process.admin.canvas.view.label")}>
              <TabsTrigger value="canvas">{t("process.admin.canvas.view.canvas")}</TabsTrigger>
              <TabsTrigger value="list">{t("process.admin.canvas.view.list")}</TabsTrigger>
            </TabsList>
            <ShortcutsHint />
          </div>
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
