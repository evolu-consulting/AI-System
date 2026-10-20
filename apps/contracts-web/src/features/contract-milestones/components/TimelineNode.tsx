// V2-F · HD-04 · mockup `.tl2 li`: một nút của dòng thời gian — chấm trạng thái, tên + nhãn (Mình / đối tác, Lỗi, Bước hiện tại), dòng phụ
// (xong đúng hạn/sớm/trễ, hạn + quá hạn/còn n ngày, SL, số tiền), nút "Xác nhận xong" ở bước hiện tại, bút sửa ở mốc chưa xác nhận.
import type { Milestone } from "@ai/contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import { cn } from "~/lib/utils";
import { type MilestoneState, metaOf, type TimelineNode as Node } from "../lib/timeline";

/** Đường dọc nối các chấm (mockup `li::before`): nút đầu bắt đầu ở chấm, nút cuối dừng ở chấm. */
const LINE =
  "before:absolute before:content-[''] before:top-0 before:bottom-0 before:left-[8px] before:w-0.5 before:bg-rule first:before:top-[18px] last:before:bottom-[calc(100%-18px)]";
const DOT_BASE = "relative z-[1] mt-0.5 size-[18px] rounded-full border-2";
const DOT: Record<MilestoneState | "start" | "end", string> = {
  done: "border-ok bg-ok",
  late: "border-soon bg-soon",
  cur: "border-act bg-panel shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-act)_25%,transparent)]",
  over: "border-late bg-late-bg",
  up: "border-dashed border-field bg-panel",
  start: "border-ok bg-ok",
  end: "border-dashed border-field bg-panel",
};

function EdgeNode({ node }: { node: Extract<Node, { type: "start" | "end" }> }) {
  const { t } = useTranslation();
  const dot = node.past && node.type === "start" ? DOT.start : DOT.end;
  return (
    <li
      className={cn("relative grid grid-cols-[18px_1fr] gap-3 py-2.5", LINE)}
      data-node={node.type}
    >
      <span className={cn(DOT_BASE, dot)} />
      <div>
        <b className="text-[14px] font-medium text-ink-2">
          {t(`contracts.cdetail.${node.type === "start" ? "signed" : "expires"}`)}
        </b>
        <div className="text-[12.5px] text-dim">{node.date ? viDate(node.date) : "—"}</div>
      </div>
    </li>
  );
}

function EditButton({ title, onEdit }: { title: string; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      title={t("contracts.cdetail.editMilestone")}
      aria-label={t("contracts.cdetail.editAria", { title })}
      className="grid size-8 place-items-center rounded-lg text-dim hover:bg-sunk"
      onClick={onEdit}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 20h4L19 9l-4-4L4 16z" />
        <path d="M14 6l4 4" />
      </svg>
    </button>
  );
}

type Props = {
  node: Extract<Node, { type: "milestone" }>;
  partner: string;
  write: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  box: ReactNode;
  amountText: string | null;
};

function Tags({ m, state, partner }: { m: Milestone; state: MilestoneState; partner: string }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <b className={cn("text-[14px]", state === "up" ? "font-medium text-ink-2" : "font-semibold")}>
        {m.title}
      </b>
      <Tag tone={m.owner === "ours" ? "grey" : "act"}>
        {m.owner === "ours" ? L("ownerOurs") : partner}
      </Tag>
      {m.fault && <Tag tone="late">{L("faultTag", { who: L(`fault.${m.fault}`) })}</Tag>}
      {state === "cur" && <Tag tone="soon">{L("currentStep")}</Tag>}
    </div>
  );
}

function Meta({
  m,
  state,
  days,
  extra,
}: {
  m: Milestone;
  state: MilestoneState;
  days: number;
  extra: string;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  const meta = metaOf(state, days);
  const date = viDate(meta.key.startsWith("done") ? m.done_at : m.due_date);
  return (
    <div className="text-[12.5px] text-dim">
      {meta.key === "dueOver" ? (
        <>
          {L("dueOverLead", { date })} ·{" "}
          <b className="text-late">{L("overdueDays", { n: meta.n })}</b>
        </>
      ) : (
        L(meta.key, { date, n: meta.n })
      )}
      {extra}
    </div>
  );
}

export function MilestoneNode({
  node,
  partner,
  write,
  confirming,
  onConfirm,
  onEdit,
  box,
  amountText,
}: Props) {
  const { t } = useTranslation();
  const { m, state, days } = node;
  const extra = [m.qty != null ? t("contracts.cdetail.qtyOf", { n: m.qty }) : null, amountText]
    .filter(Boolean)
    .join(" · ");
  const editable = write && !m.confirmed && !confirming;
  return (
    <li
      data-node="milestone"
      data-state={state}
      className={cn(
        "relative grid grid-cols-[18px_1fr_auto] gap-3 py-2.5 max-sm:grid-cols-[18px_1fr]",
        LINE,
        state === "cur" && "-mx-5 bg-act-soft px-5 py-3 before:left-7",
      )}
    >
      <span className={cn(DOT_BASE, DOT[state])} />
      <div className="min-w-0">
        <Tags m={m} state={state} partner={partner} />
        <Meta m={m} state={state} days={days} extra={extra ? ` · ${extra}` : ""} />
        {box}
      </div>
      {editable && (
        <div className="flex items-center gap-1.5 max-sm:col-start-2">
          {state === "cur" && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onConfirm}>
              {t("contracts.cdetail.confirmDone")}
            </button>
          )}
          <EditButton title={m.title} onEdit={onEdit} />
        </div>
      )}
    </li>
  );
}

export const TimelineEdge = EdgeNode;
