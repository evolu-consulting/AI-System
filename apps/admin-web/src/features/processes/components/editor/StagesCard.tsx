// ADM-FR-66 · CR-056 · P-a F5 · P-b2: thẻ "Giai đoạn" (bàn làm việc theo bước, ≤ 10) và thẻ "Giới hạn" chỉ đọc.
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { StageWorkbench } from "../canvas/StageWorkbench";

type Props = { d: DraftState; readOnly: boolean; refs: EditorRefs };

export function StagesCard({ d, readOnly, refs }: Props) {
  const { t } = useTranslation();
  const err = d.errors.stages;
  return (
    <Panel title={t("process.admin.editor.stages")}>
      {err ? (
        <p role="alert" className="text-label text-destructive">
          {t(err)}
        </p>
      ) : null}
      <StageWorkbench d={d} readOnly={readOnly} refs={refs} />
    </Panel>
  );
}

export function LimitsCard() {
  const { t } = useTranslation();
  return (
    <Panel title={t("process.admin.editor.limits")}>
      <p className="text-body text-muted-foreground">{t("process.admin.editor.limitsText")}</p>
    </Panel>
  );
}
