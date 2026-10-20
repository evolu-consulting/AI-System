// V2-L · khung "Công thức & thử tính" (mockup `.trybox`): bên trái công thức, bên phải máy tính với số mẫu nhập tay. Không ghi gì.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "./controls";

export function TryBox({
  formula,
  children,
  extra,
}: {
  formula: string[];
  children: ReactNode;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Panel title={t("contracts.settings.try.title")} sub={t("contracts.settings.try.sub")}>
      <div className="grid grid-cols-2 max-md:grid-cols-1">
        <div className="border-r border-rule-soft px-5 py-3.5 max-md:border-r-0">
          <p className="mb-1 text-micro font-semibold tracking-wide text-dim uppercase">
            {t("contracts.settings.try.formula")}
          </p>
          <ol className="list-decimal pl-5 text-caption text-ink-2">
            {formula.map((f) => (
              <li key={f} className="mb-1">
                {f}
              </li>
            ))}
          </ol>
        </div>
        <div className="min-w-0 px-5 py-3.5">{children}</div>
      </div>
      {extra}
    </Panel>
  );
}

export function TryNum({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
}) {
  return (
    <input
      type="number"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-8 w-20 rounded-md border border-field bg-panel px-2 text-right text-caption tabular-nums"
    />
  );
}
