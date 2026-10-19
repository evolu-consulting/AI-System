// HD8-FR-03 · "Tiêu chí & trọng số" — port `ScoringPage.tsx:96-162`: bật/tắt, thanh trọng số, ô %, xoá (hỏi lại), thêm tiêu chí tự
// chấm từ danh sách, khôi phục tiêu chí có sẵn; chỉ quản lý sửa được.
import type { Criterion, ScoreConfigOut } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { Panel } from "~/components/shared/layout";
import { choicesOf, type Draft, MAX_CRITERIA, restorableOf, toInt, totalOf } from "../lib/scoring";

const numField = "field w-[72px] text-right font-mono";
type Props = {
  d: Draft;
  setD: (d: Draft) => void;
  cfg: ScoreConfigOut | undefined;
  owner: boolean;
};
type T = (k: string, o?: Record<string, unknown>) => string;

function CriterionRow({
  c,
  i,
  owner,
  d,
  setD,
  L,
}: {
  c: Criterion;
  i: number;
  owner: boolean;
  d: Draft;
  setD: (d: Draft) => void;
  L: T;
}) {
  const hint = c.kind === "manual" ? L("manualHint") : L(`hint.${c.key}`);
  const name = c.label || c.key;
  const setC = (patch: Partial<Criterion>) =>
    setD({ ...d, criteria: d.criteria.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const remove = async () => {
    const ok = await confirmDialog({
      title: L("removeTitle", { name }),
      body: c.kind === "manual" ? L("removeManual") : L("removeAuto"),
      confirmLabel: L("removeConfirm"),
      danger: true,
    });
    if (ok) setD({ ...d, criteria: d.criteria.filter((_, j) => j !== i) });
  };
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,180px)_auto_auto] items-center gap-4 border-b border-rule-soft px-5 py-3 last:border-0 max-sm:grid-cols-[auto_1fr_auto_auto]">
      <input
        type="checkbox"
        checked={c.enabled}
        disabled={!owner}
        onChange={(e) => setC({ enabled: e.target.checked })}
        className="h-5 w-5 accent-[var(--color-act)]"
        aria-label={L("enable", { name })}
      />
      <span className="min-w-0">
        <span className="block font-semibold">{name}</span>
        <span className="block text-[12.5px] text-dim">
          {c.kind === "manual" && (
            <span className="mr-1.5 rounded bg-idle-bg px-1.5 py-px text-[11.5px]">
              {L("manualTag")}
            </span>
          )}
          {hint}
        </span>
      </span>
      <span className="h-2 rounded-full bg-idle-bg max-sm:hidden">
        <span
          className="block h-2 rounded-full bg-act"
          style={{ width: `${c.enabled ? c.weight : 0}%` }}
        />
      </span>
      <label className="flex items-center gap-1.5 text-sm text-dim">
        <input
          className={numField}
          inputMode="numeric"
          value={c.weight}
          disabled={!owner || !c.enabled}
          onChange={(e) => setC({ weight: toInt(e.target.value) })}
          aria-label={L("weightAria", { name })}
        />
        %
      </label>
      {owner ? (
        <button
          type="button"
          className="btn h-8 px-2 text-[13px] text-late"
          aria-label={L("removeAria", { name })}
          onClick={() => void remove()}
        >
          {L("remove")}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function AddRow({
  d,
  setD,
  cfg,
  L,
}: {
  d: Draft;
  setD: (d: Draft) => void;
  cfg: ScoreConfigOut | undefined;
  L: T;
}) {
  const [label, setLabel] = useState("");
  const [weight, setWeight] = useState(10);
  const full = d.criteria.length >= MAX_CRITERIA;
  const choices = choicesOf(d, cfg);
  const restorable = restorableOf(d, cfg);
  const add = () => {
    setD({
      ...d,
      criteria: [...d.criteria, { key: "", kind: "manual", label, enabled: true, weight }],
    });
    setLabel("");
  };
  const restore = (key: string) => {
    const r = restorable.find((x) => x.key === key);
    if (r)
      setD({
        ...d,
        criteria: [
          ...d.criteria,
          { key: r.key, kind: "auto", label: r.label, enabled: true, weight: r.weight },
        ],
      });
  };
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-rule px-5 py-3.5 text-sm">
      <label className="flex min-w-[220px] flex-1 flex-col gap-1">
        <span className="text-dim">{L("addManual")}</span>
        <select
          className="field h-9"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={!choices.length}
        >
          <option value="">{choices.length ? L("pick") : L("pickedAll")}</option>
          {choices.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-dim">{L("weight")}</span>
        <span className="flex items-center gap-1.5">
          <input
            className={numField}
            inputMode="numeric"
            value={weight}
            onChange={(e) => setWeight(toInt(e.target.value))}
            aria-label={L("newWeightAria")}
          />
          %
        </span>
      </label>
      <button type="button" className="btn h-9" disabled={!label.trim() || full} onClick={add}>
        {L("addBtn")}
      </button>
      {restorable.length > 0 && (
        <select
          className="field ml-auto h-9"
          value=""
          disabled={full}
          aria-label={L("restoreAria")}
          onChange={(e) => restore(e.target.value)}
        >
          <option value="">{L("restore")}</option>
          {restorable.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label} ({r.weight}%)
            </option>
          ))}
        </select>
      )}
      {full && <p className="w-full text-[12.5px] text-dim">{L("max", { n: MAX_CRITERIA })}</p>}
      <p className="w-full text-[12.5px] text-dim">
        {L("manualNote1")} <b>{L("manualNoteBold")}</b>
        {L("manualNote2")}
      </p>
    </div>
  );
}

export function CriteriaPanel({ d, setD, cfg, owner }: Props) {
  const { t } = useTranslation();
  const L: T = (k, o) => t(`contracts.scoring.${k}`, o);
  const total = totalOf(d);
  return (
    <Panel className="mb-4">
      <div className="flex items-center border-b border-rule px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{L("criteria")}</h2>
        <span
          className={`ml-auto text-sm font-semibold ${total === 100 ? "text-ok" : "text-late"}`}
        >
          {L("total")} <span className="font-mono">{total}%</span>{" "}
          {total === 100 ? "✓" : L("totalNeed")}
        </span>
      </div>
      {d.criteria.map((c, i) => (
        <CriterionRow key={c.key || c.label} c={c} i={i} owner={owner} d={d} setD={setD} L={L} />
      ))}
      {owner && <AddRow d={d} setD={setD} cfg={cfg} L={L} />}
    </Panel>
  );
}
