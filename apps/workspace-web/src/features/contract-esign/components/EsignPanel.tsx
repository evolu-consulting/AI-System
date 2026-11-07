// cf-esign-docusign · khối "Ký số" ở chi tiết HĐ (trung lập nhà cung cấp): Gửi ký (owner/editor) ⇒ "Đang chờ ký" (Ký ngay cho người ký
// nội bộ, Làm mới trạng thái, Huỷ) ⇒ "Đã ký số" + thời điểm + tải "Bản đã ký"; từ chối/huỷ ⇒ lý do + Gửi lại. Ký thử ⇒ nhãn rõ.
import type {
  ESignEnvelopeOut,
  ESignProviderOut,
  ESignStateOut,
} from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useEsign } from "../hooks/use-esign";
import {
  type EsignView,
  esignView,
  hintKey,
  showProviderPicker,
  statusKey,
} from "../lib/esign-view";
import { EsignSendDialog } from "./EsignSendDialog";
import { EsignSignMethodDialog } from "./EsignSignMethodDialog";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN") : "");
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("vi-VN");

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

/** CR-125 · x2 · "Huỷ ký" nằm trong menu "…" và luôn qua hộp xác nhận (cần lý do). */
function CancelMenu({ busy, onCancel }: { busy: boolean; onCancel: (r: string) => void }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <span className="relative">
      <button
        type="button"
        className={`${BTN} btn-quiet`}
        aria-label={t("contracts.esign.more")}
        aria-expanded={menu}
        data-testid="esign-menu"
        onClick={() => setMenu((o) => !o)}
      >
        …
      </button>
      {menu && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 min-w-[140px] rounded-lg border border-rule bg-surface p-1 shadow"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="esign-cancel"
            className="w-full rounded px-3 py-1.5 text-left text-[13px] hover:bg-sunk"
            onClick={() => {
              setMenu(false);
              setAsk(true);
            }}
          >
            {t("contracts.esign.cancel")}
          </button>
        </div>
      )}
      <Dialog open={ask} onOpenChange={setAsk}>
        <DialogContent data-testid="esign-cancel-dialog">
          <DialogHeader>
            <DialogTitle>{t("contracts.esign.cancelTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-[13.5px] text-dim">{t("contracts.esign.cancelWarn")}</p>
          <input
            className="field h-9"
            aria-label={t("contracts.esign.cancelReason")}
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter>
            <button type="button" className="btn btn-quiet" onClick={() => setAsk(false)}>
              {t("contracts.esign.close")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="esign-cancel-confirm"
              disabled={busy || reason.trim() === ""}
              onClick={() => {
                onCancel(reason.trim());
                setAsk(false);
              }}
            >
              {t("contracts.esign.cancel")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  onSignNow,
}: {
  v: EsignView;
  es: Es;
  resend: boolean;
  onSend: () => void;
  onSignNow: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {v.canSignNow && (
        <button
          type="button"
          className={`${BTN} btn-primary`}
          disabled={es.busy}
          data-testid="esign-sign-now"
          onClick={onSignNow}
        >
          {t("contracts.esign.signNow")}
        </button>
      )}
      {v.canDownload && (
        <button
          type="button"
          className={`${BTN} btn-primary`}
          disabled={es.busy}
          onClick={() => void es.download()}
        >
          {t("contracts.esign.download")}
        </button>
      )}
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
      {v.canCancel && <CancelMenu busy={es.busy} onCancel={(r) => void es.cancel(r)} />}
    </>
  );
}
function Signers({ e }: { e: ESignEnvelopeOut }) {
  const { t } = useTranslation();
  return (
    <ol className="mt-2 flex flex-col gap-0.5 text-[13px] text-dim">
      {e.signers.map((x) => (
        <li key={x.order}>
          {x.order}. {x.name}
          {x.signed_at ? ` — ${t("contracts.esign.signerDone")}` : ""}
        </li>
      ))}
    </ol>
  );
}

function MethodDialog(p: {
  s: ESignStateOut;
  e: ESignEnvelopeOut | null;
  es: Es;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <EsignSignMethodDialog
      open={p.open}
      providers={p.s.providers ?? []}
      current={p.e?.provider ?? p.s.default_provider ?? null}
      busy={p.es.busy}
      onClose={p.onClose}
      onSign={(k) => void p.es.signNow(k).then(p.onClose)}
    />
  );
}

/** «Ký ngay»: nhiều cách khả dụng ⇒ hộp chọn cách ký; một cách ⇒ ký thẳng (không hỏi). */
const signNowOf =
  (providers: ESignProviderOut[] | undefined, es: Es, ask: (o: boolean) => void) => () =>
    showProviderPicker(providers) ? ask(true) : void es.signNow();

/** Dòng trạng thái đầu thẻ: lượt người xem ⇒ banner "Đến lượt bạn ký — hạn …"; người khác ⇒ "Đang chờ <tên> ký"; còn lại theo trạng thái. */
function Headline({
  v,
  sk,
  completedAt,
}: {
  v: EsignView;
  sk: string | null;
  completedAt: string | null;
}) {
  const { t } = useTranslation();
  if (v.mode === "pending" && v.canSignNow)
    return (
      <b className="text-act" data-testid="esign-turn">
        {v.dueAt
          ? t("contracts.esign.yourTurn", { date: fmtDate(v.dueAt) })
          : t("contracts.esign.yourTurnNoDue")}
      </b>
    );
  if (!sk) return null;
  return (
    <span data-testid="esign-status">
      {v.mode === "pending" && v.waitingFor
        ? t("contracts.esign.waitingFor", { name: v.waitingFor })
        : t(sk, { at: fmt(completedAt) })}
    </span>
  );
}
export function EsignPanel({ id, locked, write }: { id: string; locked: boolean; write: boolean }) {
  const { t } = useTranslation();
  const es = useEsign(id);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState(false);
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
        <Headline v={v} sk={sk} completedAt={e?.completed_at ?? null} />
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
          onSignNow={() => (showProviderPicker(s.providers) ? setMethod(true) : void es.signNow())}
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
      <MethodDialog s={s} e={e} es={es} open={method} onClose={() => setMethod(false)} />
    </section>
  );
}
