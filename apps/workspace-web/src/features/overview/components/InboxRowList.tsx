// CR-126 · «Việc của tôi»: MỘT kiểu dòng cho ký · duyệt HĐ · việc yêu cầu — nhãn bước · «quy trình · đối tác · số tiền · người đề xuất» ·
// hạn. Testid giữ như cũ để e2e chạy tiếp.
// CR-127 · U4: dòng thêm trạng thái nhận việc nhóm (Chưa ai nhận / X đang xử lý / x/n / Thay A), việc Xác nhận mốc, HĐ nhận không quy trình.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import type { InboxFilter, InboxRow } from "../lib/inbox";
import { InboxDecisionRow } from "./InboxDecisionRow";

const ROW_TESTID = {
  approval: "approval-task-row",
  sign: "signing-task-row",
  request: undefined,
  milestone: "milestone-task-row",
  inbox: undefined,
} as const;

/** Dòng phụ: «Chưa ai nhận» / «{X} đang xử lý» / «Thay {A}» / x/n (việc đích danh không có). */
function ClaimNote({ r }: { r: InboxRow }) {
  const { t } = useTranslation();
  if (!r.claim && !r.votes && !r.behalf) return null;
  const c = r.claim;
  const who = c?.holder ?? t("contracts.work.u4.someone");
  return (
    <span className="shrink-0 text-[12.5px] text-dim" data-testid="inbox-claim">
      {c?.state === "unclaimed" && t("contracts.work.u4.claim.unclaimed")}
      {c?.state === "other" && t("contracts.work.u4.claim.other", { who })}
      {c?.state === "mine" && t("contracts.work.u4.claim.mine")}
      {r.votes && t("contracts.work.u4.claim.votes", { n: r.votes })}
      {r.behalf && ` · ${t("contracts.work.u4.claim.behalf", { who: r.behalf })}`}
    </span>
  );
}

function DueNote({ due }: { due: NonNullable<InboxRow["due"]> }) {
  const { t } = useTranslation();
  return (
    <span
      className={`tnum shrink-0 text-[12.5px] ${due.late ? "font-semibold text-late" : "text-dim"}`}
    >
      {t(due.late ? "contracts.overview.approvals.late" : "contracts.overview.approvals.due", {
        date: viDate(due.at),
      })}
    </span>
  );
}

function TaskRow({ r }: { r: InboxRow }) {
  const { t } = useTranslation();
  return (
    <Link
      {...r.to}
      data-testid={r.kind === "request" ? "requests-waiting-row" : undefined}
      className="flex min-w-0 items-center gap-3 px-5 py-3 max-sm:px-4"
    >
      <Tag tone={r.due?.late ? "late" : "act"}>
        {r.kind === "milestone" ? t("contracts.work.u4.row.milestone") : r.tag}
      </Tag>
      <b className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">
        {r.summary || t("contracts.overview.approvals.untitled")}
      </b>
      <ClaimNote r={r} />
      {r.escalated && (
        <span className="shrink-0 text-[12.5px] text-soon">
          {t("contracts.approval.engine.escalatedShort")}
        </span>
      )}
      {r.due && <DueNote due={r.due} />}
    </Link>
  );
}

export function InboxRowList({ rows }: { rows: readonly InboxRow[] }) {
  return (
    <ul data-testid="requests-waiting" className="m-0 list-none p-0">
      {rows.map((r) =>
        r.inbox ? (
          <li key={r.key} className="border-b border-rule-soft last:border-b-0">
            <InboxDecisionRow contractId={r.inbox.contractId} sender={r.inbox.sender} />
          </li>
        ) : (
          <li
            key={r.key}
            data-testid={ROW_TESTID[r.kind]}
            className="border-b border-rule-soft last:border-b-0"
          >
            <TaskRow r={r} />
          </li>
        ),
      )}
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
