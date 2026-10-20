// W1 · nút hành động của một việc (như thẻ trợ lý mgmt-app): Đã trả / Đã thu / Khách hẹn lại (ngày), Xong / Nhắc lại sau (giờ),
// ghi kết quả xử lý HĐ + so sánh giá khi HĐ mua sắp đến hạn. Ghi sổ/HĐ cần quyền ghi; hẹn nhắc là của riêng mình nên người xem cũng đóng được.
import type { MyWorkItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { HANDLED_OUTCOMES, type Outcome } from "~/features/contract-deadline/lib/deadline";
import { useWorkActions } from "../hooks/use-work-actions";
import { defaultPostpone, defaultSnooze, postponeOk, snoozeOk, workErrorText } from "../lib/mywork";

type Pick = "postpone" | "snooze" | "remind" | null;

export function WorkActions({ i, today, write }: { i: MyWorkItem; today: string; write: boolean }) {
  const { t } = useTranslation();
  const [pick, setPick] = useState<Pick>(null);
  const [val, setVal] = useState("");
  const id = i.id.slice(i.id.indexOf(":") + 1);
  const act = useWorkActions(id, () => setPick(null));
  const run = act.run;
  const open = (p: Exclude<Pick, null>) => {
    setPick(p);
    setVal(p === "postpone" ? defaultPostpone(i, today) : defaultSnooze(today));
  };
  const valid = pick === "postpone" ? postponeOk(val, i) : snoozeOk(val);
  const btn = "btn btn-sm";
  const confirm = () => {
    if (pick === "postpone") return act.postpone(val);
    if (pick === "remind")
      return act.remind(i.kind === "obligation" ? "obligation" : "contract", val);
    return act.snooze(val);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
      {i.kind === "obligation" && write && (
        <>
          <button
            type="button"
            className={`${btn} btn-primary`}
            disabled={run.isPending}
            onClick={act.settle}
          >
            {t(
              i.direction === "receive" ? "contracts.work.act.received" : "contracts.work.act.paid",
            )}
          </button>
          {i.direction === "receive" && (
            <button type="button" className={`${btn} btn-outline`} onClick={() => open("postpone")}>
              {t("contracts.work.act.postpone")}
            </button>
          )}
        </>
      )}
      {i.kind === "followup" && (
        <>
          <button
            type="button"
            className={`${btn} btn-primary`}
            disabled={run.isPending}
            onClick={act.done}
          >
            {t("contracts.work.act.done")}
          </button>
          <button type="button" className={`${btn} btn-outline`} onClick={() => open("snooze")}>
            {t("contracts.work.act.snooze")}
          </button>
        </>
      )}
      {i.kind === "deadline" && write && (
        <select
          aria-label={t("contracts.deadline.record")}
          className="field h-9 w-48"
          defaultValue=""
          disabled={run.isPending}
          onChange={(e) => e.target.value && act.handled(e.target.value as Outcome)}
        >
          <option value="">{t("contracts.deadline.pick")}</option>
          {HANDLED_OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {t(`contracts.deadline.outcomes.${o}`)}
            </option>
          ))}
        </select>
      )}
      {(i.kind === "obligation" || i.kind === "deadline") && (
        <button type="button" className={`${btn} btn-quiet`} onClick={() => open("remind")}>
          {t("contracts.work.act.remind")}
        </button>
      )}
      {(i.kind === "deadline" || i.kind === "reminder") && i.contract_direction === "purchase" && (
        <Link to="/products" search={{ tab: "prices" }} className={`${btn} btn-quiet`}>
          {t("contracts.work.act.compare")}
        </Link>
      )}
      {pick && (
        <span className="flex flex-wrap items-center gap-2" data-testid="work-pick">
          <input
            type={pick === "postpone" ? "date" : "datetime-local"}
            aria-label={t(`contracts.work.pick.${pick}`)}
            className="field h-9 w-auto"
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
          <button
            type="button"
            className={`${btn} btn-primary`}
            disabled={!valid || run.isPending}
            onClick={confirm}
          >
            {t("contracts.common.confirm")}
          </button>
          <button type="button" className={`${btn} btn-quiet`} onClick={() => setPick(null)}>
            {t("contracts.common.cancel")}
          </button>
        </span>
      )}
      {run.isError && (
        <span role="alert" className="w-full text-[13px] text-late">
          {workErrorText(run.error, t)}
        </span>
      )}
    </div>
  );
}
