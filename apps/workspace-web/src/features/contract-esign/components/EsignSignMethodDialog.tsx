// CR-125 · m4 · MOD-FR-11 · người ký chọn cách ký lúc bấm "Ký ngay": các cách công ty đã bật (DocuSign, Ký thử, MISA…). Chỉ mở khi có > 1
// cách khả dụng (một cách ⇒ ký thẳng, không hỏi). Chọn sẵn cách của phong bì đã gửi.
import type { ESignProviderOut } from "@ai/contracts/pack-contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { availableProviders, pickDefaultProvider } from "../lib/esign-view";

export function EsignSignMethodDialog({
  open,
  providers,
  current,
  busy,
  onClose,
  onSign,
}: {
  open: boolean;
  providers: ESignProviderOut[];
  /** Cách của phong bì đã gửi (chọn sẵn). */
  current: string | null;
  busy: boolean;
  onClose: () => void;
  onSign: (provider: string) => void;
}) {
  const { t } = useTranslation();
  const [key, setKey] = useState(() => pickDefaultProvider(providers, current));
  useEffect(() => {
    if (open) setKey(pickDefaultProvider(providers, current));
  }, [open, providers, current]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="esign-method-dialog">
        <DialogHeader>
          <DialogTitle>{t("contracts.esign.signMethodTitle")}</DialogTitle>
        </DialogHeader>
        <div role="radiogroup" className="flex flex-col gap-2">
          {availableProviders(providers).map((p) => (
            <label
              key={p.key}
              className="flex items-center gap-2 rounded-lg border border-rule px-3 py-2 text-[13.5px]"
            >
              <input
                type="radio"
                name="esign-method"
                data-testid={`esign-method-${p.key}`}
                checked={key === p.key}
                onChange={() => setKey(p.key)}
              />
              <b>{p.label}</b>
              {!p.legal && <span className="text-soon">{t("contracts.esign.notLegal")}</span>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t("contracts.esign.close")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="esign-method-confirm"
            disabled={busy || key === ""}
            onClick={() => onSign(key)}
          >
            {t("contracts.esign.signNow")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
