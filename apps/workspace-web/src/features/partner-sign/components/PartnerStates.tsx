// CR-182 · các trạng thái không ký được / đã xong của trang đối tác: đã ký, đã từ chối, hết hạn/thu hồi, sai link, quá nhiều lần, lỗi.
import type { PartnerSignViewOut } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { useTranslation } from "react-i18next";
import { fmtDateTime } from "../lib/partner-map";
import { StatusCard } from "./PartnerShell";

export function SignedState({
  view,
  signedUrl,
}: {
  view: PartnerSignViewOut;
  signedUrl: (fileId: string, versionId: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const Eye = ICONS.preview;
  const Down = ICONS.download;
  return (
    <StatusCard
      testId="partner-signed"
      title={t("contracts.psign.signed.title")}
      body={t("contracts.psign.signed.body")}
    >
      {view.signed_at && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("contracts.psign.signed.at", { at: fmtDateTime(view.signed_at, i18n.language) })}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {view.files
          .filter((f) => f.latest_version_id)
          .map((f) => {
            const url = signedUrl(f.file_id, f.latest_version_id ?? "");
            return (
              <li key={f.file_id} className="flex flex-col gap-2">
                <span className="text-sm font-medium">{f.name}</span>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={t("contracts.psign.signed.viewFile", { name: f.name })}
                    >
                      <Eye aria-hidden="true" className="size-4" />
                      {t("contracts.psign.signed.view")}
                    </a>
                  </Button>
                  <Button asChild variant="quiet">
                    <a
                      href={url}
                      download={f.name}
                      aria-label={t("contracts.psign.signed.downloadFile", { name: f.name })}
                    >
                      <Down aria-hidden="true" className="size-4" />
                      {t("contracts.psign.signed.download")}
                    </a>
                  </Button>
                </div>
              </li>
            );
          })}
      </ul>
    </StatusCard>
  );
}

export function DeclinedState({ view }: { view: PartnerSignViewOut }) {
  const { t } = useTranslation();
  return (
    <StatusCard
      testId="partner-declined"
      title={t("contracts.psign.declined.title")}
      body={t("contracts.psign.declined.body", { company: view.company_name })}
    >
      {view.decline_reason && (
        <p className="m-0 text-sm text-muted-foreground">
          {t("contracts.psign.declined.reason", { reason: view.decline_reason })}
        </p>
      )}
    </StatusCard>
  );
}

/** Hết hạn / thu hồi / sai link / quá nhiều lần / lỗi mạng: một câu rõ ràng + việc cần làm. */
export function ProblemState({
  kind,
  onRetry,
}: {
  kind: "gone" | "notfound" | "limit" | "error";
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <StatusCard
      testId={`partner-${kind}`}
      tone="bad"
      title={t(`contracts.psign.${kind}.title`)}
      body={t(`contracts.psign.${kind}.body`)}
    >
      {(kind === "error" || kind === "limit") && (
        <Button className="self-start" onClick={onRetry}>
          {t("contracts.psign.error.retry")}
        </Button>
      )}
    </StatusCard>
  );
}
