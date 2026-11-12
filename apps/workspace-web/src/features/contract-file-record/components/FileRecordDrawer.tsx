// CR-135 · Q5 · ngăn bên phải «Hồ sơ» của MỘT file HĐ (file chính của một phiên bản, tệp gắn vào HĐ, tệp kèm bước duyệt): thông tin file ·
// duyệt (dùng lại «Hồ sơ duyệt» `RecordBody`) · ký số (phong bì ký của HĐ/phiên bản đó + tải bản đã ký) · tệp là bằng chứng của bước nào.
// Chỉ đọc dữ liệu đã có (chi tiết HĐ, hồ sơ duyệt, ký số) — ai không xem được HĐ thì các API sẵn có trả 404, ngăn nói rõ.
import type { ContractOwnFile, ContractStepFile } from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDateTime } from "~/components/shared/format";
import { TruncText } from "~/components/shared/TruncText";
import { Btn } from "~/components/ui/Btn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { RecordBody } from "~/features/contract-approval/components/ApprovalRecord";
import { useFileRecord } from "../hooks/use-file-record";
import { evidenceStepsOf, nameOf, signBlock } from "../lib/file-record";
import {
  EvidenceOf,
  FileInfo,
  type InfoRow,
  kindLabel,
  Section,
  SignInfo,
} from "./FileRecordSections";

/** `main` = file chính của HĐ/phiên bản `contractId`; `attachment` = tệp gắn vào HĐ; `step` = tệp kèm bước duyệt. */
export type FileRecordTarget =
  | { kind: "main"; contractId: string }
  | { kind: "attachment"; contractId: string; file: ContractOwnFile }
  | { kind: "step"; contractId: string; file: ContractStepFile };

const SIDE =
  "!top-0 !right-0 !left-auto h-full max-h-none w-full !translate-x-0 !translate-y-0 content-start overflow-y-auto rounded-none sm:max-w-[30rem]";

export function FileRecordDrawer({
  target,
  onClose,
}: {
  target: FileRecordTarget;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const r = useFileRecord(target.contractId);
  const [busy, setBusy] = useState(false);
  const [dlErr, setDlErr] = useState(false);
  const d = r.detail.data;
  const unknown = t("contracts.frec.unknown");
  const name = target.kind === "main" ? (d?.file?.name ?? "") : target.file.name;
  const rows = (): InfoRow[] => {
    if (!d) return [];
    const ver = {
      key: "version",
      value: `v${d.version_no}${d.versions_count > 1 ? ` / ${d.versions_count}` : ""}`,
    };
    if (target.kind === "main") {
      const f = d.file;
      return [
        { key: "name", value: <TruncText>{f?.name ?? unknown}</TruncText> },
        { key: "kind", value: f ? kindLabel(t, f.mime) : unknown },
        { key: "by", value: nameOf(r.members, d.created_by) ?? unknown },
        { key: "at", value: viDateTime(d.created_at) },
        ver,
      ];
    }
    const f = target.file;
    const by =
      "added_by" in f
        ? (nameOf(r.members, f.added_by) ?? unknown)
        : t(`contracts.cfiles.source.${f.source}`);
    return [
      { key: "name", value: <TruncText>{f.name}</TruncText> },
      { key: "kind", value: kindLabel(t, f.mime) },
      { key: "by", value: by },
      { key: "at", value: viDateTime(f.added_at) },
      ver,
    ];
  };
  const download = async () => {
    setBusy(true);
    setDlErr(false);
    try {
      await r.openSigned();
    } catch {
      setDlErr(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={SIDE} aria-describedby="frec-desc" data-testid="file-record">
        <DialogHeader>
          <DialogTitle>{t("contracts.frec.title")}</DialogTitle>
          <DialogDescription id="frec-desc" asChild>
            <div className="min-w-0 pr-6">
              <TruncText>{name || t("contracts.frec.subtitle")}</TruncText>
            </div>
          </DialogDescription>
        </DialogHeader>
        {r.detail.isError ? (
          <div role="alert" data-testid="frec-error" className="text-sm text-late">
            <p className="m-0">{t("contracts.frec.loadErr")}</p>
            <Btn
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => void r.detail.refetch()}
            >
              {t("contracts.cfiles.retry")}
            </Btn>
          </div>
        ) : !d ? (
          <div aria-busy="true" data-testid="frec-loading">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-5 w-1/2" />
            <Skeleton className="mt-2 h-24 w-full" />
          </div>
        ) : (
          <div>
            <Section title={t("contracts.frec.sec.info")} testId="frec-info">
              <FileInfo rows={rows()} />
            </Section>
            <Section title={t("contracts.frec.sec.approval")} testId="frec-approval">
              <RecordBody id={target.contractId} />
              {target.kind === "step" && (
                <EvidenceOf steps={evidenceStepsOf(target.file.id, r.lines)} />
              )}
              {target.kind === "attachment" && (
                <p className="m-0 mt-3 text-sm text-dim" data-testid="frec-evidence">
                  {t("contracts.frec.evidence.attachOnly")}
                </p>
              )}
            </Section>
            <Section title={t("contracts.frec.sec.sign")} testId="frec-sign-sec">
              {r.esign.isError ? (
                <p role="alert" className="m-0 text-sm text-late">
                  {t("contracts.frec.sign.loadErr")}
                </p>
              ) : (
                <SignInfo
                  b={signBlock(r.esign.data)}
                  main={target.kind === "main"}
                  onDownload={() => void download()}
                  busy={busy}
                />
              )}
              {dlErr && (
                <p role="alert" className="m-0 mt-2 text-sm text-late">
                  {t("contracts.frec.sign.downloadErr")}
                </p>
              )}
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
