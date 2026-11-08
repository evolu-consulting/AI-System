// CR-126 · «Việc của tôi»: MỘT kiểu dòng cho ký · duyệt HĐ · việc yêu cầu — nhãn bước · «quy trình · đối tác · số tiền · người đề xuất · ngày»
// · hạn. Testid giữ như cũ để e2e chạy tiếp.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import type { InboxFilter, InboxRow } from "../lib/inbox";

const ROW_TESTID = {
  approval: "approval-task-row",
  sign: "signing-task-row",
  request: undefined,
} as const;

export function InboxRowList({ rows }: { rows: readonly InboxRow[] }) {
  const { t } = useTranslation();
  return (
    <ul data-testid="requests-waiting" className="m-0 list-none p-0">
      {rows.map((r) => (
        <li
          key={r.key}
          data-testid={ROW_TESTID[r.kind]}
          className="border-b border-rule-soft last:border-b-0"
        >
          <Link
            {...r.to}
            data-testid={r.kind === "request" ? "requests-waiting-row" : undefined}
            className="flex min-w-0 items-center gap-3 px-5 py-3 max-sm:px-4"
          >
            <Tag tone={r.due?.late ? "late" : "act"}>{r.tag}</Tag>
            <b className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">
              {r.summary || t("contracts.overview.approvals.untitled")}
            </b>
            {r.escalated && (
              <span className="shrink-0 text-[12.5px] text-soon">
                {t("contracts.approval.engine.escalatedShort")}
              </span>
            )}
            {r.due && (
              <span
                className={`tnum shrink-0 text-[12.5px] ${r.due.late ? "font-semibold text-late" : "text-dim"}`}
              >
                {t(
                  r.due.late
                    ? "contracts.overview.approvals.late"
                    : "contracts.overview.approvals.due",
                  {
                    date: viDate(r.due.at),
                  },
                )}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

const CHIPS: readonly InboxFilter[] = ["all", "approve", "sign"];

export function InboxChips({
  value,
  onChange,
}: {
  value: InboxFilter;
  onChange: (f: InboxFilter) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2 px-5 py-3 max-sm:px-4" data-testid="inbox-chips">
      {CHIPS.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={`rounded-full border px-3 py-1 text-sm ${
            value === c
              ? "border-act bg-act/10 font-semibold text-act"
              : "border-rule-soft text-dim"
          }`}
        >
          {t(`contracts.approvalsPage.filter.${c}`)}
        </button>
      ))}
    </div>
  );
}
