// CR-103 · R4 fnr-showcase · CR-122 E4/U2c: editor node `set` (họ work, không AI) — mỗi dòng: field output ← nguồn (đầu vào run · hằng ·
// field của bước trước · dữ kiện bản ghi) kèm biến đổi kiểu. Component thuần, điều khiển từ ngoài; `StageForm` nối `stage.set.rows`.
import { SET_AS } from "@ai/contracts/hub-admin";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { SetRowDraft } from "../../lib/draft-types";
import { emptySetRow, SET_ROWS_MAX } from "../../lib/set-form";
import { SelectField, TextField } from "./Fields";

const K = "process.admin.editor.stage.set.";

export type SetPrevStep = { step: number; label: string; fields: readonly { key: string }[] };
export type SetFact = { key: string; label: string };

export type StageSetProps = {
  /** Id nền (thường là `stage.uid`). */
  id: string;
  rows: readonly SetRowDraft[];
  /** Field khai trong `output.fields` của stage (đích của dòng gán). */
  fields: readonly { key: string; type: string }[];
  /** Input khai báo của quy trình (nguồn). */
  inputs: readonly { key: string; label: string; type: string }[];
  /** Bước đứng trước + field output của chúng (nguồn "Bước trước"). */
  prev?: readonly SetPrevStep[];
  /** Dữ kiện của sự kiện (nguồn "Dữ kiện"); vắng ⇒ không hiện nguồn này. */
  facts?: readonly SetFact[];
  readOnly: boolean;
  /** Lỗi theo `values.<j>.key|from` (đã dịch). */
  errors?: Readonly<Record<string, string>>;
  onChange: (rows: SetRowDraft[]) => void;
};

type Row = SetRowDraft;
const SOURCES = ["input", "const", "field", "fact"] as const;

function SourceValue(p: {
  rid: string;
  r: Row;
  props: StageSetProps;
  set: (x: Partial<Row>) => void;
}) {
  const { t } = useTranslation();
  const { r, props, rid } = p;
  const err = props.errors?.[`${rid.split("-set-")[1]}.from`];
  if (r.source === "input")
    return (
      <SelectField
        id={`${rid}-input`}
        label={t(`${K}input`)}
        value={r.input}
        readOnly={props.readOnly}
        error={err}
        options={props.inputs.map((i) => ({ value: i.key, label: i.label }))}
        onChange={(v) => p.set({ input: v })}
      />
    );
  if (r.source === "const")
    return (
      <TextField
        id={`${rid}-value`}
        label={t(`${K}value`)}
        value={r.value}
        readOnly={props.readOnly}
        error={err}
        onChange={(v) => p.set({ value: v })}
      />
    );
  if (r.source === "fact")
    return (
      <SelectField
        id={`${rid}-fact`}
        label={t(`${K}fact`)}
        value={r.ref}
        readOnly={props.readOnly}
        error={err}
        options={(props.facts ?? []).map((f) => ({ value: f.key, label: f.label }))}
        onChange={(v) => p.set({ ref: v })}
      />
    );
  const opts = (props.prev ?? []).flatMap((s) =>
    s.fields.map((f) => ({ value: `${s.step}|${f.key}`, label: `${s.label} · ${f.key}` })),
  );
  return (
    <SelectField
      id={`${rid}-field`}
      label={t(`${K}prevField`)}
      value={r.step === null ? "" : `${r.step}|${r.ref}`}
      readOnly={props.readOnly}
      error={err}
      options={opts}
      onChange={(v) => {
        const [step, ...key] = v.split("|");
        p.set({ step: Number(step), ref: key.join("|") });
      }}
    />
  );
}

export function StageSet(p: StageSetProps) {
  const { t } = useTranslation();
  const set = (j: number, patch: Partial<Row>) =>
    p.onChange(p.rows.map((r, i) => (i === j ? { ...r, ...patch } : r)));
  const sources = SOURCES.filter((s) => s !== "fact" || (p.facts?.length ?? 0) > 0);
  return (
    <fieldset aria-label={t(`${K}title`)} className="space-y-3" data-testid="stage-set">
      <strong className="text-label font-medium">{t(`${K}title`)}</strong>
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      {p.rows.map((r, j) => {
        const rid = `${p.id}-set-${j}`;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: dòng không có id riêng, thứ tự do người dùng sắp
            key={j}
            className="grid grid-cols-2 items-start gap-3 rounded-md border border-border p-2.5"
          >
            <SelectField
              id={`${rid}-key`}
              label={t(`${K}key`)}
              value={r.key}
              readOnly={p.readOnly}
              error={p.errors?.[`${j}.key`]}
              options={p.fields.map((f) => ({ value: f.key, label: `${f.key} (${f.type})` }))}
              onChange={(v) => set(j, { key: v })}
            />
            <SelectField
              id={`${rid}-source`}
              label={t(`${K}source`)}
              value={r.source}
              readOnly={p.readOnly}
              options={sources.map((s) => ({ value: s, label: t(`${K}from.${s}`) }))}
              onChange={(v) => set(j, { source: v as Row["source"] })}
            />
            <SourceValue rid={rid} r={r} props={p} set={(x) => set(j, x)} />
            <SelectField
              id={`${rid}-as`}
              label={t(`${K}as`)}
              value={r.as}
              readOnly={p.readOnly}
              options={[
                { value: "", label: t(`${K}asKeep`) },
                ...SET_AS.map((a) => ({ value: a, label: t(`${K}asType.${a}`) })),
              ]}
              onChange={(v) => set(j, { as: v as Row["as"] })}
            />
            {p.readOnly ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="col-span-2 justify-self-end"
                aria-label={t(`${K}remove`)}
                onClick={() => p.onChange(p.rows.filter((_, i) => i !== j))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        );
      })}
      {p.readOnly || p.rows.length >= SET_ROWS_MAX ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => p.onChange([...p.rows, emptySetRow()])}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t(`${K}add`)}
        </Button>
      )}
    </fieldset>
  );
}
