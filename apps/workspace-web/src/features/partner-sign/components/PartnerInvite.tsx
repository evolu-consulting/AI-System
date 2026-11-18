// CR-182 · trang mời ký: ai mời, ký gì, bao nhiêu tệp / chỗ ký, hạn; «Xem và ký» + «Từ chối ký».
import type { PartnerSignViewOut } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { MetaList } from "@ai/web-kit/ui/kit/meta-list";
import { useTranslation } from "react-i18next";
import { filesToSign, fmtDate, openFieldCount } from "../lib/partner-map";
import { StatusCard } from "./PartnerShell";

export function PartnerInvite(p: {
  view: PartnerSignViewOut;
  onSign: () => void;
  onDecline: () => void;
}) {
  const { t, i18n } = useTranslation();
  const v = p.view;
  return (
    <StatusCard
      testId="partner-invite"
      title={t("contracts.psign.invite.title", {
        company: v.company_name,
        contract: v.contract_title,
      })}
    >
      <p className="m-0 text-md">{t("contracts.psign.invite.hello", { name: v.contact_name })}</p>
      <MetaList
        items={[
          { label: t("contracts.psign.invite.files"), value: String(filesToSign(v.files).length) },
          { label: t("contracts.psign.invite.fields"), value: String(openFieldCount(v.files)) },
          { label: t("contracts.psign.invite.due"), value: fmtDate(v.expires_at, i18n.language) },
        ]}
      />
      <p className="m-0 text-sm text-muted-foreground">{t("contracts.psign.invite.hint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={p.onSign}>{t("contracts.psign.invite.sign")}</Button>
        <Button variant="quiet" onClick={p.onDecline}>
          {t("contracts.psign.invite.decline")}
        </Button>
      </div>
    </StatusCard>
  );
}
