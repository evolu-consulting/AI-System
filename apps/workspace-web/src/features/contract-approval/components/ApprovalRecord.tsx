// CR-127 · U4 · M6 + M15 · hai khối gập trên thẻ duyệt: «Hồ sơ duyệt» (ai duyệt gì, ý kiến, chữ ký, tệp — theo quyền xem, BR-26) và
// «Đã đổi so với lần trước» (lý do trả lại + trường/đoạn văn đã đổi khi gửi lại). Chỉ tải khi mở (không thêm yêu cầu lúc vào trang).
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { approvalKey, fetchApproval } from "../api";
import {
  changesKey,
  downloadRecordPdf,
  fetchApprovalRecord,
  fetchChangesSinceLast,
  recordKey,
} from "../api-record";
import { hasChanges, recordLines, waitingOf } from "../lib/record-view";
import { EvidenceDialog } from "./EvidenceDialog";

function Fold({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: (open: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      data-testid={testId}
      className="mb-4 rounded-xl border border-line p-4"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-semibold">{title}</summary>
      <div className="mt-2">{open ? children(open) : null}</div>
    </details>
  );
}

export function ApprovalRecord({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <Fold title={t("contracts.work.u4.record.title")} testId="approval-record">
      {() => <RecordBody id={id} />}
    </Fold>
  );
}

function PdfButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(false);
    try {
      await downloadRecordPdf(id);
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-3">
      <button
        type="button"
        className="btn btn-sm"
        data-testid="record-pdf"
        disabled={busy}
        onClick={() => void run()}
      >
        {t("contracts.work.u4.record.pdf")}
      </button>
      {err && (
        <span role="alert" className="text-caption text-late" data-testid="record-pdf-error">
          {t("contracts.work.u4.record.pdfError")}
        </span>
      )}
    </div>
  );
}

export function RecordBody({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: recordKey(id),
    queryFn: ({ signal }) => fetchApprovalRecord(id, signal),
    retry: false,
  });
  // Tên bước (thẻ duyệt, chung khoá với trang chi tiết): hồ sơ chỉ lưu MÃ bước.
  const card = useQuery({
    queryKey: approvalKey(id),
    queryFn: ({ signal }) => fetchApproval(id, signal),
    retry: false,
    staleTime: 30_000,
  });
  if (q.isPending) return <p className="text-sm text-dim">{t("contracts.common.loading")}</p>;
  if (q.isError || !q.data)
    return (
      <p role="alert" className="text-sm text-late">
        {t("contracts.work.u4.record.loadError")}
      </p>
    );
  const lines = recordLines(q.data, card.data?.steps);
  if (lines.length === 0) {
    const w = waitingOf(card.data?.steps);
    const k = !w ? "empty" : w.who ? "waitingWho" : "waiting";
    return (
      <p className="text-sm text-dim" data-testid="record-empty">
        {t(`contracts.work.u4.record.${k}`, { step: w?.step, who: w?.who })}
      </p>
    );
  }
  return (
    <>
      <PdfButton id={id} />
      <ol className="m-0 list-none p-0">
        {lines.map((l) => (
          <li
            key={l.key}
            className="border-b border-rule-soft py-2 text-sm last:border-b-0"
            data-testid="record-line"
          >
            <b>{l.stage ?? t("contracts.work.u4.record.stageFallback")}</b> · {l.who}
            {l.onBehalf ? ` (${t("contracts.work.u4.record.behalf", { who: l.onBehalf })})` : ""}
            {l.override ? ` (${t("contracts.work.u4.record.override")})` : ""} ·{" "}
            {t(`contracts.work.u4.record.action.${l.action}`)} ·{" "}
            <span className="text-dim">{new Date(l.at).toLocaleString("vi-VN")}</span>
            {l.note && <p className="m-0 mt-1 text-dim">“{l.note}”</p>}
            {l.hasEvidence && !l.readable && (
              <p className="m-0 mt-1 text-caption text-dim" data-testid="record-hidden">
                {t("contracts.work.u4.record.hidden")}
              </p>
            )}
            {l.evidenceId && l.files.length > 0 && (
              <p className="m-0 mt-1 text-caption">
                <EvidenceDialog contractId={id} line={l} />
              </p>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

/** M15 · chỉ hiện khi HĐ đã gửi lại ít nhất một lần (`round ≥ 1`). */
export function ChangesSinceLast({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <Fold title={t("contracts.work.u4.changes.title")} testId="changes-since-last">
      {() => <ChangesBody id={id} />}
    </Fold>
  );
}

const show = (v: unknown): string =>
  v === null || v === undefined || v === ""
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v)
      : String(v);

function ChangesBody({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: changesKey(id),
    queryFn: ({ signal }) => fetchChangesSinceLast(id, signal),
    retry: false,
  });
  if (q.isPending) return <p className="text-sm text-dim">{t("contracts.common.loading")}</p>;
  if (q.isError || !q.data)
    return (
      <p role="alert" className="text-sm text-late">
        {t("contracts.work.u4.changes.loadError")}
      </p>
    );
  const c = q.data;
  if (!hasChanges(c))
    return <p className="text-sm text-dim">{t("contracts.work.u4.changes.none")}</p>;
  return (
    <div className="text-sm">
      {c.return_note && (
        <p className="mt-0" data-testid="changes-return-note">
          {t("contracts.work.u4.changes.returnNote", { n: c.previous_round ?? 1 })} “{c.return_note}
          ”
        </p>
      )}
      {c.fields.length > 0 && (
        <table className="mb-3 w-full text-left">
          <thead>
            <tr className="text-caption text-dim">
              <th>{t("contracts.work.u4.changes.field")}</th>
              <th>{t("contracts.work.u4.changes.before")}</th>
              <th>{t("contracts.work.u4.changes.after")}</th>
            </tr>
          </thead>
          <tbody>
            {c.fields.map((f) => (
              <tr key={f.key} className="border-t border-rule-soft">
                <td>{f.key}</td>
                <td>{show(f.before)}</td>
                <td className="font-semibold">{show(f.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {c.clauses.length > 0 && (
        <p className="m-0 text-dim" data-testid="changes-clauses">
          {t("contracts.work.u4.changes.clauses", { n: c.clauses.length })}
        </p>
      )}
    </div>
  );
}
