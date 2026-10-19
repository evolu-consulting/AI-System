// HD-FR-96 · S08 · dải trạng thái "Dò giá" — port `CksPricesTab.tsx:14-34` (D9-10: hiện chưa có lượt dò ⇒ không hiện gì).
import type { CksScanJob } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { active, stripJobs } from "../lib/prices";

const WHOLE_MARKET = "*";

export function ScanStrip({ jobs }: { jobs: CksScanJob[] }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.prices.strip.${k}`, o);
  const shown = stripJobs(jobs);
  if (!shown.length) return null;
  return (
    <ul className="mb-4 flex flex-col gap-1.5 text-[13px]" aria-live="polite">
      {shown.map((j) => (
        <li
          key={j.id}
          className={`rounded-lg border px-3 py-2 ${active(j) ? "border-act-line bg-act-soft text-act" : j.state === "done" ? "border-rule bg-panel text-ink-2" : "border-late-line bg-late-bg text-late"}`}
        >
          <b className="font-semibold">
            {L("head", {
              what: j.ca === WHOLE_MARKET ? L("whole") : L("of", { ca: j.ca }),
              years: j.years,
              device: j.device === "remote" ? L("remote") : L("token"),
            })}
          </b>
          {" — "}
          {active(j)
            ? L("running")
            : j.state === "done"
              ? L("done", { found: j.n_found, verified: j.n_verified })
              : (j.error ?? L("failed"))}
        </li>
      ))}
    </ul>
  );
}
