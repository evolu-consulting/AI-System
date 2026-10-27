// CR-101 DOC-ui-frame · R44 · R47: "Diễn biến" của HĐ nguyên tắc — chứng từ con xen mốc theo ngày (tên, nhãn, ngày, giá trị, giai đoạn).
// Mốc của HĐ NT chỉ Nhắc gia hạn + Khác (hộp thêm/sửa mốc lọc loại). Mốc chưa xác nhận sửa được bằng bút.
import type { ContractDetail, Milestone } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import { dealOf } from "~/features/contract-form/lib/deal";
import { MilestoneDialog } from "~/features/contract-milestones/components/MilestoneDialog";
import { useRefreshContract } from "~/features/contract-milestones/hooks/use-milestone-writes";
import { saveErrorText } from "~/features/contract-review/lib/save-error";
import { docErrorKey, FRAME_KINDS, mergeDiary } from "../lib/frame-view";

const frameOrSaveError = (e: unknown, t: (k: string) => string): string => {
  const k = e instanceof ApiError ? docErrorKey(e.code as string) : null;
  return k ? t(k) : saveErrorText(e, t);
};

export function FrameDiary({
  c,
  partner,
  write,
  today,
}: {
  c: ContractDetail;
  partner: string;
  write: boolean;
  today: string;
}) {
  const { t } = useTranslation();
  const refresh = useRefreshContract(c.id);
  const [dialog, setDialog] = useState<{ edit: Milestone | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const L = (k: string) => t(`contracts.docframe.${k}`);
  const nodes = mergeDiary(c.milestones, c.doc?.children ?? []);
  const canEdit = write && !c.locked;
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{L("diary")}</h2>
        {canEdit && (
          <button
            type="button"
            className="btn btn-outline btn-sm ml-auto"
            data-testid="frame-add-milestone"
            onClick={() => setDialog({ edit: null })}
          >
            {t("contracts.cdetail.addMilestoneBtn")}
          </button>
        )}
      </div>
      {err && (
        <p role="alert" className="px-5 pt-2 text-sm text-late">
          {err}
        </p>
      )}
      <ol className="m-0 list-none px-5 py-3" data-testid="frame-diary">
        {nodes.length === 0 && <li className="text-sm text-dim">{L("diaryEmpty")}</li>}
        {nodes.map((n) =>
          n.type === "child" ? (
            <li
              key={n.child.id}
              className="flex items-baseline gap-3 py-2 text-sm"
              data-node="child"
            >
              <span className="w-24 shrink-0 text-dim">{n.date ? viDate(n.date) : "—"}</span>
              <Link
                to="/contracts/$id"
                params={{ id: n.child.id }}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {n.child.title}
              </Link>
              <Tag tone={n.child.doc_type === "deal" ? "soon" : "act"}>
                {L(`type.${n.child.doc_type}`)}
              </Tag>
              {n.child.outside_frame && <Tag tone="late">{L("outside")}</Tag>}
              <span className="font-mono">{vnd(n.child.value)}</span>
              <span className="text-dim">
                {t(`contracts.gape.status.${n.child.status}`, n.child.status)}
              </span>
            </li>
          ) : (
            <li
              key={n.m.id}
              className="flex items-baseline gap-3 py-2 text-sm"
              data-node="milestone"
            >
              <span className="w-24 shrink-0 text-dim">{viDate(n.date)}</span>
              <span className="min-w-0 flex-1 truncate">{n.m.title}</span>
              <Tag tone="grey">{t(`contracts.cdetail.kind.${n.m.kind}`)}</Tag>
              {n.m.confirmed && <Tag tone="ok">{L("milestoneDone")}</Tag>}
              {canEdit && !n.m.confirmed && (
                <button
                  type="button"
                  className="text-[12.5px] text-act hover:underline"
                  onClick={() => setDialog({ edit: n.m })}
                >
                  {t("contracts.cdetail.editMilestone")}
                </button>
              )}
            </li>
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
          kinds={FRAME_KINDS}
          onClose={() => setDialog(null)}
          onError={(e) => setErr(frameOrSaveError(e, t))}
          onSaved={() => {
            setDialog(null);
            setErr(null);
            void refresh();
          }}
        />
      )}
    </Panel>
  );
}
