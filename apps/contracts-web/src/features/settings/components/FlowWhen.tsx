// contract-flow S5 · điều kiện áp dụng của một bước: loại HĐ (nhiều) AND/OR giá trị (≥ / <).
import { useTranslation } from "react-i18next";
import type { DealKind, StepWhen } from "../api-flow";
import { FIELD, Seg } from "./controls";

const DEALS: readonly DealKind[] = ["buy", "sell", "referral"];

export function FlowWhen({
  when,
  onChange,
  error,
}: {
  when: StepWhen | null;
  onChange: (w: StepWhen | null) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const f = (k: string) => t(`contracts.flow.${k}`);
  if (!when)
    return (
      <div className="flex items-center gap-3">
        <span className="text-dim">{f("always")}</span>
        <button
          type="button"
          className="underline"
          onClick={() => onChange({ op: "and", deal: [] })}
        >
          {f("addCond")}
        </button>
      </div>
    );
  const deals = when.deal ?? [];
  const toggle = (d: DealKind) => {
    const next = deals.includes(d) ? deals.filter((x) => x !== d) : [...deals, d];
    onChange({ ...when, deal: next });
  };
  const setValue = (on: boolean) => {
    const { value: _drop, ...rest } = when;
    onChange(on ? { ...rest, value: { cmp: "gte", amount: 0 } } : rest);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-caption text-dim">{f("dealKind")}</span>
        {DEALS.map((d) => (
          <label key={d} className="flex items-center gap-1">
            <input type="checkbox" checked={deals.includes(d)} onChange={() => toggle(d)} />
            {f(`deal.${d}`)}
          </label>
        ))}
      </div>
      <Seg
        label={f("op")}
        value={when.op}
        options={[
          ["and", f("opAnd")],
          ["or", f("opOr")],
        ]}
        onChange={(op) => onChange({ ...when, op })}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!when.value}
            onChange={(e) => setValue(e.target.checked)}
          />
          {f("valueCond")}
        </label>
        {when.value && (
          <>
            <select
              aria-label={f("cmp")}
              className={`${FIELD} !w-24`}
              value={when.value.cmp}
              onChange={(e) =>
                onChange({
                  ...when,
                  value: {
                    amount: when.value?.amount ?? 0,
                    cmp: e.target.value === "lt" ? "lt" : "gte",
                  },
                })
              }
            >
              <option value="gte">≥</option>
              <option value="lt">&lt;</option>
            </select>
            <input
              type="number"
              min={0}
              aria-label={f("amount")}
              className={`${FIELD} !w-44`}
              value={when.value.amount}
              onChange={(e) =>
                onChange({
                  ...when,
                  value: { cmp: when.value?.cmp ?? "gte", amount: Number(e.target.value) },
                })
              }
            />
            <span className="text-caption text-dim">{f("emptyValueNote")}</span>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-caption text-late">
          {error}
        </p>
      )}
      <button type="button" className="self-start underline" onClick={() => onChange(null)}>
        {f("clearCond")}
      </button>
    </div>
  );
}
