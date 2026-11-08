// CR-125 · cr125-manual-start-ui · panel của node «Bắt đầu bằng phiếu yêu cầu» (`core.start-form`): ô của phiếu (nhãn, mã tự sinh, loại,
// bắt buộc, gợi ý), ai được bắt đầu (mọi người / nhóm), mẫu tên yêu cầu. Mọi đổi đi qua `startForm` của stage.
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useGroupKeyOptions } from "../../hooks/use-group-key-options";
import {
  addStartField,
  emptyStartForm,
  moveStartField,
  relabelStartField,
  START_FORM_FIELD_TYPES,
  START_FORM_FIELDS_MAX,
  type StartFieldDraft,
  type StartFormDraft,
} from "../../lib/start-form";
import { useFlowCtx } from "../flow/flow-ctx";
import { SelectField, TextField } from "./Fields";
import type { StageFormProps } from "./stage-form-props";

const K = "process.admin.startForm.";

type Props = Pick<StageFormProps, "stage" | "index" | "errors" | "readOnly" | "onChange">;

function FieldRow(p: {
  id: string;
  n: number;
  count: number;
  f: StartFieldDraft;
  readOnly: boolean;
  err: (k: string) => string | undefined;
  onLabel: (v: string) => void;
  onPatch: (v: Partial<StartFieldDraft>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { f } = p;
  return (
    <fieldset
      className="m-0 min-w-0 space-y-2 rounded-md border border-border p-2"
      data-testid="start-field"
      aria-label={t(`${K}fieldAria`, { n: p.n })}
    >
      <div className="grid items-start gap-2 sm:grid-cols-[1fr_9rem]">
        <TextField
          id={`${p.id}-label`}
          label={t(`${K}label`)}
          value={f.label}
          readOnly={p.readOnly}
          error={p.err("label") ? t(p.err("label") as string) : undefined}
          onChange={p.onLabel}
        />
        <SelectField
          id={`${p.id}-type`}
          label={t(`${K}type`)}
          value={f.type}
          readOnly={p.readOnly}
          options={START_FORM_FIELD_TYPES.map((x) => ({ value: x, label: t(`${K}types.${x}`) }))}
          onChange={(v) => p.onPatch({ type: v as StartFieldDraft["type"] })}
        />
      </div>
      <TextField
        id={`${p.id}-help`}
        label={t(`${K}help`)}
        value={f.help}
        readOnly={p.readOnly}
        maxLength={200}
        onChange={(v) => p.onPatch({ help: v })}
      />
      {p.err("key") ? (
        <p role="alert" className="text-caption text-destructive">
          {t(p.err("key") as string)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox
            checked={f.required}
            disabled={p.readOnly}
            onCheckedChange={(v) => p.onPatch({ required: v === true })}
          />
          {t(`${K}required`)}
        </Label>
        <span className="text-caption text-muted-foreground" data-testid="start-field-key">
          {t(`${K}key`)}: <code>{f.key}</code>
        </span>
        {p.readOnly ? null : (
          <span className="ml-auto flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={p.n === 1}
              aria-label={t(`${K}up`, { n: p.n })}
              onClick={() => p.onMove(-1)}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={p.n === p.count}
              aria-label={t(`${K}down`, { n: p.n })}
              onClick={() => p.onMove(1)}
            >
              <ArrowDown className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t(`${K}remove`, { n: p.n })}
              onClick={p.onRemove}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </span>
        )}
      </div>
    </fieldset>
  );
}

function Starters(p: {
  id: string;
  form: StartFormDraft;
  readOnly: boolean;
  error: string | undefined;
  onPatch: (v: Partial<StartFormDraft>) => void;
}) {
  const { t } = useTranslation();
  const flow = useFlowCtx();
  const groups = useGroupKeyOptions(flow?.tenantId, !!flow?.tenantId);
  const { form } = p;
  const toggle = (key: string, on: boolean) =>
    p.onPatch({
      groupKeys: on ? [...form.groupKeys, key] : form.groupKeys.filter((k) => k !== key),
    });
  return (
    <fieldset className="space-y-2 border-0 p-0" data-testid="start-starters">
      <legend className="text-label font-medium">{t(`${K}starters`)}</legend>
      <SelectField
        id={`${p.id}-who`}
        label={t(`${K}startersWho`)}
        value={form.starters}
        readOnly={p.readOnly}
        options={[
          { value: "everyone", label: t(`${K}everyone`) },
          { value: "groups", label: t(`${K}groups`) },
        ]}
        onChange={(v) => p.onPatch({ starters: v as StartFormDraft["starters"] })}
      />
      {form.starters === "groups" ? (
        <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0">
          {groups.map((g) => (
            <li key={g.value}>
              <Label className="flex items-center gap-1.5 font-normal">
                <Checkbox
                  checked={form.groupKeys.includes(g.value)}
                  disabled={p.readOnly}
                  onCheckedChange={(v) => toggle(g.value, v === true)}
                />
                {g.label}
              </Label>
            </li>
          ))}
        </ul>
      ) : null}
      {p.error ? (
        <p role="alert" className="text-caption text-destructive">
          {t(p.error)}
        </p>
      ) : null}
    </fieldset>
  );
}

export function StageStartForm({ stage, index, errors, readOnly, onChange }: Props) {
  const { t } = useTranslation();
  const form = stage.startForm ?? emptyStartForm();
  const set = (next: StartFormDraft) => onChange({ startForm: next });
  const at = (p: string) => errors[`stages.${index}.start_form.${p}`];
  const patchField = (j: number, v: Partial<StartFieldDraft>) =>
    set({ ...form, fields: form.fields.map((x, i) => (i === j ? { ...x, ...v } : x)) });
  return (
    <section className="space-y-3" data-testid="stage-start-form" aria-label={t(`${K}title`)}>
      <strong className="text-label font-medium">{t(`${K}title`)}</strong>
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      {form.fields.map((f, j) => (
        <FieldRow
          // biome-ignore lint/suspicious/noArrayIndexKey: ô chưa có id riêng, thứ tự do người dùng sắp
          key={j}
          id={`${stage.uid}-sf-${j}`}
          n={j + 1}
          count={form.fields.length}
          f={f}
          readOnly={readOnly}
          err={(k) => at(`fields.${j}.${k}`)}
          onLabel={(v) => set(relabelStartField(form, j, v))}
          onPatch={(v) => patchField(j, v)}
          onMove={(d) => set(moveStartField(form, j, d))}
          onRemove={() => set({ ...form, fields: form.fields.filter((_, i) => i !== j) })}
        />
      ))}
      {at("fields") ? (
        <p role="alert" className="text-caption text-destructive">
          {t(at("fields") as string)}
        </p>
      ) : null}
      {readOnly || form.fields.length >= START_FORM_FIELDS_MAX ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="start-field-add"
          onClick={() => set(addStartField(form, t(`${K}newField`, { n: form.fields.length + 1 })))}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t(`${K}add`)}
        </Button>
      )}
      <Starters
        id={stage.uid}
        form={form}
        readOnly={readOnly}
        error={at("starters")}
        onPatch={(v) => set({ ...form, ...v })}
      />
      <TextField
        id={`${stage.uid}-sf-title`}
        label={t(`${K}titleTemplate`)}
        description={t(`${K}titleTemplateHelp`)}
        value={form.title}
        readOnly={readOnly}
        error={at("title_template") ? t(at("title_template") as string) : undefined}
        onChange={(v) => set({ ...form, title: v })}
      />
    </section>
  );
}
