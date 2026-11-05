// HD4-FR-06 · HD4-AC08 · S05: thẻ "Hạn chót hành động" + "Ghi nhận xử lý" (port cm-web `contracts/[id]/page.tsx:324-341`).
// Chỉ HĐ đã duyệt; người có quyền ghi chọn kết quả ⇒ POST rồi tải lại chi tiết. Bản SPA `web/` của mgmt-app không có thẻ này.
import type { ContractDetail } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { useRecordHandled } from "../hooks/use-record-handled";
import {
  daysUntil,
  HANDLED_OUTCOMES,
  leftOf,
  type Outcome,
  showsDeadline,
  todayIso,
  viDate,
} from "../lib/deadline";

type Props = {
  contract: Pick<ContractDetail, "id" | "status" | "kind" | "action_deadline" | "handled">;
  write: boolean;
  queryKey: readonly unknown[];
  today?: string;
};

function Deadline({
  iso,
  handled,
  today,
}: {
  iso: string | null;
  handled: boolean;
  today: string;
}) {
  const { t } = useTranslation();
  if (!iso) return <span className="text-[13px] text-dim">{t("contracts.deadline.none")}</span>;
  const left = daysUntil(iso, today);
  const l = left === null || handled ? null : leftOf(left);
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="tnum font-mono text-[13px]" data-testid="deadline-date">
        {viDate(iso)}
      </span>
      {l && (
        <span className={`text-xs font-medium ${l.tone}`}>
          {t(`contracts.deadline.${l.key}`, { n: l.n })}
        </span>
      )}
    </span>
  );
}

export function DeadlinePanel({ contract: c, write, queryKey, today = todayIso() }: Props) {
  const { t } = useTranslation();
  const { busy, err, record } = useRecordHandled(c.id, queryKey);
  if (!showsDeadline(c)) return null;
  const outcome = c.handled?.outcome as Outcome | undefined;
  return (
    <Panel className="mb-4">
      <div
        className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 text-sm max-sm:px-4"
        data-testid="deadline-panel"
      >
        <span className="flex items-center gap-3">
          {t("contracts.deadline.label")}
          <Deadline iso={c.action_deadline} handled={!!c.handled} today={today} />
        </span>
        {outcome ? (
          <span className="text-dim">
            {t("contracts.deadline.done", { outcome: t(`contracts.deadline.outcomes.${outcome}`) })}
          </span>
        ) : (
          write && (
            <label className="flex items-center gap-2 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
              {t("contracts.deadline.record")}
              <select
                className="field w-56 max-sm:w-full"
                defaultValue=""
                disabled={busy}
                onChange={(e) => e.target.value && void record(e.target.value as Outcome)}
              >
                <option value="">{t("contracts.deadline.pick")}</option>
                {HANDLED_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {t(`contracts.deadline.outcomes.${o}`)}
                  </option>
                ))}
              </select>
            </label>
          )
        )}
        {err && (
          <span role="alert" className="text-late">
            {t("contracts.errors.unknown")}
          </span>
        )}
      </div>
    </Panel>
  );
}
