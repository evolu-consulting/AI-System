// ADM-FR-66 · CR-056 · P-a F5 · P-d2 (D2-22): "Trường có cấu trúc" của kết quả giai đoạn — tách từ `StageOutput` để stage "Gọi tool"
// dùng lại (tool giữ `fields`, ẩn mẫu/mục bắt buộc).
import { STAGE_FIELDS_MAX } from "@ai/contracts/hub-admin";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { DraftErrors, FieldDraft, StageDraft } from "../../lib/def-form";
import { SelectField, TextField } from "./Fields";

type Props = {
  stage: StageDraft;
  index: number;
  errors: DraftErrors;
  readOnly: boolean;
  onChange: (patch: Partial<StageDraft>) => void;
};
const TYPES = ["number", "string", "date"] as const;
type RowProps = {
  field: FieldDraft;
  fid: string;
  n: number;
  error: string | undefined;
  readOnly: boolean;
  set: (p: Partial<FieldDraft>) => void;
  onRemove: () => void;
};

function FieldRow({ field: f, fid, n, error, readOnly, set, onRemove }: RowProps) {
  const { t } = useTranslation();
  const types = TYPES.map((x) => ({ value: x, label: t(`process.admin.editor.stage.type.${x}`) }));
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="w-48">
        <TextField
          id={`${fid}-key`}
          label={t("process.admin.editor.stage.fieldKey")}
          value={f.key}
          error={error ? t(error) : undefined}
          readOnly={readOnly}
          mono
          onChange={(v) => set({ key: v })}
        />
      </div>
      <div className="w-36">
        <SelectField
          id={`${fid}-type`}
          label={t("process.admin.editor.stage.fieldType")}
          value={f.type}
          readOnly={readOnly}
          options={types}
          onChange={(v) => set({ type: v as FieldDraft["type"] })}
        />
      </div>
      <div className="flex items-center gap-2 pb-2">
        <Switch
          id={`${fid}-req`}
          checked={f.required}
          disabled={readOnly}
          onCheckedChange={(v) => set({ required: v })}
        />
        <Label htmlFor={`${fid}-req`}>{t("process.admin.editor.stage.fieldRequired")}</Label>
      </div>
      {readOnly ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("process.admin.editor.stage.removeField", { n })}
          onClick={onRemove}
        >
          <X aria-hidden className="size-4" />
        </Button>
      )}
    </div>
  );
}

export function OutputFields({ stage, index, errors, readOnly, onChange }: Props) {
  const { t } = useTranslation();
  const set = (j: number, p: Partial<FieldDraft>) =>
    onChange({ fields: stage.fields.map((f, k) => (k === j ? { ...f, ...p } : f)) });
  return (
    <div className="space-y-2">
      <p className="text-label font-medium">{t("process.admin.editor.stage.fields")}</p>
      {stage.fields.map((f, j) => (
        <FieldRow
          // biome-ignore lint/suspicious/noArrayIndexKey: dòng trường không có danh tính ổn định
          key={j}
          field={f}
          fid={`${stage.uid}-f${j}`}
          n={j + 1}
          error={errors[`stages.${index}.output.fields.${j}.key`]}
          readOnly={readOnly}
          set={(p) => set(j, p)}
          onRemove={() => onChange({ fields: stage.fields.filter((_, k) => k !== j) })}
        />
      ))}
      {readOnly || stage.fields.length >= STAGE_FIELDS_MAX ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({ fields: [...stage.fields, { key: "", type: "string", required: false }] })
          }
        >
          <Plus aria-hidden className="size-4" />
          {t("process.admin.editor.stage.addField")}
        </Button>
      )}
    </div>
  );
}
