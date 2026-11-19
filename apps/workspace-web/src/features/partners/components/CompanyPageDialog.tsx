// CR-191 · BR-191-9 · «trang công ty»: ảnh bìa (mặc định dải màu chuyển), tên, MST, địa chỉ — KHÔNG có bài. «Mời kết nối» + lời nhắn
// chỉ hiện khi chưa kết nối và người xem được phép mời (cài đặt công ty).
import { CC_NOTE_MAX } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  errCodeOf,
  useCompanyPage,
  useConnectSettings,
  useConnectWrites,
} from "../hooks/use-connect";
import { connectErrKey, noteOf } from "../lib/connect";
import { ConnectStatusBadge } from "./ConnectStatusBadge";

export function CompanyPageDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const page = useCompanyPage(id);
  const settings = useConnectSettings();
  const { invite } = useConnectWrites();
  const [note, setNote] = useState("");
  const c = page.data;
  const canInvite = settings.data?.can_invite === true && c?.status === "none";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={c?.legal_name ?? t("contracts.connect.hub.page.open")}>
        <DialogHeader>
          <DialogTitle>{c?.legal_name ?? t("contracts.connect.hub.page.open")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {page.error && (
            <p role="alert" className="text-[13px] text-late">
              {t("contracts.connect.hub.page.gone")}
            </p>
          )}
          {c && (
            <div data-testid="company-page" className="grid gap-3">
              <div
                data-testid="company-cover"
                role="img"
                aria-label={c.legal_name}
                className="h-28 rounded-lg bg-gradient-to-r from-indigo-400 to-teal-400 bg-cover bg-center"
                style={c.cover ? { backgroundImage: `url(${c.cover})` } : undefined}
              />
              <div className="grid gap-1 text-[13px] text-dim">
                <span>
                  {t("contracts.connect.tax", { tax: c.tax_code })} ·{" "}
                  {c.verified ? t("contracts.connect.verified") : t("contracts.connect.unverified")}
                </span>
                <span>
                  {t("contracts.connect.hub.page.address")}:{" "}
                  {c.address || t("contracts.connect.hub.page.noAddress")}
                </span>
                <span>
                  <ConnectStatusBadge status={c.status} />
                </span>
              </div>
              {canInvite && (
                <div className="grid gap-2">
                  <Input
                    value={note}
                    maxLength={CC_NOTE_MAX}
                    placeholder={t("contracts.connect.send.note")}
                    aria-label={t("contracts.connect.send.note")}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <Btn
                    variant="primary"
                    loading={invite.isPending}
                    onClick={() =>
                      invite.mutate(
                        { tenant_id: c.tenant_id, note: noteOf(note) },
                        {
                          onSuccess: () => {
                            toast(t("contracts.connect.send.done", { name: c.legal_name }));
                            onClose();
                          },
                          onError: (e) =>
                            toast(
                              t(`contracts.connect.err.${connectErrKey(errCodeOf(e))}`),
                              "late",
                            ),
                        },
                      )
                    }
                  >
                    {t("contracts.connect.hub.page.invite")}
                  </Btn>
                </div>
              )}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
