// ADM-FR-08 · M4-R16 · ms §10.1 bước 3: 10 mã dự phòng (chỉ hiện một lần) · tải .txt · sao chép · tick → Hoàn tất.
import { Copy, Download, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { copyText } from "@/lib/clipboard";
import { saveBlob } from "@/lib/download";
import { backupFileName, backupFileText } from "../../lib/totp-steps";

type Props = { codes: string[]; tenant: string; username: string; onDone: () => void };

export function BackupCodesStep({ codes, tenant, username, onDone }: Props) {
  const { t } = useTranslation();
  const [ack, setAck] = useState(false);
  const ackId = useId();
  const text = () => backupFileText(t("twofa.backup.fileHeading", { tenant, username }), codes);

  const download = () => {
    saveBlob(
      new Blob([text()], { type: "text/plain;charset=utf-8" }),
      backupFileName(tenant, username),
    );
  };
  const copy = async () => {
    if (await copyText(codes.join("\n"))) notifySuccess(t("common.copied"));
    else notifyError(t("toast.saveFailed", { reason: t("common.copy") }));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-card-title font-semibold">{t("twofa.backup.title")}</h2>
      <ul
        aria-label={t("twofa.backup.list")}
        className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-border bg-muted p-4 font-mono text-body"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download aria-hidden />
          {t("twofa.backup.download")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          <Copy aria-hidden />
          {t("common.copy")}
        </Button>
      </div>
      <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-body">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-solid" />
        {t("twofa.backup.warn")}
      </p>
      <div className="flex items-center gap-2">
        <Checkbox id={ackId} checked={ack} onCheckedChange={(v) => setAck(v === true)} />
        <Label htmlFor={ackId}>{t("twofa.backup.ack")}</Label>
      </div>
      <div className="flex justify-end">
        <Button type="button" disabled={!ack} onClick={onDone}>
          {t("twofa.backup.done")}
        </Button>
      </div>
    </div>
  );
}
