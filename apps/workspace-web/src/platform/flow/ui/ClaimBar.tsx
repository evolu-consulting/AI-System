// CR-127 · U4 · BR-27…34 · dải nhận việc của MỘT việc nhóm: «Chưa ai nhận» + [Nhận việc] / «{X} đang xử lý» / [Trả về nhóm] / x/n khi
// «Cần tất cả» / «Thay {A}» khi làm thay người uỷ quyền. Lý do khoá nút quyết nói rõ ở đây (không thao tác ẩn).
import { ApiError } from "@ai/web-kit/http";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyFlowNavChanged } from "~/shared/kernel/flow-nav-event";
import { claimTask, reassignTask, releaseTask } from "../adapters/claim";
import { type ClaimInfo, claimView, cr127ErrorKey, whoOf } from "../lib/claim";
import { type Person, ReassignBox } from "./ReassignBox";

export function ClaimBar({
  taskId,
  info,
  onChanged,
  people,
}: {
  taskId: string;
  info: ClaimInfo;
  /** Sau khi nhận/trả: tải lại view của trang. */
  onChanged: () => void;
  /** U4b-1 · có danh sách người ⇒ hiện «Chuyển cho…» (trưởng phòng / quản trị; máy chủ quyết quyền). */
  people?: readonly Person[] | undefined;
}) {
  const { t } = useTranslation();
  const v = claimView(info);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [handing, setHanding] = useState(false);
  if (!v.claimable && !v.votesText && !v.onBehalfOf) return null;
  const run = async (f: (id: string) => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await f(taskId);
      setHanding(false);
    } catch (e) {
      const code = e instanceof ApiError ? (e.code as string) : undefined;
      const key = cr127ErrorKey(code);
      setErr(
        key
          ? t(key, { who: whoOf((e as ApiError).details, t("contracts.work.u4.someone")) })
          : t("contracts.errors.unknown"),
      );
    } finally {
      setBusy(false);
      notifyFlowNavChanged(); // U4b-4 · nhận/trả/chuyển việc đổi số «Việc của tôi»
      onChanged();
    }
  };
  return (
    <div
      data-testid="claim-bar"
      data-claim={v.state}
      className="mb-2 flex flex-wrap items-center gap-2 text-sm"
    >
      {v.state === "unclaimed" && (
        <>
          <span className="text-dim" data-testid="claim-state">
            {t("contracts.work.u4.claim.unclaimed")}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="claim-take"
            disabled={busy}
            onClick={() => void run(claimTask)}
          >
            {t("contracts.work.u4.claim.take")}
          </button>
        </>
      )}
      {v.state === "other" && (
        <span className="text-dim" data-testid="claim-state">
          {t("contracts.work.u4.claim.other", { who: v.holder ?? t("contracts.work.u4.someone") })}
        </span>
      )}
      {v.state === "mine" && (
        <>
          <span className="text-ok" data-testid="claim-state">
            {t("contracts.work.u4.claim.mine")}
          </span>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            data-testid="claim-release"
            disabled={busy}
            onClick={() => void run(releaseTask)}
          >
            {t("contracts.work.u4.claim.release")}
          </button>
        </>
      )}
      {v.canReassign && people && people.length > 0 && !handing && (
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          data-testid="reassign-open"
          disabled={busy}
          onClick={() => setHanding(true)}
        >
          {t("contracts.work.u4.reassign.open")}
        </button>
      )}
      {handing && people && (
        <ReassignBox
          people={people}
          busy={busy}
          onCancel={() => setHanding(false)}
          onSend={(to, note) => void run((id) => reassignTask(id, { to_user_id: to, note }))}
        />
      )}
      {v.votesText && (
        <span data-testid="claim-votes" className="font-medium">
          {t("contracts.work.u4.claim.votes", { n: v.votesText })}
        </span>
      )}
      {v.onBehalfOf && (
        <span
          data-testid="claim-behalf"
          className="rounded bg-act-soft px-2 py-0.5 text-caption text-act"
        >
          {t("contracts.work.u4.claim.behalf", { who: v.onBehalfOf })}
        </span>
      )}
      {err && (
        <p role="alert" className="w-full text-late" data-testid="claim-error">
          {err}
        </p>
      )}
    </div>
  );
}
