// ADM-FR-08 · ms §10.1 bước 1: QR (`qr_svg` server trả, D2) + khoá nhập tay nhóm 4 + tên tài khoản.
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { groupSecret, type TotpSetup } from "../../lib/totp-steps";

type Props = {
  setup: TotpSetup;
  tenant: string;
  username: string;
  onNext: () => void;
  onCancel: () => void;
};

export function ScanStep({ setup, tenant, username, onNext, onCancel }: Props) {
  const { t } = useTranslation();
  const copy = async () => {
    if (await copyText(setup.secret)) notifySuccess(t("common.copied"));
    else notifyError(t("toast.saveFailed", { reason: t("common.copy") }));
  };
  return (
    <div className="space-y-4">
      <h2 className="text-card-title font-semibold">{t("twofa.scan.title")}</h2>
      <img
        src={setup.qr_svg}
        alt={t("twofa.scan.alt")}
        width={200}
        height={200}
        className="size-[200px] rounded-md border border-border bg-background"
      />
      <div className="space-y-1.5">
        <p className="text-body text-muted-foreground">{t("twofa.scan.manual")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-muted px-2 py-1 font-mono text-body">
            {groupSecret(setup.secret)}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={copy}>
            <Copy aria-hidden />
            {t("common.copy")}
          </Button>
        </div>
      </div>
      <dl className="text-body">
        <dt className="text-muted-foreground">{t("twofa.account")}</dt>
        <dd className="font-mono">{t("twofa.accountName", { tenant, username })}</dd>
      </dl>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="button" onClick={onNext}>
          {t("common.continue")}
        </Button>
      </div>
    </div>
  );
}
