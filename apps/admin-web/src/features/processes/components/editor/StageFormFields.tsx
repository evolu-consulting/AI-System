// CR-118 · cr118-flow-admin: editor trường của node `form` (thêm/xoá/đổi chỗ, loại, nhãn, bắt buộc, giới hạn, lựa chọn).
// Mọi thay đổi đi qua `formPatch` ⇒ `output.fields` luôn khớp trường form (Hub ép, lệch ⇒ FORM_INVALID). Dùng chung Canvas + Form.
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { FormFieldDraft } from "../../lib/draft-types";
import {
  addField,
  FORM_FIELDS_MAX,
  formPatch,
  moveField,
  relabel,
  retype,
} from "../../lib/form-fields";
import { FormFieldRow } from "./FormFieldRow";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.editor.stage.form.";

/** Lỗi của trường `j` (`stages.i.executor.fields.j.<ô>`) đã dịch, key = `<ô>`. */
function rowErrors(
  errors: StageFormProps["errors"],
  index: number,
  j: number,
  t: (k: string) => string,
): Record<string, string> {
  const pre = `stages.${index}.executor.fields.${j}.`;
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith(pre))
      .map(([k, v]) => [k.slice(pre.length), t(v)]),
  );
}

export function StageFormFields({ stage, index, errors, readOnly, onChange }: StageFormProps) {
  const { t } = useTranslation();
  const list = stage.formFields ?? [];
  const set = (next: FormFieldDraft[]) => onChange(formPatch(next));
  const rootErr = errors[`stages.${index}.executor.fields`];
  return (
    <fieldset aria-label={t(`${K}title`)} className="space-y-3" data-testid="stage-form-fields">
      <strong className="text-label font-medium">{t(`${K}title`)}</strong>
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      {list.map((f, j) => (
        <FormFieldRow
          // biome-ignore lint/suspicious/noArrayIndexKey: trường không có id riêng (ô nhập có điều khiển), thứ tự do người dùng sắp
          key={j}
          id={`${stage.uid}-ff-${j}`}
          n={j + 1}
          count={list.length}
          field={f}
          readOnly={readOnly}
          errors={rowErrors(errors, index, j, t)}
          onLabel={(label) => set(relabel(list, j, label))}
          onType={(type) => set(list.map((x, i) => (i === j ? retype(x, type) : x)))}
          onPatch={(p) => set(list.map((x, i) => (i === j ? { ...x, ...p } : x)))}
          onMove={(dir) => set(moveField(list, j, dir))}
          onRemove={() => set(list.filter((_, i) => i !== j))}
        />
      ))}
      {rootErr ? (
        <p role="alert" className="text-caption text-destructive">
          {t(rootErr)}
        </p>
      ) : null}
      {readOnly || list.length >= FORM_FIELDS_MAX ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => set(addField(list, "text"))}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t(`${K}add`)}
        </Button>
      )}
    </fieldset>
  );
}
