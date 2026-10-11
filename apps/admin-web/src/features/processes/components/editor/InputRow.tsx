// ADM-FR-69 · HUB-FR-124 · P-b FS-7: một hàng "Thông tin đầu vào" — ký hiệu · nhãn · kiểu · bắt buộc · lựa chọn (chỉ select).
import { INPUT_TYPES } from "@ai/contracts/hub-admin";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { DraftErrors } from "../../lib/def-form";
import type { InputDraft, InputType } from "../../lib/sources-form";
import { SelectField, TextField } from "./Fields";

type Props = {
  row: InputDraft;
  index: number;
  errors: DraftErrors;
  readOnly: boolean;
  onChange: (p: Partial<InputDraft>) => void;
  onRemove: () => void;
};

export function InputRow({ row, index, errors, readOnly, onChange, onRemove }: Props) {
  const { t } = useTranslation();
  const e = (f: string): string | undefined => {
    const k = errors[`inputs.${index}.${f}`];
    return k ? t(k) : undefined;
  };
  const id = `in-${row.uid}`;
  const types = INPUT_TYPES.map((v) => ({
    value: v,
    label: t(`process.admin.editor.inputs.types.${v}`),
  }));
  return (
    <li className="space-y-3 rounded-lg border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={`${id}-key`}
          label={t("process.admin.editor.inputs.key")}
          value={row.key}
          mono
          error={e("key")}
          readOnly={readOnly}
          onChange={(v) => onChange({ key: v })}
        />
        <TextField
          id={`${id}-label`}
          label={t("process.admin.editor.inputs.label")}
          value={row.label}
          error={e("label")}
          readOnly={readOnly}
          onChange={(v) => onChange({ label: v })}
        />
        <SelectField
          id={`${id}-type`}
          label={t("process.admin.editor.inputs.typeLabel")}
          value={row.type}
          readOnly={readOnly}
          options={types}
          onChange={(v) => onChange({ type: v as InputType })}
        />
        <div className="flex items-center gap-2 self-end pb-2">
          <Checkbox
            id={`${id}-req`}
            checked={row.required}
            disabled={readOnly}
            onCheckedChange={(v) => onChange({ required: v === true })}
          />
          <Label htmlFor={`${id}-req`}>{t("process.admin.editor.inputs.required")}</Label>
        </div>
      </div>
      {row.type === "select" ? (
        <TextField
          id={`${id}-opts`}
          label={t("process.admin.editor.inputs.options")}
          value={row.options}
          multiline
          rows={3}
          error={e("options")}
          readOnly={readOnly}
          onChange={(v) => onChange({ options: v })}
        />
      ) : null}
      {readOnly ? null : (
        <Button type="button" variant="outline" size="sm" onClick={onRemove}>
          <Trash2 aria-hidden className="size-4" />
          {row.key
            ? t("process.admin.editor.inputs.remove", { key: row.key })
            : t("process.admin.editor.inputs.removeBlank", { n: index + 1 })}
        </Button>
      )}
    </li>
  );
}
