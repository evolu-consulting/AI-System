// V2-N · "Hạn và nhắc việc" (trước là "Cần xử lý" — đổi tên để không mâu thuẫn với thẻ "Chờ bạn": HĐ chờ chính mình ký/duyệt nằm ở thẻ đó) của Tổng quan (mockup NITI `todoPanel`): 8 nguồn từ `GET /my-work/todo`, 6 việc đầu + "Xem thêm", mỗi việc có Bỏ qua
// (và Đã xong với "Liên hệ mời gia hạn"). Bấm việc ⇒ mở HĐ / SP / đối tác. Chỉ việc người dùng THẤY (API tự lọc).

import type { TodoItem } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { Tag, type TagTone } from "~/components/shared/tag";
import { useDismissTodo, useTodo } from "../hooks/use-overview";
import { todoCanDone, todoTarget, todoWhen, WORK_PREVIEW } from "../lib/overview";
import { BlockHead } from "./BlockHead";

const TONE: Record<TodoItem["kind"], TagTone> = {
  overdue: "late",
  due_soon: "soon",
  contract_expiring: "soon",
  customers_expiring: "soon",
  renewal_contact: "act",
  commission: "soon",
  rating: "act",
  rating_quarter: "act",
  missing_file: "grey",
  market_price: "act",
  legal: "act",
  verify_fault: "soon", // MS-impact · Câu 11
};

function Body({ i }: { i: TodoItem }) {
  const { t } = useTranslation();
  const w = todoWhen(i);
  const title = i.title ?? t(`contracts.overview.todo.kind.${i.kind}`);
  return (
    <>
      <Tag tone={TONE[i.kind]}>{t(`contracts.overview.todo.kind.${i.kind}`)}</Tag>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14.5px] font-semibold">{title}</b>
        {i.sub && <span className="block truncate text-[12.5px] text-dim">{i.sub}</span>}
      </span>
      {w && (
        <span
          className={`tnum shrink-0 text-[12.5px] ${w.key === "late" ? "font-semibold text-late" : "text-dim"}`}
        >
          {t(`contracts.overview.todo.when.${w.key}`, { n: w.n })}
        </span>
      )}
    </>
  );
}

function Target({ i }: { i: TodoItem }) {
  const to = todoTarget(i);
  const cls = "flex min-w-0 flex-1 items-center gap-3 text-left max-sm:min-h-11";
  const body = <Body i={i} />;
  if (to?.to === "/contracts/c/$id")
    return (
      <Link to="/contracts/c/$id" params={{ id: to.id }} className={cls}>
        {body}
      </Link>
    );
  if (to?.to === "/contracts/products")
    return (
      <Link
        to="/contracts/products"
        search={{ sp: to.sp, ...(to.ht ? { ht: to.ht } : {}) }}
        className={cls}
      >
        {body}
      </Link>
    );
  if (to?.to === "/contracts/partners")
    return (
      <Link to="/contracts/partners" search={to.party ? { party: to.party } : {}} className={cls}>
        {body}
      </Link>
    );
  return <div className={cls}>{body}</div>;
}
function Row({ i, onAct }: { i: TodoItem; onAct: (a: "skip" | "done") => void }) {
  const { t } = useTranslation();
  const done = todoCanDone(i);
  return (
    <li
      data-testid="todo-row"
      data-kind={i.kind}
      className="flex items-center gap-2 border-b border-rule-soft px-5 py-3 last:border-b-0 max-sm:px-4"
    >
      <Target i={i} />
      {
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="quiet"
              size="icon"
              className="size-7 shrink-0 border-0 bg-transparent"
              onClick={() => onAct(done ? "done" : "skip")}
              aria-label={t(
                done ? "contracts.overview.todo.doneAria" : "contracts.overview.todo.skipAria",
              )}
            >
              {done ? <ICONS.approve className="size-3.5" /> : <ICONS.close className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t(done ? "contracts.overview.todo.done" : "contracts.overview.todo.skip")}
          </TooltipContent>
        </Tooltip>
      }
    </li>
  );
}

export function TodoBlock() {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const q = useTodo();
  const m = useDismissTodo();
  const items = q.data?.items ?? [];
  const shown = all ? items : items.slice(0, WORK_PREVIEW);
  const rest = items.length - WORK_PREVIEW;
  const late = q.data?.counts.overdue ?? 0;
  const body = () => {
    if (q.isLoading) return <Loading />;
    if (q.error) return <ErrorLine error={q.error} />;
    if (!items.length) return <Empty title={t("contracts.overview.work.empty")} />;
    return (
      <>
        <ul>
          {shown.map((i) => (
            <Row key={i.key} i={i} onAct={(action) => m.mutate({ key: i.key, action })} />
          ))}
        </ul>
        {rest > 0 && (
          <Button
            variant="link"
            aria-expanded={all}
            onClick={() => setAll(!all)}
            className="h-auto px-0 mx-5 my-3"
          >
            {all
              ? t("contracts.overview.work.less")
              : t("contracts.overview.work.more", { n: rest })}
          </Button>
        )}
      </>
    );
  };
  return (
    <Panel>
      <BlockHead
        title={t("contracts.overview.work.title")}
        meta={
          q.data && (
            <>
              {t("contracts.overview.work.count", { n: items.length })}
              {late > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-late">
                    {t("contracts.overview.work.late", { n: late })}
                  </span>
                </>
              )}
            </>
          )
        }
      />
      {body()}
      {q.data?.truncated && (
        <p role="status" className="px-5 pb-3 text-[13px] text-dim">
          {t("contracts.work.truncated")}
        </p>
      )}
    </Panel>
  );
}
