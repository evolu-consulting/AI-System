// cf-esign-docusign · hộp "Gửi ký": người ký công ty = chính tài khoản đang đăng nhập (chỉ đọc), đối tác sửa được; ký tuần tự.
// esign-multi · dropdown nhà cung cấp (chỉ khi > 1 khả dụng); gửi `provider` khi chọn.
import type { ESignProviderOut, ESignSignerIn } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { useEsignPlacement } from "../anchor-api";
import { availableProviders, pickDefaultProvider, showProviderPicker } from "../lib/esign-view";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Row = { role: "company" | "partner"; name: string; email: string };

function ProviderPick({
  providers,
  value,
  onChange,
}: {
  providers: ESignProviderOut[];
  value: string;
  onChange: (k: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <b>{t("contracts.esign.provider")}</b>
      <select
        className="field"
        data-testid="esign-provider-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {availableProviders(providers).map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
            {p.legal ? "" : ` – ${t("contracts.esign.notLegal")}`}
          </option>
        ))}
      </select>
    </label>
  );
}

const PLACEMENT_KEY = { text: "inText", page: "lastPage", unknown: "unknown" } as const;

/** esign-anchor · "Vị trí ký: trong văn bản / trang ký cuối / chưa xác định" (xem trước của server; lỗi ⇒ không hiện). */
function PlacementNote({ id, open }: { id: string | undefined; open: boolean }) {
  const { t } = useTranslation();
  const q = useEsignPlacement(id, open);
  if (!q.data) return null;
  return (
    <p className="text-[12.5px] text-dim" data-testid="esign-placement">
      {t("contracts.esignAnchor.placement")}:{" "}
      <b>{t(`contracts.esignAnchor.${PLACEMENT_KEY[q.data.placement]}`)}</b>
    </p>
  );
}

export function EsignSendDialog({
  contractId,
  open,
  defaults,
  providers,
  defaultProvider,
  busy,
  err,
  onClose,
  onSend,
}: {
  /** esign-anchor · HĐ (xem trước vị trí ký); vắng ⇒ không hiện. */
  contractId?: string;
  open: boolean;
  defaults: Row[];
  providers: ESignProviderOut[];
  defaultProvider: string | null;
  busy: boolean;
  err: string | null;
  onClose: () => void;
  onSend: (s: ESignSignerIn[], provider?: string) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>(defaults);
  const [prov, setProv] = useState(() => pickDefaultProvider(providers, defaultProvider));
  useEffect(() => {
    if (open) {
      setRows(defaults);
      setProv(pickDefaultProvider(providers, defaultProvider));
    }
  }, [open, defaults, providers, defaultProvider]);
  const ok = rows.every(
    (r) => r.role === "company" || (r.name.trim() !== "" && EMAIL.test(r.email.trim())),
  );
  const set = (i: number, k: "name" | "email", v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const picker = showProviderPicker(providers);
  const cur = providers.find((p) => p.key === prov);
  const send = () =>
    onSend(
      rows.map((r) =>
        r.role === "company"
          ? { role: "company" as const }
          : { role: "partner" as const, name: r.name.trim(), email: r.email.trim() },
      ),
      picker ? prov : undefined,
    );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("contracts.esign.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("contracts.esign.dialogHint")}</DialogDescription>
        </DialogHeader>
        {picker && <ProviderPick providers={providers} value={prov} onChange={setProv} />}
        <PlacementNote id={contractId} open={open} />

        {cur && !cur.legal && (
          <p className="text-[12.5px] text-soon" data-testid="esign-dialog-demo">
            {t("contracts.esign.demo")}
          </p>
        )}
        <ol className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li
              key={r.role}
              className="flex flex-col gap-1 text-[13px]"
              data-testid={`esign-signer-${i}`}
            >
              <b>
                {i + 1}.{" "}
                {t(
                  r.role === "company"
                    ? "contracts.esign.roleCompany"
                    : "contracts.esign.rolePartner",
                )}
              </b>
              {r.role === "company" ? (
                <span data-testid="esign-company-readonly">
                  {r.name} &lt;{r.email}&gt;
                </span>
              ) : (
                <div className="flex gap-2 max-sm:flex-col">
                  <input
                    className="field flex-1"
                    aria-label={`${t("contracts.esign.name")} ${i + 1}`}
                    value={r.name}
                    maxLength={100}
                    onChange={(e) => set(i, "name", e.target.value)}
                  />
                  <input
                    className="field flex-1"
                    type="email"
                    aria-label={`${t("contracts.esign.email")} ${i + 1}`}
                    value={r.email}
                    maxLength={200}
                    onChange={(e) => set(i, "email", e.target.value)}
                  />
                </div>
              )}
            </li>
          ))}
        </ol>
        {err && (
          <p role="alert" className="text-sm text-late">
            {err}
          </p>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t("contracts.esign.close")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="esign-send-confirm"
            disabled={busy || !ok}
            onClick={send}
          >
            {busy ? t("contracts.esign.sending") : t("contracts.esign.send")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
