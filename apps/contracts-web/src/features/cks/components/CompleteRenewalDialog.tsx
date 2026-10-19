// HD-FR-94 · S11 · "Hoàn tất gia hạn" — port `dialogs.tsx:40-63`: serial mới từng chữ ký (≥ 1 mới bật "Hoàn tất"), hạn mới tuỳ chọn.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Actions, Alert, type DialogRef, useSubmit } from "./dialog-kit";

type Cert = { id: string; label: string; serial: string | null };

export function CompleteRenewalDialog({
  dlg,
  certs,
  complete,
}: {
  dlg: DialogRef;
  certs: Cert[];
  complete: (serials: Record<string, string>, validTo: string | null) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cks.dialog.${k}`, o);
  const s = useSubmit(dlg, (f) =>
    complete(
      Object.fromEntries(certs.map((c) => [c.id, String(f.get(c.id) || "")]).filter(([, v]) => v)),
      String(f.get("valid") || "") || null,
    ),
  );
  const [filled, setFilled] = useState(false);
  return (
    <dialog ref={dlg} className="sheet">
      <form
        onSubmit={s.onSubmit}
        className="flex flex-col gap-3 p-5"
        onInput={(e) => {
          const f = new FormData(e.currentTarget);
          setFilled(certs.some((c) => String(f.get(c.id) || "").trim() !== ""));
        }}
      >
        <h2 className="text-lg font-semibold">{L("doneTitle")}</h2>
        <p className="-mt-1 text-[13px] text-dim">{L("doneLead")}</p>
        {certs.map((c) => (
          <label key={c.id} className="text-[13px]">
            {c.label} <span className="text-dim">{L("old", { serial: c.serial ?? "—" })}</span>
            <input name={c.id} className="field mt-1 font-mono" placeholder={L("newSerial")} />
          </label>
        ))}
        <label className="text-[13px]">
          {L("newExpiry")}
          <input name="valid" type="date" className="field mt-1" />
        </label>
        <Alert err={s.err} />
        <Actions dlg={dlg} busy={s.busy} label={L("done")} disabled={!filled} />
      </form>
    </dialog>
  );
}
