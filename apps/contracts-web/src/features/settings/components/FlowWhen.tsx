// contract-flow S5 · điều kiện áp dụng của một bước: loại HĐ (nhiều) AND/OR giá trị (≥ > ≤ <).
import { useTranslation } from "react-i18next";
import type { DealKind, ValueOp, FlowWhen as When } from "../api-flow";
import { buildWhen, whenParts } from "../lib/flow-path";
import { FIELD, Seg } from "./controls";

const DEALS: readonly DealKind[] = ["buy", "sell", "referral"];
const OPS: readonly [ValueOp, string][] = [
  ["ge", "≥"],
  ["gt", ">"],
  ["le", "≤"],
  ["lt", "<"],
];

export function FlowWhen({
  when,
  onChange,
  error,
}: {
  when: When | null;
  onChange: (w: When | null) => void;
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
          onClick={() => onChange({ op: "and", conds: [] })}
        >
          {f("addCond")}
        </button>
      </div>
    );
  const { deal, value } = whenParts(when);
  const set = (d: readonly DealKind[], v: typeof value, op = when.op) =>
    onChange(buildWhen(op, d, v));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-caption text-dim">{f("dealKind")}</span>
        {DEALS.map((d) => (
          <label key={d} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={deal.includes(d)}
              onChange={() =>
                set(deal.includes(d) ? deal.filter((x) => x !== d) : [...deal, d], value)
              }
            />
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
        onChange={(op) => set(deal, value, op)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => set(deal, e.target.checked ? { op: "ge", value: 0 } : null)}
          />
          {f("valueCond")}
        </label>
        {value && (
          <>
            <select
              aria-label={f("cmp")}
              className={`${FIELD} !w-24`}
              value={value.op}
              onChange={(e) => set(deal, { ...value, op: e.target.value as ValueOp })}
            >
              {OPS.map(([o, label]) => (
                <option key={o} value={o}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              aria-label={f("amount")}
              className={`${FIELD} !w-44`}
              value={value.value}
              onChange={(e) => set(deal, { ...value, value: Math.trunc(Number(e.target.value)) })}
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
