// CR-103 · R4 fnr-showcase: editor node `set` (họ work, không AI) — mỗi dòng: field output ← input run | hằng.
// Component thuần, điều khiển từ ngoài; `StageForm` nối `stage.set.rows` vào đây.
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { SetRowDraft } from "../../lib/draft-types";
import { emptySetRow, SET_ROWS_MAX } from "../../lib/set-form";
import { SelectField, TextField } from "./Fields";

const K = "process.admin.editor.stage.set.";

export type StageSetProps = {
  /** Id nền (thường là `stage.uid`). */
  id: string;
  rows: readonly SetRowDraft[];
  /** Field khai trong `output.fields` của stage (đích của dòng gán). */
  fields: readonly { key: string; type: string }[];
  /** Input khai báo của quy trình (nguồn). */
  inputs: readonly { key: string; label: string; type: string }[];
  readOnly: boolean;
  /** Lỗi theo `values.<j>.key|from` (đã dịch). */
  errors?: Readonly<Record<string, string>>;
  onChange: (rows: SetRowDraft[]) => void;
};

export function StageSet(p: StageSetProps) {
  const { t } = useTranslation();
  const set = (j: number, patch: Partial<SetRowDraft>) =>
    p.onChange(p.rows.map((r, i) => (i === j ? { ...r, ...patch } : r)));
  return (
    <fieldset aria-label={t(`${K}title`)} className="space-y-3" data-testid="stage-set">
      <strong className="text-label font-medium">{t(`${K}title`)}</strong>
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      {p.rows.map((r, j) => {
        const rid = `${p.id}-set-${j}`;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: dòng không có id riêng, thứ tự do người dùng sắp
          <div key={j} className="grid items-start gap-3 sm:grid-cols-[1fr_9rem_1fr_auto]">
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
              options={[
                { value: "input", label: t(`${K}fromInput`) },
                { value: "const", label: t(`${K}fromConst`) },
              ]}
              onChange={(v) => set(j, { source: v === "const" ? "const" : "input" })}
            />
            {r.source === "input" ? (
              <SelectField
                id={`${rid}-input`}
                label={t(`${K}input`)}
                value={r.input}
                readOnly={p.readOnly}
                error={p.errors?.[`${j}.from`]}
                options={p.inputs.map((i) => ({ value: i.key, label: i.label }))}
                onChange={(v) => set(j, { input: v })}
              />
            ) : (
              <TextField
                id={`${rid}-value`}
                label={t(`${K}value`)}
                value={r.value}
                readOnly={p.readOnly}
                error={p.errors?.[`${j}.from`]}
                onChange={(v) => set(j, { value: v })}
              />
            )}
            {p.readOnly ? null : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-6"
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
