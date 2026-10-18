// ADM-FR-71 · P-b2 (plan-frontend §1): panel bên `complementary` "Chi tiết giai đoạn" — form của MỘT giai đoạn đang chọn.
import { useTranslation } from "react-i18next";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { StageForm } from "../editor/StageForm";
import { PANEL_ID, type Workbench } from "./use-workbench";

type Props = { d: DraftState; w: Workbench; readOnly: boolean; refs: EditorRefs };

export function StagePanel({ d, w, readOnly, refs }: Props) {
  const { t } = useTranslation();
  const { sel, index, ops } = w;
  return (
    <aside
      id={PANEL_ID}
      tabIndex={-1}
      aria-label={t("process.admin.canvas.region")}
      className="w-full shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring lg:max-h-[640px] lg:w-[420px] lg:overflow-y-auto"
    >
      {sel ? (
        <StageForm
          key={sel.uid}
          stage={sel}
          index={index}
          all={w.stages}
          defSources={d.draft.sources}
          defInputs={d.draft.inputs}
          errors={d.errors}
          readOnly={readOnly}
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
