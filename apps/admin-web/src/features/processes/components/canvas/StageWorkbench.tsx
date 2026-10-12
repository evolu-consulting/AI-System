// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend §1, FB3/FB7): bàn làm việc giai đoạn — thanh công cụ + danh sách/canvas theo bước
// + panel bên (`complementary` "Chi tiết giai đoạn") chứa form của MỘT giai đoạn đang chọn (mặc định giai đoạn 1).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { useStageOps } from "../../hooks/use-stage-ops";
import { StageForm } from "../editor/StageForm";
import { CanvasToolbar } from "./CanvasToolbar";
import { StepList } from "./StepList";
import { stageViews } from "./stage-view";

type Props = { d: DraftState; readOnly: boolean; refs: EditorRefs };

export function StageWorkbench({ d, readOnly, refs }: Props) {
  const { t } = useTranslation();
  const ops = useStageOps(d);
  const [removing, setRemoving] = useState<string | null>(null);
  const stages = d.draft.stages;
  const sel = stages.find((s) => s.uid === d.selected) ?? stages[0];
  const index = sel ? stages.indexOf(sel) : -1;
  const views = stageViews(stages, d.errors, refs);
  const target = stages.find((s) => s.uid === removing);

  const select = (uid: string, byKeyboard: boolean) => {
    d.select(uid);
    if (byKeyboard) requestAnimationFrame(() => document.getElementById(`${uid}-name`)?.focus());
  };
  const remove = (i: number) => {
    const next = stages[i + 1] ?? stages[i - 1];
    if (next) d.select(next.uid);
    d.removeStage(i);
  };
  const askRemove = (uid: string) => stages.length > 1 && setRemoving(uid);
  const addStage = () => ops.add();
  const addStep = () => ops.addStep(sel?.step ?? -1);

  return (
    <div className="space-y-3">
      {readOnly ? (
        <p className="text-caption text-muted-foreground">{t("process.admin.canvas.readOnly")}</p>
      ) : (
        <CanvasToolbar count={stages.length} onAddStage={addStage} onAddStep={addStep} />
      )}
      {ops.notice ? (
        <p role="alert" className="text-label text-destructive">
          {ops.notice.error}
        </p>
      ) : null}
      <div role="status" aria-live="polite" className="sr-only">
        {ops.live}
      </div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <StepList
            views={views}
            selected={sel?.uid}
            readOnly={readOnly}
            ops={ops}
            onSelect={select}
            onRemove={askRemove}
          />
        </div>
        <aside
          aria-label={t("process.admin.canvas.region")}
          className="w-full shrink-0 lg:max-h-[640px] lg:w-[420px] lg:overflow-y-auto"
        >
          {sel ? (
            <StageForm
              key={sel.uid}
              stage={sel}
              index={index}
              all={stages}
              defSources={d.draft.sources}
              errors={d.errors}
              readOnly={readOnly}
              refs={refs}
              stepNotice={ops.notice?.uid === sel.uid ? ops.notice.error : undefined}
              onChange={(p) => d.patchStage(index, p)}
              onMove={(dir) => ops.moveColumn(index, dir)}
              onStep={(step) => ops.setStep(index, step)}
              onSplit={() => ops.split(index)}
              onRemove={() => remove(index)}
            />
          ) : null}
        </aside>
      </div>
      <ConfirmDialog
        open={target !== undefined}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("process.admin.canvas.confirmRemove.title", { name: target?.name ?? "" })}
        description={t("process.admin.canvas.confirmRemove.body")}
        confirmLabel={t("process.admin.editor.remove")}
        destructive
        onConfirm={() => remove(stages.indexOf(target as NonNullable<typeof target>))}
      />
    </div>
  );
}
