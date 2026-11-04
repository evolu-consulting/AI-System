// HD-FR-36 · S05 · D-02: nút duyệt trên tiêu đề ("Xác nhận" = mgmt-app `ContractPage.tsx:102-103`, cùng lớp `btn btn-primary`;
// "Duyệt"/"Từ chối"/"Đọc lại" là lệch có chủ ý — DEVIATIONS.md, `data-approval` để harness ẩn) + khối lý do + dòng trạng thái.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { PopMenu } from "~/components/shared/pop-menu";
import type { Busy } from "../hooks/use-approval";
import { type ApprovalView, feedbackOk, overflowOf } from "../lib/approval";

export function ApprovalButtons({
  v,
  busy,
  onConfirm,
  onApprove,
  onAsk,
}: {
  v: ApprovalView;
  busy: Busy;
  onConfirm: () => void;
  onApprove: () => void;
  onAsk: (kind: "reject" | "return") => void;
}) {
  const { t } = useTranslation();
  const off = busy !== null;
  // confirm-flow (người dùng 2026-10-23): nút "Đọc lại" (trích lại kèm lý do) ẩn; trích lại chỉ qua "AI đọc lại từ đầu".
  const more = overflowOf(v);
  return (
    <>
      {!v.confirm && v.reject && (
        <button
          type="button"
          data-approval="reject"
          className="btn btn-outline"
          disabled={off}
          onClick={() => onAsk("reject")}
        >
          {t("contracts.approval.reject")}
        </button>
      )}
      {v.confirm && (
        <button type="button" className="btn btn-primary" disabled={off} onClick={onConfirm}>
          {busy === "approve"
            ? t("contracts.approval.confirming")
            : t("contracts.approval.confirmSave")}
        </button>
      )}
      {more.length > 0 && (
        <PopMenu
          ariaLabel={t("contracts.approval.more")}
          triggerClass="btn btn-outline"
          disabled={off}
          trigger={<span aria-hidden="true">⋯</span>}
          items={more.map((k) => ({
            key: k,
            dataAttr: k,
            label: t(`contracts.approval.${k}`),
            onSelect: () => onAsk(k),
          }))}
        />
      )}
      {v.back && (
        <button
          type="button"
          data-approval="return"
          className="btn btn-outline"
          disabled={off}
          onClick={() => onAsk("return")}
        >
          {t("contracts.approval.return")}
        </button>
      )}
      {v.pass && (
        <button
          type="button"
          data-approval="pass"
          className="btn btn-primary"
          disabled={off}
          onClick={onApprove}
        >
          {busy === "approve" ? t("contracts.approval.approving") : t("contracts.approval.pass")}
        </button>
      )}
      {v.approve && (
        <button
          type="button"
          data-approval="approve"
          className="btn btn-primary"
          disabled={off}
          onClick={onApprove}
        >
          {busy === "approve" ? t("contracts.approval.approving") : t("contracts.approval.approve")}
        </button>
      )}
    </>
  );
}

const REASON_LABEL = {
  reject: "contracts.approval.rejectReason",
  redo: "contracts.approval.redoReason",
  return: "contracts.approval.returnReason",
} as const;
const SUBMIT_LABEL = {
  reject: "contracts.approval.reject",
  redo: "contracts.approval.redo",
  return: "contracts.approval.return",
} as const;

/** Hộp lý do cho "Từ chối" / "Trả lại" (bắt buộc). "Đọc lại" ẩn (confirm-flow) — giữ nhánh `redo` cho khi bật lại. */
export function ReasonForm({
  kind,
  busy,
  onSubmit,
  onCancel,
}: {
  kind: "reject" | "redo" | "return";
  busy: Busy;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const label = t(REASON_LABEL[kind]);
  return (
    <form
      data-approval="reason"
      className="mb-4 space-y-2 rounded-xl border border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!feedbackOk(text)) return setBad(true);
        onSubmit(text.trim());
      }}
    >
      <label className="block text-sm font-medium" htmlFor="approval-reason">
        {label}
      </label>
      <textarea
        id="approval-reason"
        className="w-full rounded-lg border border-line bg-transparent p-2 text-sm"
        rows={3}
        maxLength={4000}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
      />
      {bad && (
        <p role="alert" className="text-sm text-late">
          {t("contracts.approval.errors.reason")}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy !== null}>
          {t(SUBMIT_LABEL[kind])}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          {t("contracts.common.cancel")}
        </button>
      </div>
    </form>
  );
}

/** Dòng trạng thái: chờ bước người khác / đang xử lý / lý do Từ chối. */
export function ApprovalNote({ note, rejected }: { note: string | null; rejected: string | null }) {
  const { t } = useTranslation();
  if (rejected)
    return (
      <p data-approval="note" className="mb-3 text-sm text-late">
        {t("contracts.approval.rejectedWith", { reason: rejected })}
      </p>
    );
  if (!note) return null;
  return (
    <p data-approval="note" className="mb-3 text-sm text-muted">
      {t(note)}
    </p>
  );
}

/** Review m8 · kiểm soát chèn văn bản: ở cấp 1 hiện rõ giá trị AI đọc được + trích dẫn nguyên văn (và cờ đã sửa tay) để người
 *  xác nhận đối chiếu với tệp gốc trước khi "Xác nhận" (giá trị này quyết có cần cấp 2). */
export function ExtractedValue(p: { value: unknown; quote: string; edited: boolean }) {
  const { t } = useTranslation();
  const n = typeof p.value === "number" ? p.value : null;
  return (
    <p data-approval="extracted" className="mb-3 rounded-lg bg-act-soft px-3 py-2 text-sm text-act">
      {t("contracts.approval.extracted", { value: n === null ? "—" : vnd(n) })}
      {p.quote ? <span className="italic"> “{p.quote}”</span> : null}
      {p.edited ? <span> · {t("contracts.approval.editedByHand")}</span> : null}
    </p>
  );
}
