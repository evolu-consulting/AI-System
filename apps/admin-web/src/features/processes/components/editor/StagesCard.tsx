// ADM-FR-66 · CR-056 · P-a F5: thẻ "Giai đoạn" (Accordion, ≤ 10, Lên/Xuống/Xoá/Thêm) và thẻ "Giới hạn" chỉ đọc.
import { PROCESS_STAGES_MAX } from "@ai/contracts/hub-admin";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { StageForm } from "./StageForm";

type Props = { d: DraftState; readOnly: boolean; refs: EditorRefs };

export function StagesCard({ d, readOnly, refs }: Props) {
  const { t } = useTranslation();
  const stages = d.draft.stages;
  const err = d.errors.stages;
  return (
    <Panel title={t("process.admin.editor.stages")}>
      {err ? (
        <p role="alert" className="text-label text-destructive">
          {t(err)}
        </p>
      ) : null}
      <Accordion type="multiple" value={d.open} onValueChange={d.setOpen}>
        {stages.map((s, i) => (
          <AccordionItem key={s.uid} value={s.uid}>
            <AccordionTrigger>
              <span>
                {i + 1}. {s.name || t("process.admin.editor.stage.unnamed")}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <StageForm
                stage={s}
                index={i}
                all={stages}
                defSources={d.draft.sources}
                errors={d.errors}
                readOnly={readOnly}
                refs={refs}
                onChange={(p) => d.patchStage(i, p)}
                onMove={(dir) => d.moveStage(i, dir)}
                onRemove={() => d.removeStage(i)}
              />
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      {readOnly || stages.length >= PROCESS_STAGES_MAX ? null : (
        <Button type="button" variant="outline" onClick={d.addStage}>
          <Plus aria-hidden className="size-4" />
          {t("process.admin.editor.add")}
        </Button>
      )}
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
