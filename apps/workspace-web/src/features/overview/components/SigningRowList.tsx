// CR-125 · x1 · HĐ chờ CHÍNH người xem ký (`GET /my-work` → signing[]) — dưới danh sách duyệt ở trang "Chờ tôi duyệt".
import type { MyWorkSign } from "@ai/contracts/pack-contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import { signTitle } from "../lib/waiting";

export function SigningRowList({ rows }: { rows: readonly MyWorkSign[] }) {
  const { t } = useTranslation();
  return (
    <ul data-testid="signing-tasks">
      {rows.map((r) => (
        <li
          key={r.contract_id}
          data-testid="signing-task-row"
          className="border-b border-rule-soft last:border-b-0"
        >
          <Link
            to="/contracts/c/$id"
            params={{ id: r.contract_id }}
            className="flex min-w-0 items-center gap-3 px-5 py-3 max-sm:px-4"
          >
            <Tag tone="act">{t("contracts.waiting.signTag")}</Tag>
            <b className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">
              {signTitle(r) || t("contracts.overview.approvals.untitled")}
            </b>
            <span className="tnum shrink-0 text-[12.5px] text-dim">
              {t("contracts.waiting.since", { date: viDate(r.since) })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
