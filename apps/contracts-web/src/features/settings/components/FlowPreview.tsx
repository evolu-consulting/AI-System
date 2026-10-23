// contract-flow S5 · xem trước đường đi: chọn loại + giá trị mẫu ⇒ bước nào chạy / bị bỏ qua.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DealKind, FlowStep } from "../api-flow";
import { previewPath } from "../lib/flow-path";
import { FIELD, Panel } from "./controls";

export function FlowPreview({ steps }: { steps: FlowStep[] }) {
  const { t } = useTranslation();
  const f = (k: string) => t(`contracts.flow.${k}`);
  const [deal, setDeal] = useState<DealKind>("buy");
  const [raw, setRaw] = useState("");
  const value = raw.trim() === "" ? null : Number(raw);
  const path = previewPath(steps, { deal, value: Number.isFinite(value) ? value : null });
  return (
    <Panel title={f("previewTitle")}>
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
            type="number"
            min={0}
            className={`${FIELD} !w-48`}
            value={raw}
            placeholder={f("emptyValue")}
            onChange={(e) => setRaw(e.target.value)}
          />
        </label>
      </div>
      <ol className="flex flex-col gap-1 px-4 pb-4" data-testid="flow-preview">
        {path.map((p) => {
          const s = steps[p.index];
          return (
            <li
              key={s?.key ?? p.index}
              data-run={p.run}
              className={p.run ? "" : "text-dim line-through"}
            >
              {p.index + 1}. {s?.name || f("unnamed")} — {p.run ? f("runs") : f("skipped")}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
