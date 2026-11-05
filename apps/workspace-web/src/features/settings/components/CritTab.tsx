// V2-L · CD-02/03: tab "Tiêu chí" của một ô — bật/tắt, trọng số (thanh trượt, hiện % sau chuẩn hoá), ≤ 8 tiêu chí tự thêm (3 kiểu),
// kèm "thử tính" điểm theo bản nháp. Điểm uy tín thật của đối tác đổi ra sao: `ImpactBox`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { percentOf, slugKey } from "../lib/rep-data";
import {
  type Cell,
  type Criterion,
  type CriterionKind,
  MAX_CUSTOM,
  type Milestone,
} from "../lib/rep-types";
import { levelOf, tryCriteria } from "../lib/try-calc";
import { FIELD, Num, Panel, Seg, Switch } from "./controls";
import { TryBox, TryNum } from "./TryBox";

type Props = { cell: Cell; set: (c: Cell) => void; share: number; good: number; fair: number };
const MS: Milestone[] = ["delivery", "payment", "serial", "commission"];

type RowProps = {
  x: Criterion;
  pctValue: number | undefined;
  cell: Cell;
  set: (c: Cell) => void;
  patch: (key: string, p: Partial<Criterion>) => void;
};

function CritRow({ x, pctValue, cell, set, patch }: RowProps) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, string | number>) => t(`contracts.settings.rep.${k}`, o);
  return (
    <div
      className={`grid grid-cols-[1fr_280px] items-center gap-4 border-t border-rule-soft px-5 py-3 first:border-t-0 max-md:grid-cols-1 ${x.enabled ? "" : "opacity-60"}`}
    >
      <div className="min-w-0">
        <b className="text-label">{x.label}</b>
        {x.custom && (
          <span className="ml-2 rounded bg-sunk px-1.5 py-0.5 text-micro">{s("custom")}</span>
        )}
        {x.custom && (
          <button
            type="button"
            className="ml-2 text-caption text-late hover:underline"
            onClick={() => set({ ...cell, criteria: cell.criteria.filter((y) => y.key !== x.key) })}
          >
            {s("remove")}
          </button>
        )}
        <p className="text-caption text-dim">{x.custom ? s(`how.${x.kind}`) : s(`how.${x.key}`)}</p>
      </div>
      <div className="flex items-center gap-3">
        <Switch
          checked={x.enabled}
          onChange={(v) => patch(x.key, { enabled: v })}
          label={s("use", { name: x.label })}
        />
        {x.enabled ? (
          <>
            <input
              type="range"
              min={1}
              max={50}
              value={Math.min(50, Math.max(1, x.weight))}
              aria-label={s("weight", { name: x.label })}
              className="min-w-0 flex-1 accent-[var(--primary)]"
              onChange={(e) => patch(x.key, { weight: Number(e.target.value) })}
            />
            <span className="w-11 text-right text-label font-semibold text-act tabular-nums">
              {pctValue}%
            </span>
          </>
        ) : (
          <span className="text-caption text-dim">{s("off")}</span>
        )}
      </div>
    </div>
  );
}

function AddForm({ cell, set, done }: { cell: Cell; set: (c: Cell) => void; done: () => void }) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.rep.${k}`);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Exclude<CriterionKind, "jobs">>("bad_count");
  const [ms, setMs] = useState<Milestone>("delivery");
  const [penalty, setPenalty] = useState(10);
  const add = () => {
    const c: Criterion = {
      key: slugKey(
        label,
        cell.criteria.map((x) => x.key),
      ),
      label: label.trim(),
      kind,
      weight: 10,
      enabled: true,
      custom: true,
      ...(kind === "ontime" ? { milestone: ms } : {}),
      ...(kind === "bad_count" ? { penalty } : {}),
    };
    set({ ...cell, criteria: [...cell.criteria, c] });
    done();
  };
  return (
    <div className="grid gap-3 border-t border-rule-soft bg-sunk px-5 py-4">
      <input
        aria-label={s("newName")}
        placeholder={s("newName")}
        className={FIELD}
        maxLength={60}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <Seg
        label={s("newKind")}
        value={kind}
        onChange={setKind}
        options={[
          ["bad_count", s("kindBad")],
          ["ontime", s("kindOntime")],
          ["manual", s("kindManual")],
        ]}
      />
      {kind === "ontime" && (
        <Seg
          label={s("newMilestone")}
          value={ms}
          onChange={setMs}
          options={MS.map((m) => [m, t(`contracts.settings.rep.ms.${m}`)] as const)}
        />
      )}
      {kind === "bad_count" && (
        <Num
          value={penalty}
          onChange={setPenalty}
          min={1}
          max={100}
          suffix={s("perTen")}
          className="max-w-60"
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!label.trim()}
          onClick={add}
          className="h-9 rounded-lg bg-act px-4 text-label font-semibold text-on-act disabled:opacity-50"
        >
          {s("add")}
        </button>
        <button
          type="button"
          onClick={done}
          className="h-9 rounded-lg px-3 text-label text-dim hover:text-ink"
        >
          {t("contracts.common.cancel")}
        </button>
      </div>
    </div>
  );
}

export function CritTab({ cell, set, share, good, fair }: Props) {
  const { t } = useTranslation();
  const s = (k: string, o?: Record<string, string | number>) => t(`contracts.settings.rep.${k}`, o);
  const [adding, setAdding] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [stars, setStars] = useState(4);
  const pct = percentOf(cell);
  const patch = (key: string, p: Partial<Criterion>) =>
    set({ ...cell, criteria: cell.criteria.map((x) => (x.key === key ? { ...x, ...p } : x)) });
  const customs = cell.criteria.filter((x) => x.custom).length;
  const sample = (k: string, i: number) =>
    scores[k] ?? [90, 75, 100, 80, 60, 85, 70, 95][i % 8] ?? 80;
  const r = tryCriteria(
    cell,
    Object.fromEntries(cell.criteria.map((x, i) => [x.key, sample(x.key, i)])),
    share,
    stars,
  );
  return (
    <>
      <Panel
        title={s("critTitle")}
        sub={`${cell.criteria.filter((x) => x.custom).length}/${MAX_CUSTOM}`}
        action={
          <button
            type="button"
            disabled={customs >= MAX_CUSTOM}
            onClick={() => setAdding(true)}
            className="h-8 rounded-lg border border-act px-3 text-label text-act hover:bg-act-soft disabled:opacity-50"
          >
            {s("addCrit")}
          </button>
        }
      >
        {cell.criteria.map((x) => (
          <CritRow key={x.key} x={x} pctValue={pct[x.key]} cell={cell} set={set} patch={patch} />
        ))}
        {adding && <AddForm cell={cell} set={set} done={() => setAdding(false)} />}
      </Panel>
      <TryBox
        formula={[
          s("f.crit1"),
          s("f.crit2"),
          share > 0 ? s("f.crit3", { a: 100 - share, b: share }) : s("f.crit3off"),
          s("f.levels", { good, fair }),
        ]}
      >
        <table className="w-full text-caption">
          <thead>
            <tr className="text-dim">
              <th className="text-left">{s("tCrit")}</th>
              <th className="text-right">{s("tSample")}</th>
              <th className="text-right">{s("tWeight")}</th>
              <th className="text-right">{s("tPart")}</th>
            </tr>
          </thead>
          <tbody>
            {cell.criteria
              .filter((x) => x.enabled)
              .map((x, i) => {
                const row = r.rows.find((y) => y.key === x.key);
                return (
                  <tr key={x.key}>
                    <td className="py-1">{x.label}</td>
                    <td className="text-right">
                      <TryNum
                        label={x.label}
                        value={sample(x.key, i)}
                        min={0}
                        max={100}
                        onChange={(v) => setScores({ ...scores, [x.key]: v })}
                      />
                    </td>
                    <td className="text-right tabular-nums">{Math.round(row?.pct ?? 0)}%</td>
                    <td className="text-right tabular-nums">{(row?.part ?? 0).toFixed(1)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {share > 0 && (
          <div className="mt-2 flex items-center justify-between text-caption">
            <span>{s("tStars")}</span>
            <TryNum
              label={s("tStars")}
              value={stars}
              min={0}
              max={5}
              step={0.5}
              onChange={setStars}
            />
          </div>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-rule-soft pt-2 text-label">
          <span>{s("tResult")}</span>
          <b data-testid="try-result" className="text-lg tabular-nums">
            {r.final} · {s(`level.${levelOf(r.final, good, fair)}`)}
          </b>
        </div>
      </TryBox>
    </>
  );
}
