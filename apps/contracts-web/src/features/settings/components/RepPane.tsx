// V2-L · CD-02..05: mục "Điểm uy tín" — chọn ô (nhóm SP × vai) hoặc "Mức & đánh giá" ở thanh phụ, mỗi ô có 3 tab Tiêu chí · Thời gian ·
// Loại việc; ô khác mặc định có chấm cam; "Về mặc định" đưa ô về BA.
import type { RepPreviewIn } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { cellBody, cellIssue, normCell, same } from "../lib/data";
import {
  CELL_KEYS,
  type CellKey,
  type CellTab,
  type RepSel,
  type SettingsData,
} from "../lib/types";
import { CommonPane } from "./CommonPane";
import { CritTab } from "./CritTab";
import { Dot } from "./controls";
import { ImpactBox } from "./ImpactBox";
import { TimeTab } from "./TimeTab";
import { TypesTab } from "./TypesTab";

type Props = {
  data: SettingsData;
  saved: SettingsData;
  defaults: SettingsData;
  sel: RepSel;
  tab: CellTab;
  onSel: (s: RepSel) => void;
  onTab: (t: CellTab) => void;
  set: (d: SettingsData) => void;
};
const GROUPS = ["service", "goods", "referral"] as const;

export function previewBody(
  d: SettingsData,
  saved: SettingsData,
  sel: RepSel,
  tab: CellTab,
): RepPreviewIn | null {
  if (sel === "common")
    return same(d.repSettings, saved.repSettings) ? null : { settings: d.repSettings };
  if (tab === "types") return same(d.jobTypes, saved.jobTypes) ? null : { job_types: d.jobTypes };
  if (same(normCell(d.cells[sel]), normCell(saved.cells[sel])) || cellIssue(d.cells[sel]))
    return null;
  const [group, role] = sel.split(":") as [
    NonNullable<RepPreviewIn["cell"]>["group"],
    NonNullable<RepPreviewIn["cell"]>["role"],
  ];
  return { cell: { group, role, config: cellBody(d.cells[sel]) } };
}

export function RepPane({ data, saved, defaults, sel, tab, onSel, onTab, set }: Props) {
  const { t } = useTranslation();
  const s = (k: string) => t(`contracts.settings.rep.${k}`);
  const custom = (k: CellKey) => !same(normCell(data.cells[k]), normCell(defaults.cells[k]));
  const label = (k: CellKey) =>
    k.startsWith("referral") ? s("payer") : s(`role.${k.split(":")[1]}`);
  const setCell = (k: CellKey, c: SettingsData["cells"][CellKey]) =>
    set({ ...data, cells: { ...data.cells, [k]: c } });
  return (
    <>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{s("title")}</h2>
        <p className="text-caption text-dim">{s("sub")}</p>
      </div>
      <div
        role="tablist"
        aria-label={s("title")}
        className="mb-4 flex flex-wrap gap-x-6 gap-y-3 rounded-xl border border-rule bg-panel px-3.5 py-3"
      >
        {GROUPS.map((g) => (
          <div key={g} className="flex flex-col gap-1.5">
            <span className="text-micro font-semibold text-dim">{s(`group.${g}`)}</span>
            <div className="flex gap-1">
              {CELL_KEYS.filter((k) => k.startsWith(g)).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={sel === k}
                  onClick={() => onSel(k)}
                  className={`rounded-lg border px-2.5 py-1.5 text-[13px] whitespace-nowrap ${sel === k ? "border-act bg-act-soft font-semibold text-act" : "border-rule text-ink-2 hover:border-act-line"}`}
                >
                  {label(k)}
                  {custom(k) && <Dot label={t("contracts.settings.changed")} />}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <span className="text-micro font-semibold text-dim">{s("group.common")}</span>
          <button
            type="button"
            role="tab"
            aria-selected={sel === "common"}
            onClick={() => onSel("common")}
            className={`rounded-lg border px-2.5 py-1.5 text-[13px] ${sel === "common" ? "border-act bg-act-soft font-semibold text-act" : "border-rule text-ink-2 hover:border-act-line"}`}
          >
            {s("common")}
            {!same(data.repSettings, defaults.repSettings) && (
              <Dot label={t("contracts.settings.changed")} />
            )}
          </button>
        </div>
      </div>
      {sel === "common" ? (
        <CommonPane value={data.repSettings} set={(v) => set({ ...data, repSettings: v })} />
      ) : (
        <>
          <div className="mb-4 flex items-end gap-3 border-b border-rule">
            <div role="tablist" className="flex flex-1 gap-5">
              {(["crit", "time", "types"] as const).map((x) => (
                <button
                  key={x}
                  type="button"
                  role="tab"
                  aria-selected={tab === x}
                  onClick={() => onTab(x)}
                  className={`-mb-px border-b-2 px-1 pb-2.5 text-label ${tab === x ? "border-act font-semibold text-act" : "border-transparent text-ink-2"}`}
                >
                  {s(`tab.${x}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!custom(sel)}
              onClick={() => setCell(sel, structuredClone(defaults.cells[sel]))}
              className="mb-1.5 h-8 rounded-lg border border-rule px-3 text-label text-ink-2 hover:bg-sunk disabled:opacity-50"
            >
              {t("contracts.settings.resetCell")}
            </button>
          </div>
          {tab === "crit" && (
            <CritTab
              cell={data.cells[sel]}
              set={(c) => setCell(sel, c)}
              share={data.repSettings.manual_share}
              good={data.repSettings.good_from}
              fair={data.repSettings.fair_from}
            />
          )}
          {tab === "time" && <TimeTab cell={data.cells[sel]} set={(c) => setCell(sel, c)} />}
          {tab === "types" && (
            <TypesTab
              cell={data.cells[sel]}
              types={data.jobTypes}
              set={(j) => set({ ...data, jobTypes: j })}
            />
          )}
        </>
      )}
      <ImpactBox body={previewBody(data, saved, sel, tab)} />
    </>
  );
}
