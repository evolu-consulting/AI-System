// HD8-FR-03 · các khối phụ của trang Cách tính điểm — port `ScoringPage.tsx:164-224`: "Điểm được tính lúc nào?", "Quy tắc chung"
// (xếp mức, tối thiểu sự kiện, khoảng tháng, ưu tiên gần đây, chỉnh tay ±10), "Xem trước", "Lịch sử thay đổi".
import type { ScoreHistoryRow, ScorePreview } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { type Draft, wentUp } from "../lib/scoring";

const numField = "field w-[72px] text-right font-mono";
const digits = (s: string) => Number(s.replace(/\D/g, "")) || 0;

export function WhenPanel() {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.scoring.${k}`);
  return (
    <Panel className="mb-4 p-5 text-[13.5px]">
      <h2 className="mb-1.5 text-[15px] font-semibold">{L("whenTitle")}</h2>
      <p className="text-ink-2">{L("when1")}</p>
      <p className="text-ink-2">{L("when2")}</p>
      <p className="text-ink-2">
        {L("when3a")} <b>{L("when3b")}</b> {L("when3c")}{" "}
        <Link to="/partners" className="text-act underline underline-offset-2">
          {L("when3link")}
        </Link>
        {L("when3d")}
      </p>
      <p className="text-ink-2">{L("when4")}</p>
    </Panel>
  );
}

export function RulesPanel({
  d,
  setD,
  owner,
}: {
  d: Draft;
  setD: (d: Draft) => void;
  owner: boolean;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.scoring.${k}`, o);
  const setR = (patch: Partial<Draft["rules"]>) => setD({ ...d, rules: { ...d.rules, ...patch } });
  const r = d.rules;
  return (
    <Panel className="mb-4 p-5">
      <h2 className="mb-4 text-[15px] font-semibold">{L("rulesTitle")}</h2>
      <div className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
        <div className="space-y-2 text-sm">
          <p className="text-dim">{L("bands")}</p>
          <label className="flex items-center gap-3">
            <b className="w-12 text-ok">{t("contracts.partners.band.good")}</b> {L("from")}
            <input
              className={numField}
              disabled={!owner}
              value={r.good_from}
              onChange={(e) => setR({ good_from: digits(e.target.value) })}
            />
          </label>
          <label className="flex items-center gap-3">
            <b className="w-12">{t("contracts.partners.band.fair")}</b> {L("from")}
            <input
              className={numField}
              disabled={!owner}
              value={r.fair_from}
              onChange={(e) => setR({ fair_from: digits(e.target.value) })}
            />
          </label>
          <p className="flex items-center gap-3">
            <b className="w-12 text-soon">{t("contracts.partners.band.watch")}</b>{" "}
            {L("below", { n: r.fair_from })}
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <label className="block">
            <span className="text-dim">{L("minEvents")}</span>
            <span className="mt-1 flex items-center gap-2">
              <input
                className={numField}
                disabled={!owner}
                value={r.min_events}
                onChange={(e) => setR({ min_events: digits(e.target.value) })}
              />{" "}
              {L("events")}
            </span>
          </label>
          <label className="block">
            <span className="text-dim">{L("window")}</span>
            <span className="mt-1 flex items-center gap-2">
              <input
                className={numField}
                disabled={!owner}
                value={r.window_months}
                onChange={(e) => setR({ window_months: Number(e.target.value) || 1 })}
              />{" "}
              {L("months")}
            </span>
          </label>
        </div>
        <div className="space-y-3 text-sm">
          <label className="flex gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 accent-[var(--color-act)]"
              disabled={!owner}
              checked={r.recency_boost}
              onChange={(e) => setR({ recency_boost: e.target.checked })}
            />
            <span>
              <b>{L("recency")}</b>
              <span className="block text-dim">{L("recencyHint", { n: r.recency_months })}</span>
            </span>
          </label>
          <label className="flex gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 accent-[var(--color-act)]"
              disabled={!owner}
              checked={r.manual_adjust}
              onChange={(e) => setR({ manual_adjust: e.target.checked })}
            />
            <span>
              <b>{L("adjust")}</b>
              <span className="block text-dim">{L("adjustHint")}</span>
            </span>
          </label>
        </div>
      </div>
    </Panel>
  );
}

export function PreviewPanel({ p }: { p: ScorePreview }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.scoring.${k}`, o);
  return (
    <Panel className="mb-4 p-5">
      <h2 className="mb-2 text-[15px] font-semibold">{L("previewTitle")}</h2>
      <ul className="space-y-1.5 text-sm">
        {p.changes.slice(0, 8).map((x) => (
          <li key={x.party} className="flex justify-between gap-4 rounded-lg bg-sunk px-3 py-2">
            <span>{x.name}</span>
            <span className="font-mono">
              {x.old ?? "–"} → {x.new ?? "–"}
              {x.band_old !== x.band_new && x.band_new
                ? ` · ${wentUp(x.band_old, x.band_new) ? L("up") : L("down")} ${t(`contracts.partners.band.${x.band_new}`)}`
                : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-dim">
        {L("changedBand", { n: p.changed_band, total: p.total })}
      </p>
    </Panel>
  );
}

export function HistoryPanel({ rows }: { rows: ScoreHistoryRow[] | undefined }) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.scoring.${k}`);
  return (
    <Panel className="p-5">
      <h2 className="mb-2 text-[15px] font-semibold">{L("historyTitle")}</h2>
      {!rows?.length ? (
        <p className="text-sm text-dim">{L("historyEmpty")}</p>
      ) : (
        <ul className="space-y-1 text-[13.5px]">
          {rows.map((h) => (
            <li key={h.version}>
              <span className="font-mono text-dim">{viDate(h.at)}</span> · {h.by ?? ""} ·{" "}
              {h.summary}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
