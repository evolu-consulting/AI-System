// ADM-FR-69 · HUB-FR-124 · P-b FS-7: thẻ "Thông tin đầu vào" — khai báo ≤ 10 trường người chạy phải điền khi bắt đầu.
import { DEF_INPUTS_MAX } from "@ai/contracts/hub-admin";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Panel } from "@/components/shared/panel/Panel";
import { Button } from "@/components/ui/button";
import type { DefDraft, DraftErrors } from "../../lib/def-form";
import { emptyInput, type InputDraft } from "../../lib/sources-form";
import { InputRow } from "./InputRow";

type Props = {
  draft: DefDraft;
  errors: DraftErrors;
  readOnly: boolean;
  patch: (p: Partial<DefDraft>) => void;
};

export function InputsCard({ draft, errors, readOnly, patch }: Props) {
  const { t } = useTranslation();
  const rows = draft.inputs;
  const set = (uid: string, p: Partial<InputDraft>) =>
    patch({ inputs: rows.map((r) => (r.uid === uid ? { ...r, ...p } : r)) });
  const full = rows.length >= DEF_INPUTS_MAX;
  const err = errors.inputs ? t(errors.inputs) : null;
  return (
    <Panel title={t("process.admin.editor.inputs.title")}>
      <p className="text-caption text-muted-foreground">{t("process.admin.editor.inputs.note")}</p>
      {rows.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("process.admin.editor.inputs.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <InputRow
              key={r.uid}
              row={r}
              index={i}
              errors={errors}
              readOnly={readOnly}
              onChange={(p) => set(r.uid, p)}
              onRemove={() => patch({ inputs: rows.filter((x) => x.uid !== r.uid) })}
            />
          ))}
        </ul>
      )}
      {readOnly ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={full}
          onClick={() => patch({ inputs: [...rows, emptyInput()] })}
        >
          <Plus aria-hidden className="size-4" />
          {t("process.admin.editor.inputs.add")}
        </Button>
      )}
      {full ? (
        <p className="text-caption text-muted-foreground">
          {t("process.admin.editor.err.input.max")}
        </p>
      ) : null}
      {err ? <p className="text-caption text-destructive">{err}</p> : null}
    </Panel>
  );
}
