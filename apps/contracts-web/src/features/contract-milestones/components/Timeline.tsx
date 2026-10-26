// V2-F · HD-04/HD-11 · mockup `timelineV2`: khối "Dòng thời gian" — tiến độ n/m mốc, các nút Ký HĐ → mốc → Hết hiệu lực, bước hiện tại được
// đánh dấu + nút "Xác nhận xong", bút sửa trên mốc CHƯA xác nhận, "+ Thêm mốc". Viewer (không quyền ghi) chỉ xem.
import type { ContractDetail, Milestone } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import { dealOf, STAGE_TONE } from "~/features/contract-form/lib/deal";
import { saveErrorText } from "~/features/contract-review/lib/save-error";
import { useRefreshContract } from "../hooks/use-milestone-writes";
import { buildTimeline, currentOverdue, progressOf } from "../lib/timeline";
import { ConfirmBox } from "./ConfirmBox";
import { MilestoneDialog } from "./MilestoneDialog";
import { MilestoneNode, TimelineEdge } from "./TimelineNode";

type C = Pick<
  ContractDetail,
  | "id"
  | "deal"
  | "direction"
  | "start_date"
  | "end_date"
  | "milestones"
  | "next_milestone_id"
  | "stage"
>;

function Progress({ c }: { c: C }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  const prog = progressOf(c.milestones);
  const cur = c.milestones.find((m) => m.id === c.next_milestone_id);
  const now =
    c.stage === "in_progress" && cur
      ? L("nowAt", { step: cur.title })
      : L(c.stage === "done" ? "allDone" : "notStarted");
  return (
    <div className="px-5 pt-3.5 pb-1">
      <div className="flex justify-between text-[13px]">
        <span data-testid="stage-now">{now}</span>
        <span className="text-dim tabular-nums">
          {L("progressCount", { done: prog.done, total: prog.total })}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunk">
        <span className="block h-full bg-act" style={{ width: `${prog.pct}%` }} />
      </div>
    </div>
  );
}

export function Timeline({
  c,
  partner,
  write,
  locked = false,
  today,
}: {
  c: C;
  /** Tên ngắn của đối tác (nhãn mốc của đối tác). */
  partner: string;
  write: boolean;
  /** lock-strict: HĐ đã khoá ⇒ không thêm / sửa mốc (còn "Xác nhận xong"). */
  locked?: boolean;
  today: string;
}) {
  const { t } = useTranslation();
  const refreshContract = useRefreshContract(c.id);
  const L = (k: string) => t(`contracts.cdetail.${k}`);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ edit: Milestone | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const over = currentOverdue(c, today);
  const refresh = async () => {
    setErr(null);
    await refreshContract();
  };
  const fail = (e: unknown) => setErr(saveErrorText(e, t));
  const box = (m: Milestone) =>
    confirming === m.id ? (
      <ConfirmBox
        m={m}
        today={today}
        partner={partner}
        deal={dealOf(c)}
        editable={!locked}
        onCancel={() => setConfirming(null)}
        onError={fail}
        onDone={() => {
          setConfirming(null);
          void refresh();
        }}
      />
    ) : null;
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{L("timeline")}</h2>
        <Tag tone={over ? "late" : STAGE_TONE[c.stage]}>
          {over ? L("stageOver") : L(`stage.${c.stage}`)}
        </Tag>
        {write && !locked && (
          <button
            type="button"
            className="btn btn-outline btn-sm ml-auto"
            onClick={() => setDialog({ edit: null })}
          >
            {L("addMilestoneBtn")}
          </button>
        )}
      </div>
      <Progress c={c} />
      {err && (
        <p role="alert" className="px-5 pt-2 text-sm text-late">
          {err}
        </p>
      )}
      <ol className="m-0 list-none px-5 pt-2.5 pb-3.5">
        {buildTimeline(c, today).map((n, i) =>
          n.type === "milestone" ? (
            <MilestoneNode
              key={n.m.id}
              node={n}
              partner={partner}
              write={write}
              locked={locked}
              confirming={confirming === n.m.id}
              onConfirm={() => setConfirming(n.m.id)}
              onEdit={() => setDialog({ edit: n.m })}
              box={box(n.m)}
              amountText={n.m.amount_effective != null ? vnd(n.m.amount_effective) : null}
            />
          ) : (
            <TimelineEdge key={n.type + String(i)} node={n} />
          ),
        )}
      </ol>
      {dialog && (
        <MilestoneDialog
          contractId={c.id}
          deal={dealOf(c)}
          partner={partner}
          edit={dialog.edit}
          today={today}
          onClose={() => setDialog(null)}
          onError={fail}
          onSaved={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
    </Panel>
  );
}
