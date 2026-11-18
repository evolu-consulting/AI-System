// CR-182 · khối trạng thái link ký của đối tác ở trang HĐ: đã gửi lúc, đã mở lúc, hạn, đã ký / từ chối (+ lý do); «Gửi lại link».
import type { PartnerLinkStatusOut } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { MetaList } from "@ai/web-kit/ui/kit/meta-list";
import { toast } from "@ai/web-kit/ui/toast";
import { useTranslation } from "react-i18next";
import { useResendPartnerLink } from "../../hooks/use-contract-sign";
import { canCopyLink, canShowResend, linkLines } from "../../lib/partner-link-view";

export function PartnerLinkInfo({
  id,
  link,
  allowResend,
}: {
  id: string;
  link: PartnerLinkStatusOut;
  allowResend: boolean;
}) {
  const { t, i18n } = useTranslation();
  const resend = useResendPartnerLink(id);
  const send = () =>
    resend.mutate(undefined, {
      onSuccess: (r) =>
        r.sent
          ? toast(t("contracts.psign.link.resent", { name: link.contact_name ?? "" }))
          : toast(t("contracts.psign.link.noMail"), "late"),
      onError: () => toast(t("contracts.psign.link.resendFail"), "late"),
    });
  // «Sao chép link»: tạo link mới (cũ bị thu hồi) để lấy được link gốc — DB chỉ giữ băm.
  const copy = () =>
    resend.mutate(undefined, {
      onSuccess: async (r) => {
        if (r.sent || !r.url)
          return toast(t("contracts.psign.link.resent", { name: link.contact_name ?? "" }));
        try {
          await navigator.clipboard.writeText(r.url);
          toast(t("contracts.psign.link.copied"));
        } catch {
          toast(t("contracts.psign.link.copyFail"), "late");
        }
      },
      onError: () => toast(t("contracts.psign.link.resendFail"), "late"),
    });
  return (
    <div data-testid="partner-link" data-state={link.state} className="mt-2 flex flex-col gap-2">
      <p className="m-0 text-sm font-medium">{t(`contracts.psign.link.state.${link.state}`)}</p>
      <MetaList
        items={linkLines(link, i18n.language).map((x) => ({
          label: t(`contracts.psign.link.${x.key}`),
          value: x.value ?? t("contracts.psign.link.notOpened"),
        }))}
      />
      {link.state === "declined" && link.decline_reason && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("contracts.psign.link.reason", { reason: link.decline_reason })}
        </p>
      )}
      {canCopyLink(link) && (
        <p data-testid="partner-link-not-sent" className="m-0 text-sm text-muted-foreground">
          {t("contracts.psign.link.notSent")}
        </p>
      )}
      {allowResend && canCopyLink(link) && (
        <Button
          className="self-start"
          size="sm"
          busy={resend.isPending}
          onClick={copy}
          data-testid="partner-link-copy"
        >
          {t("contracts.psign.link.copy")}
        </Button>
      )}
      {allowResend && canShowResend(link) && (
        <Button
          className="self-start"
          variant="outline"
          size="sm"
          busy={resend.isPending}
          onClick={send}
        >
          {t("contracts.psign.link.resend")}
        </Button>
      )}
    </div>
  );
}
