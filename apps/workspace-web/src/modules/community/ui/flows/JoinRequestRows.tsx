// CR-193 · BR-193-9 · «Yêu cầu tham gia» dạng dòng gọn cho thẻ «Yêu cầu chờ duyệt» (Sổ Hợp Tác › Đối tác). Chỉ các yêu cầu đang chờ; Đồng ý ⇒
// mở hộp chi tiết có bước chọn đối tác (JoinApprove, như cũ); Từ chối ⇒ hộp lý do (như cũ). Báo số yêu cầu chờ cho thẻ cha qua `onCount`.
import type { JoinRequest } from "@ai/contracts/community";
import { Badge } from "@ai/web-kit/ui/kit/badge";
import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useFlowEnv } from "../../application/flow-env";
import { shortDay } from "../../domain/admin-list";
import { isConflict } from "../../domain/flows";
import { approveErrorKey } from "../../domain/join-approve";
import { numLocale, t } from "../../i18n";
import { JoinApprove } from "./JoinApprove";
import { ReasonDialog, usePagedFlowList } from "./parts";

export function JoinRequestRows({
  budget,
  onCount,
}: {
  /** Số dòng được vẽ (phần còn lại thẻ cha gập vào «Xem thêm»). */
  budget: number;
  onCount: (n: number) => void;
}) {
  const { flows, toast, bump, brandAccent } = useFlowEnv();
  const list = usePagedFlowList((o) => flows.listJoins(true, o));
  const [sel, setSel] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<JoinRequest | null>(null);
  const pending = (list.items ?? []).filter((j) => j.status === "pending");
  useEffect(() => onCount(pending.length), [pending.length, onCount]);
  const row = pending.find((j) => j.id === sel) ?? null;
  const decide = async (
    j: JoinRequest,
    action: "approve" | "reject",
    fb?: string,
    party?: string,
  ) => {
    try {
      await flows.decideJoin(j.id, {
        action,
        taskId: j.taskId,
        ...(fb ? { feedback: fb } : {}),
        ...(party ? { partyKey: party } : {}),
      });
      toast(
        t(action === "approve" ? "community.flows.join.approved" : "community.flows.join.rejected"),
      );
      setSel(null);
      setRejecting(null);
      bump();
    } catch (e) {
      const why = approveErrorKey(e);
      if (why) return toast(t(why)); // vẫn ở hộp duyệt để chọn lại đối tác
      if (!isConflict(e)) throw e;
      toast(t("community.flows.join.conflict"));
      setSel(null);
      setRejecting(null);
      list.reload();
    }
  };
  return (
    <>
      <ul data-testid="join-list">
        {pending.slice(0, budget).map((j) => (
          <li
            key={j.id}
            data-testid="join-item"
            className="border-b border-rule-soft py-3 first:pt-0 last:border-0"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-md bg-panel text-dim">
                <ICONS.partner className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b className="truncate">{j.company}</b>
                  <Badge status="idle" icon={<ICONS.message className="size-3" />}>
                    {t("community.flows.join.kind")}
                  </Badge>
                  <span className="text-xs text-dim">{shortDay(j.createdAt, numLocale())}</span>
                </div>
                <p className="truncate rounded-md bg-panel px-2 py-1 text-xs text-dim">
                  {j.contact} · {j.email}
                  {j.reason ? ` · «${j.reason}»` : ""}
                </p>
              </div>
              <Button size="sm" variant="primary" onClick={() => setSel(j.id)}>
                {t("community.flows.join.accept")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setRejecting(j)}>
                {t("community.flows.join.reject")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={row !== null} onOpenChange={(o) => !o && setSel(null)}>
        {row && (
          <DialogContent aria-describedby={undefined} data-testid="join-list-detail">
            <div data-mod="community" data-accent={brandAccent}>
              <DialogHeader>
                <DialogTitle>{t("community.flows.join.detailTitle")}</DialogTitle>
              </DialogHeader>
              <div data-testid="join-detail">
                <div className="pbody">
                  <p>
                    <b>{row.company}</b>
                  </p>
                  <p className="muted">
                    {row.contact} · {row.email} · {shortDay(row.createdAt, numLocale())}
                  </p>
                  {row.reason && <p>{row.reason}</p>}
                </div>
                <JoinApprove
                  key={row.id}
                  j={row}
                  onApprove={(party) => void decide(row, "approve", undefined, party)}
                  onReject={() => {
                    setSel(null);
                    setRejecting(row);
                  }}
                />
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
      {rejecting && (
        <ReasonDialog
          testId="join-reject-dialog"
          title={t("community.flows.join.rejectTitle")}
          intro={t("community.flows.join.rejectIntro")}
          label={t("community.flows.join.reasonLabel")}
          required={false}
          submitLabel={t("community.flows.join.reject")}
          onClose={() => setRejecting(null)}
          onSubmit={(text) => decide(rejecting, "reject", text)}
        />
      )}
    </>
  );
}
