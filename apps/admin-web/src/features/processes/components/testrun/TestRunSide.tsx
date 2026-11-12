// CR-127 · U3 · M3 · hai cột bên: HĐ thử (nhập tay) + "Kiểm tra trước khi áp dụng"; "Thử nhanh 4 trường hợp".
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FactField, ScenarioRow, WarnRow } from "../../lib/test-run";
import { SelectField, TextField } from "../editor/Fields";

type LooseT = (key: string, opts?: Record<string, unknown>) => string;
const useLooseT = () => useTranslation() as unknown as { t: LooseT };
const K = "process.admin.flow.testRun.";
type Opt = { value: string; label: string };

type FormProps = {
  fields: FactField[];
  raw: Record<string, string>;
  invalid: string[];
  onRaw: (key: string, v: string) => void;
  users: Opt[];
  starter: string;
  onStarter: (v: string) => void;
  warnings: WarnRow[];
};

export function TestRunForm(p: FormProps) {
  const { t } = useLooseT();
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <b>{t(`${K}sample`)}</b>
      {p.fields.map((f) =>
        f.kind === "enum" || f.kind === "boolean" ? (
          <SelectField
            key={f.key}
            id={`testrun-${f.key}`}
            label={f.label}
            value={p.raw[f.key] ?? ""}
            options={
              f.kind === "boolean"
                ? [
                    { value: "true", label: t(`${K}yes`) },
                    { value: "false", label: t(`${K}no`) },
                  ]
                : f.options
            }
            onChange={(v) => p.onRaw(f.key, v)}
          />
        ) : (
          <TextField
            key={f.key}
            id={`testrun-${f.key}`}
            label={f.label}
            value={p.raw[f.key] ?? ""}
            placeholder={f.kind === "number" ? t(`${K}numberHint`) : undefined}
            error={p.invalid.includes(f.key) ? t(`${K}numberInvalid`) : undefined}
            onChange={(v) => p.onRaw(f.key, v)}
          />
        ),
      )}
      <SelectField
        id="testrun-starter"
        label={t(`${K}starter`)}
        value={p.starter}
        options={p.users}
        onChange={p.onStarter}
      />
      <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="testrun-checks">
        <b>{t(`${K}check`)}</b>
        {p.warnings.map((w) => (
          <span key={w.key} className={cn("text-label", w.ok ? "text-success" : "text-warning")}>
            {w.ok ? "✓" : "!"} {w.text}
          </span>
        ))}
      </div>
    </section>
  );
}

type QuickProps = { rows: ScenarioRow[] | null; busy: boolean; onRun: () => void };

export function TestRunQuick({ rows, busy, onRun }: QuickProps) {
  const { t } = useLooseT();
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-label">
      <b>{t(`${K}quick`)}</b>
      {rows?.map((r) => (
        <span key={r.key} data-testid="testrun-scenario">
          {r.label} ⇒ <b>{r.verdict}</b> ({t(`${K}stepsN`, { n: r.steps })})
        </span>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onRun}
        data-testid="testrun-quick"
      >
        {t(`${K}quickRun`)}
      </Button>
      <p className="text-muted-foreground">{t(`${K}hint`)}</p>
    </section>
  );
}
