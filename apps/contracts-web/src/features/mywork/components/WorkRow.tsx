// W1 · một hàng "Việc của tôi": mức gấp, loại, tiêu đề (liên kết tới HĐ/khách), tiền, ghi chú + các nút hành động.
import type { MyWorkItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { cn } from "~/lib/utils";
import { atLabel, titleKey, whenOf } from "../lib/mywork";
import { WorkActions } from "./WorkActions";

const TONE = {
  late: "bg-late-bg text-late",
  soon: "bg-soon-bg text-soon",
  dim: "bg-sunk text-dim",
} as const;

function Title({ i }: { i: MyWorkItem }) {
  const { t } = useTranslation();
  const text = t(`contracts.work.title.${titleKey(i)}`, {
    party: i.party ?? t("contracts.work.partnerFallback"),
    name: i.title ?? "",
    customer: i.title ?? "",
    n: i.milestone ?? 0,
  });
  const cls = "font-medium text-act hover:underline";
  if (i.contract_id)
    return (
      <Link to="/contracts/$id" params={{ id: i.contract_id }} className={cls}>
        {text}
      </Link>
    );
  if (i.customer_id)
    return (
      <Link to="/cks/$id" params={{ id: i.customer_id }} className={cls}>
        {text}
      </Link>
    );
  return <span className="font-medium">{text}</span>;
}

export function WorkRow({ i, today, write }: { i: MyWorkItem; today: string; write: boolean }) {
  const { t } = useTranslation();
  const w = whenOf(i);
  return (
    <li
      data-testid="work-row"
      data-kind={i.kind}
      className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-rule-soft px-5 py-3.5 last:border-b-0 max-sm:px-4"
    >
      <span
        className={cn(
          "mt-0.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
          TONE[i.tone],
        )}
      >
        {t(`contracts.work.when.${w.key}`, { n: w.n })}
        {i.at && i.days <= 0 && w.key === "today" ? ` · ${atLabel(i.at).slice(0, 5)}` : ""}
      </span>
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-[14.5px]">
          <Title i={i} />
          {i.amount != null && (
            <span className="tnum ml-2 font-mono text-[13px]">{vnd(i.amount)} đ</span>
          )}
        </p>
        <p className="text-[12.5px] text-dim">
          {t(`contracts.work.kind.${i.kind}`)}
          {i.kind === "deadline" && i.title && i.party ? ` · ${i.party}` : ""}
          {i.at && i.kind === "followup" ? ` · ${atLabel(i.at)}` : ""}
          {i.note ? ` · ${i.note}` : ""}
        </p>
      </div>
      <WorkActions i={i} today={today} write={write} />
    </li>
  );
}
