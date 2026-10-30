// CR-104 · ops-ui · thẻ một check: huy hiệu trạng thái (màu + chữ), nhãn, thông điệp, giá trị, lúc kiểm/đổi, gợi ý sửa (chép được khi có lệnh).
import type { OpsCheckKey, OpsCheckRow, OpsStatus } from "@ai/contracts/hub-admin";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { extractCommand, formatValue } from "../lib/ops";

export const TONE: Record<OpsStatus, StatusTone> = {
  ok: "ok",
  warn: "warn",
  crit: "err",
  unknown: "off",
};

export const when = (iso: string): string => new Date(iso).toLocaleString();

type Props = { checkKey: OpsCheckKey; row: OpsCheckRow | undefined; enabled: boolean };

function Hint({ hint }: { hint: string }) {
  const { t } = useTranslation();
  const cmd = extractCommand(hint);
  const copy = async () => {
    if (cmd && (await copyText(cmd))) notifySuccess(t("system.copied"));
    else notifyError(t("system.copyFailed"));
  };
  return (
    <div className="rounded-md bg-muted p-2 text-sm">
      <p className="whitespace-pre-wrap">
        <span className="font-medium">{t("system.hint")}:</span> {hint}
      </p>
      {cmd ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="mt-2"
          onClick={() => void copy()}
        >
          <Copy aria-hidden /> {t("system.copyCmd")}
        </Button>
      ) : null}
    </div>
  );
}

function Body({ checkKey, row }: { checkKey: OpsCheckKey; row: OpsCheckRow | undefined }) {
  const { t } = useTranslation();
  if (!row) return <p className="text-body">{t("system.noData")}</p>;
  const value = formatValue(row.value);
  return (
    <>
      <p className="text-body">{row.message}</p>
      {value ? (
        <p className="break-words font-mono text-xs text-muted-foreground">{value}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {t("system.checkedAt")}:{" "}
        <time data-testid={`checked-at-${checkKey}`} dateTime={row.checked_at}>
          {when(row.checked_at)}
        </time>
        {" · "}
        {t("system.changedAt")}: <time dateTime={row.changed_at}>{when(row.changed_at)}</time>
      </p>
      {row.hint && row.status !== "ok" ? <Hint hint={row.hint} /> : null}
    </>
  );
}

export function CheckCard({ checkKey, row, enabled }: Props) {
  const { t } = useTranslation();
  const label = t(`system.check.${checkKey}`);
  const status: OpsStatus = row?.status ?? "unknown";
  return (
    <article
      data-testid={`check-${checkKey}`}
      data-status={enabled ? status : "disabled"}
      aria-label={label}
      className={`flex flex-col gap-2 rounded-lg border bg-card p-4 ${enabled ? "" : "opacity-60"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{label}</h3>
        <StatusBadge tone={enabled ? TONE[status] : "off"}>
          {enabled ? t(`system.status.${status}`) : t("system.disabled")}
        </StatusBadge>
      </div>
      {enabled ? <Body checkKey={checkKey} row={row} /> : null}
    </article>
  );
}
