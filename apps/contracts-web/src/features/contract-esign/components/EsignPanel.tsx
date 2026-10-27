// cf-esign-docusign · khối "Ký số" ở chi tiết HĐ (trung lập nhà cung cấp): Gửi ký (owner/editor) ⇒ "Đang chờ ký" (Ký ngay cho người ký
// nội bộ, Làm mới trạng thái, Huỷ) ⇒ "Đã ký số" + thời điểm + tải "Bản đã ký"; từ chối/huỷ ⇒ lý do + Gửi lại. Ký thử ⇒ nhãn rõ.
import type { ESignEnvelopeOut } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEsign } from "../hooks/use-esign";
import { type EsignView, esignView, hintKey, statusKey } from "../lib/esign-view";
import { EsignSendDialog } from "./EsignSendDialog";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN") : "");

function DemoTag() {
  const { t } = useTranslation();
  return (
    <span
      data-testid="esign-demo"
      className="rounded-full border border-soon-line bg-soon-bg px-2 py-0.5 text-[12px] text-soon"
    >
      {t("contracts.esign.demo")}
    </span>
  );
}

function CancelBox({ busy, onCancel }: { busy: boolean; onCancel: (r: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button
        type="button"
        className="text-[12.5px] font-medium text-act hover:underline"
        onClick={() => setOpen(true)}
      >
        {t("contracts.esign.cancel")}
      </button>
    );
  return (
    <span className="flex items-center gap-2">
      <input
        className="field h-8"
        aria-label={t("contracts.esign.cancelReason")}
        value={reason}
        maxLength={200}
        onChange={(e) => setReason(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        disabled={busy || reason.trim() === ""}
        onClick={() => onCancel(reason.trim())}
      >
        {t("contracts.esign.cancel")}
      </button>
    </span>
  );
}

type Es = ReturnType<typeof useEsign>;
const BTN = "btn btn-sm";

function Actions({
  v,
  es,
  resend,
  onSend,
}: {
  v: EsignView;
  es: Es;
  resend: boolean;
  onSend: () => void;
}) {
  const { t } = useTranslation();
  const b = (show: boolean, label: string, fn: () => unknown, cls = "btn-quiet") =>
    show && (
      <button
        type="button"
        className={`${BTN} ${cls}`}
        disabled={es.busy}
        onClick={() => void fn()}
      >
        {t(label)}
      </button>
    );
  return (
    <>
      {b(v.canSignNow, "contracts.esign.signNow", es.signNow, "btn-primary")}
      {b(v.canRefresh, "contracts.esign.refresh", es.refresh)}
      {b(v.canDownload, "contracts.esign.download", es.download, "btn-primary")}
      {v.canSend && (
        <button
          type="button"
          className={`${BTN} btn-primary`}
          data-testid="esign-send"
          onClick={onSend}
        >
          {t(resend ? "contracts.esign.resend" : "contracts.esign.send")}
        </button>
      )}
      {v.canCancel && <CancelBox busy={es.busy} onCancel={(r) => void es.cancel(r)} />}
    </>
  );
}

function Signers({ e }: { e: ESignEnvelopeOut }) {
  const { t } = useTranslation();
  return (
    <ol className="mt-2 flex flex-col gap-0.5 text-[13px] text-dim">
      {e.signers.map((x) => (
        <li key={x.order}>
          {x.order}. {x.name} &lt;{x.email}&gt;
          {x.signed_at ? ` — ${t("contracts.esign.signerDone")}` : ""}
        </li>
      ))}
    </ol>
  );
}

export function EsignPanel({ id, locked, write }: { id: string; locked: boolean; write: boolean }) {
  const { t } = useTranslation();
  const es = useEsign(id);
  const [open, setOpen] = useState(false);
  const s = es.q.data;
  const v = esignView(s, { locked, write });
  if (v.mode === "hidden" || !s) return null;
  const e = s.envelope;
  const sk = statusKey(v, e?.status);
  const hk = hintKey(v);
  const failed = e !== null && (e.status === "declined" || e.status === "voided");
  return (
    <section
      data-testid="esign-panel"
      className="mb-3 rounded-xl border border-rule bg-sunk px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        <b>{t("contracts.esign.title")}</b>
        {sk && (
          <span data-testid="esign-status">{t(sk, { at: fmt(e?.completed_at ?? null) })}</span>
        )}
        {hk && (
          <span className="text-dim" data-testid="esign-hint">
            {t(hk)}
          </span>
        )}
        {e?.provider_label && (
          <span className="text-dim" data-testid="esign-provider">
            {e.provider_label}
          </span>
        )}
        {v.demo && <DemoTag />}
        <span className="flex-1" />
        <Actions
          v={v}
          es={es}
          resend={e !== null}
          onSend={() => {
            es.clearErr();
            setOpen(true);
          }}
        />
      </div>
      {failed && e?.reason && (
        <p className="mt-1 text-dim">{t("contracts.esign.reason", { reason: e.reason })}</p>
      )}
      {e && !failed && <Signers e={e} />}
      {es.err && !open && (
        <p role="alert" className="mt-1 text-sm text-late">
          {es.err}
        </p>
      )}
      <EsignSendDialog
        contractId={id}
        open={open}
        defaults={s.defaults}
        providers={s.providers ?? []}
        defaultProvider={s.default_provider ?? null}
        busy={es.busy}
        err={es.err}
        onClose={() => setOpen(false)}
        onSend={(rows, p) => void es.send(rows, p).then((ok) => ok && setOpen(false))}
      />
    </section>
  );
}
