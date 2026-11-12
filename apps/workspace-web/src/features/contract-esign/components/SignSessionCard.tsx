// CR-127 · U6 · M2d: «Ký cùng lúc» trên chi tiết HĐ của MỖI bên — bên nhận trả lời Đồng ý / Xử lý bình thường / Từ chối; phiên ký chung hiện hai dòng ký
// (tên công ty + người ký), «Huỷ phiên ký» cần lý do; ghi rõ chưa có giá trị pháp lý. Không có phiên ⇒ không vẽ gì.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { endedReason, type SignRow, sessionView } from "../lib/sign-session-view";
import {
  cancelSignSession,
  fetchSignSession,
  respondSignSession,
  signSessionKey,
} from "../sign-session-api";

function Row({ r }: { r: SignRow }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-2" data-testid="cosign-row">
      <span aria-hidden="true">{r.signedAt ? "✓" : "●"}</span>
      <b>{r.company ?? "—"}</b>
      <span className="text-dim">· {r.signer ?? "—"}</span>
      <span className="ml-auto text-dim">
        {r.signedAt
          ? t("contracts.u6.cosign.signedAt", { at: viDate(r.signedAt) })
          : t("contracts.u6.cosign.waiting")}
      </span>
    </li>
  );
}

export function SignSessionCard({ id, write }: { id: string; write: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: signSessionKey(id),
    queryFn: ({ signal }) => fetchSignSession(id, signal),
    retry: false,
  });
  const [signer, setSigner] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const done = () => qc.invalidateQueries();
  const fail = () => setErr(t("contracts.u6.cosign.fail"));
  const respond = useMutation({
    mutationFn: (b: Parameters<typeof respondSignSession>[1]) => respondSignSession(id, b),
    onSuccess: done,
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: () => cancelSignSession(id, reason.trim()),
    onSuccess: done,
    onError: fail,
  });
  if (!q.data?.session) return null;
  const { session: s, signers } = q.data;
  const v = sessionView(s, write);
  const ended = endedReason(s);
  const btn = "btn btn-sm btn-quiet";
  return (
    <section
      data-testid="sign-session"
      data-phase={v.phase}
      className="mb-3 flex flex-col gap-2 rounded-xl border border-line px-4 py-3 text-sm"
    >
      <b>{t("contracts.u6.cosign.title")}</b>
      <p>
        {t(`contracts.u6.cosign.phase.${v.phase}`)}
        {v.deadline ? ` · ${t("contracts.u6.cosign.until", { at: viDate(v.deadline) })}` : ""}
      </p>
      {s.reason && (
        <p className="text-dim">{t("contracts.u6.cosign.reason", { reason: s.reason })}</p>
      )}
      {ended && <p className="text-dim">{ended}</p>}
      {v.rows && (
        <ul className="flex flex-col gap-1">
          {v.rows.map((r, i) => (
            <Row key={i === 0 ? "from" : "to"} r={r} />
          ))}
        </ul>
      )}
      <p className="text-[12.5px] text-dim">{t("contracts.u6.cosign.noLegal")}</p>
      {v.canRespond && (
        <div className="flex flex-wrap items-center gap-2" data-testid="cosign-respond">
          <select
            className="field"
            aria-label={t("contracts.u6.cosign.signer")}
            value={signer}
            onChange={(e) => setSigner(e.target.value)}
          >
            <option value="">{t("contracts.u6.cosign.pickSigner")}</option>
            {signers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!signer || respond.isPending}
            onClick={() => respond.mutate({ choice: "accept", signer_user_id: signer })}
          >
            {t("contracts.u6.cosign.accept")}
          </button>
          <button
            type="button"
            className={btn}
            disabled={respond.isPending}
            onClick={() => respond.mutate({ choice: "normal" })}
          >
            {t("contracts.u6.cosign.normal")}
          </button>
          <button
            type="button"
            className={btn}
            disabled={respond.isPending}
            onClick={() => respond.mutate({ choice: "decline" })}
          >
            {t("contracts.u6.cosign.decline")}
          </button>
        </div>
      )}
      {v.canCancel && (
        <div className="flex flex-wrap items-center gap-2" data-testid="cosign-cancel">
          <input
            className="field min-w-60 flex-1"
            placeholder={t("contracts.u6.cosign.cancelReason")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button"
            className={btn}
            disabled={!reason.trim() || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {t("contracts.u6.cosign.cancel")}
          </button>
        </div>
      )}
      {err && (
        <p role="alert" className="text-late">
          {err}
        </p>
      )}
    </section>
  );
}
