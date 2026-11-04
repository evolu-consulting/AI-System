// CR-118 · cr118-flow-admin: một trường của node `form` — nhãn, loại, mã, gợi ý, bắt buộc, giới hạn theo loại, lựa chọn (select).
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { FormFieldDraft, FormOptionDraft } from "../../lib/draft-types";
import { emptyOption, FORM_FIELD_TYPES, FORM_OPTIONS_MAX } from "../../lib/form-fields";
import { SelectField, TextField } from "./Fields";

const K = "process.admin.editor.stage.form.";

export type FormFieldRowProps = {
  /** Id nền (`<stage.uid>-ff-<j>`). */
  id: string;
  n: number;
  count: number;
  field: FormFieldDraft;
  readOnly: boolean;
  /** Lỗi theo ô (đã dịch): key `label|key|help|max_len|min|max|options|options.k.value|options.k.label`. */
  errors: Readonly<Record<string, string>>;
  onLabel: (label: string) => void;
  onType: (type: FormFieldDraft["type"]) => void;
  onPatch: (p: Partial<FormFieldDraft>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
};

function Options(p: Pick<FormFieldRowProps, "id" | "field" | "readOnly" | "errors" | "onPatch">) {
  const { t } = useTranslation();
  const { field: f } = p;
  const set = (k: number, patch: Partial<FormOptionDraft>) =>
    p.onPatch({ options: f.options.map((o, i) => (i === k ? { ...o, ...patch } : o)) });
  return (
    <fieldset className="space-y-2" aria-label={t(`${K}options`)}>
      <strong className="text-label font-medium">{t(`${K}options`)}</strong>
      {f.options.map((o, k) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lựa chọn không có id riêng, thứ tự do người dùng sắp
        <div key={k} className="grid items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <TextField
            id={`${p.id}-opt-${k}-label`}
            label={t(`${K}optionLabel`, { n: k + 1 })}
            value={o.label}
            readOnly={p.readOnly}
            error={p.errors[`options.${k}.label`]}
            onChange={(v) => set(k, { label: v })}
          />
          <TextField
            id={`${p.id}-opt-${k}-value`}
            label={t(`${K}optionValue`, { n: k + 1 })}
            value={o.value}
            readOnly={p.readOnly}
            error={p.errors[`options.${k}.value`]}
            mono
            onChange={(v) => set(k, { value: v })}
          />
          {p.readOnly ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-6"
              aria-label={t(`${K}removeOption`, { n: k + 1 })}
              onClick={() => p.onPatch({ options: f.options.filter((_, i) => i !== k) })}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      ))}
      {p.errors.options ? (
        <p role="alert" className="text-caption text-destructive">
          {p.errors.options}
        </p>
      ) : null}
      {p.readOnly || f.options.length >= FORM_OPTIONS_MAX ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => p.onPatch({ options: [...f.options, emptyOption()] })}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t(`${K}addOption`)}
        </Button>
      )}
    </fieldset>
  );
}

function Limits(p: Pick<FormFieldRowProps, "id" | "field" | "readOnly" | "errors" | "onPatch">) {
  const { t } = useTranslation();
  const { field: f } = p;
  if (f.type === "text" || f.type === "textarea")
    return (
      <div className="w-48">
        <TextField
          id={`${p.id}-maxlen`}
          label={t(`${K}maxLen`)}
          type="number"
          value={f.maxLen}
          readOnly={p.readOnly}
          error={p.errors.max_len}
          onChange={(v) => p.onPatch({ maxLen: v })}
        />
      </div>
    );
  if (f.type === "number" || f.type === "money")
    return (
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-44">
          <TextField
            id={`${p.id}-min`}
            label={t(`${K}min`)}
            type="number"
            value={f.min}
            readOnly={p.readOnly}
            error={p.errors.min}
            onChange={(v) => p.onPatch({ min: v })}
          />
        </div>
        <div className="w-44">
          <TextField
            id={`${p.id}-max`}
            label={t(`${K}max`)}
            type="number"
            value={f.max}
            readOnly={p.readOnly}
            error={p.errors.max}
            onChange={(v) => p.onPatch({ max: v })}
          />
        </div>
        {f.type === "number" ? (
          <div className="flex items-center gap-2 pt-7">
            <Switch
              id={`${p.id}-int`}
              checked={f.integer}
              disabled={p.readOnly}
              onCheckedChange={(v) => p.onPatch({ integer: v })}
            />
            <Label htmlFor={`${p.id}-int`}>{t(`${K}integer`)}</Label>
          </div>
        ) : null}
      </div>
    );
  if (f.type === "select") return <Options {...p} />;
  return null;
}

export function FormFieldRow(p: FormFieldRowProps) {
  const { t } = useTranslation();
  const { field: f, id, n } = p;
  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-testid="form-field-row">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-label font-medium">{t(`${K}field`, { n })}</strong>
        {p.readOnly ? null : (
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={n === 1}
              aria-label={t(`${K}up`, { n })}
              onClick={() => p.onMove(-1)}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={n === p.count}
              aria-label={t(`${K}down`, { n })}
              onClick={() => p.onMove(1)}
            >
              <ArrowDown className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t(`${K}remove`, { n })}
              onClick={p.onRemove}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem_1fr]">
        <TextField
          id={`${id}-label`}
          label={t(`${K}label`, { n })}
          value={f.label}
          readOnly={p.readOnly}
          error={p.errors.label}
          onChange={p.onLabel}
        />
        <SelectField
          id={`${id}-type`}
          label={t(`${K}type`, { n })}
          value={f.type}
          readOnly={p.readOnly}
          options={FORM_FIELD_TYPES.map((x) => ({ value: x, label: t(`${K}types.${x}`) }))}
          onChange={(v) => p.onType(v as FormFieldDraft["type"])}
        />
        <TextField
          id={`${id}-key`}
          label={t(`${K}key`, { n })}
          value={f.key}
          readOnly={p.readOnly}
          error={p.errors.key}
          mono
          onChange={(v) => p.onPatch({ key: v, keyAuto: false })}
        />
      </div>
      <TextField
        id={`${id}-help`}
        label={t(`${K}help`, { n })}
        value={f.help}
        readOnly={p.readOnly}
        error={p.errors.help}
        onChange={(v) => p.onPatch({ help: v })}
      />
      <div className="flex items-center gap-2">
        <Switch
          id={`${id}-req`}
          checked={f.required}
          disabled={p.readOnly}
          onCheckedChange={(v) => p.onPatch({ required: v })}
        />
        <Label htmlFor={`${id}-req`}>{t(`${K}required`, { n })}</Label>
      </div>
      <Limits {...p} />
    </div>
  );
}
