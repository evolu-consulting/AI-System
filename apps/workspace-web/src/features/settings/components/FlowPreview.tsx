// CR-108 · "Xem trước đường đi": loại HĐ + giá trị mẫu (ngăn nghìn khi gõ, nút chọn nhanh), dòng kết quả "đi qua N/M bước".
// Trạng thái nâng lên `FlowLoaded` (`usePreview`) để canvas làm mờ bước bị bỏ qua (CR-106).
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "~/shared/ui/settings-layout";
import { type CurrentFlow, type DealKind, previewPath } from "../lib/current-flow";
import { digitsOf, formatDigits, parseValue, QUICK_VALUES, runSummary } from "../lib/preview-value";
import { FIELD } from "./controls";

export function usePreview(flow: CurrentFlow) {
  const [deal, setDeal] = useState<DealKind>("buy");
  /** Chỉ chữ số (ô hiển thị = `formatDigits(raw)`). */
  const [raw, setRaw] = useState("");
  const value = parseValue(raw);
  const run = useMemo(() => previewPath(flow.steps, { deal, value }), [flow.steps, deal, value]);
  return { deal, setDeal, raw, setRaw, value, run };
}

export function FlowPreview({
  flow,
  p: { deal, setDeal, raw, setRaw, value, run },
}: {
  flow: CurrentFlow;
  p: ReturnType<typeof usePreview>;
}) {
  const { t } = useTranslation();
  const f = (k: string) => t(`contracts.flow.${k}`);
  const sum = runSummary(flow.steps, run);
  return (
    <SettingsGroup title={f("previewTitle")}>
      <p className="px-4 pt-4 font-medium" data-testid="flow-preview-summary">
        {t("contracts.flow.previewResult", { n: sum.n, m: sum.m, steps: sum.names.join(" → ") })}
      </p>
      <div className="flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-caption text-dim">{f("dealKind")}</span>
          <select
            className={`${FIELD} !w-40`}
            value={deal}
            onChange={(e) => setDeal(e.target.value as DealKind)}
          >
            {(["buy", "sell", "referral"] as const).map((d) => (
              <option key={d} value={d}>
                {f(`deal.${d}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-dim">{f("sampleValue")}</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={`${FIELD} !w-56`}
            value={formatDigits(raw)}
            placeholder={f("emptyValue")}
            onChange={(e) => setRaw(digitsOf(e.target.value))}
          />
        </label>
        <fieldset className="flex min-w-0 flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{f("quick.label")}</legend>
          {QUICK_VALUES.map((q) => (
            <button
              key={q.key}
              type="button"
              data-testid={`flow-quick-${q.key}`}
              aria-pressed={value === q.value}
              className={`h-8 rounded-full border px-3 text-label ${
                value === q.value
                  ? "border-act-line bg-act-soft font-semibold text-act"
                  : "border-rule text-ink-2 hover:bg-sunk"
              }`}
              onClick={() => setRaw(q.value === null ? "" : String(q.value))}
            >
              {f(`quick.${q.key}`)}
            </button>
          ))}
        </fieldset>
      </div>
      <ol className="flex flex-col gap-1 px-4 pb-4" data-testid="flow-preview">
        {flow.steps.map((s, i) => (
          <li key={s.key} data-run={run[i]} className={run[i] ? "" : "text-dim line-through"}>
            {i + 1}. {s.name} — {run[i] ? f("runs") : f("skipped")}
          </li>
        ))}
      </ol>
    </SettingsGroup>
  );
}
