// CR-144 · «Xem» một dòng hồ sơ duyệt: mở hộp, tải chữ ký/tệp thành blob URL (ảnh, PDF xem ngay, không tải về), thu hồi khi đóng.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { fetchEvidenceBlob } from "../api-record";
import { evidenceKind } from "../lib/evidence-kind";
import type { RecordLine } from "../lib/record-view";
import { type EvidenceUrls, EvidenceView } from "./EvidenceView";

function useEvidenceUrls(contractId: string, line: RecordLine, open: boolean): EvidenceUrls {
  const [st, setSt] = useState<EvidenceUrls>({ urls: {}, failed: new Set() });
  useEffect(() => {
    if (!open || !line.evidenceId) return;
    const ac = new AbortController();
    const made: string[] = [];
    const evId = line.evidenceId;
    for (const f of line.files.filter((x) => evidenceKind(x.mime) !== "other")) {
      fetchEvidenceBlob(contractId, evId, f.id, ac.signal)
        .then((b) => {
          if (ac.signal.aborted) return;
          const url = URL.createObjectURL(b);
          made.push(url);
          setSt((s) => ({ ...s, urls: { ...s.urls, [f.id]: url } }));
        })
        .catch(() => {
          if (!ac.signal.aborted) setSt((s) => ({ ...s, failed: new Set(s.failed).add(f.id) }));
        });
    }
    return () => {
      ac.abort();
      for (const u of made) URL.revokeObjectURL(u);
      setSt({ urls: {}, failed: new Set() });
    };
  }, [contractId, line.evidenceId, line.files, open]);
  return st;
}

export function EvidenceDialog({ contractId, line }: { contractId: string; line: RecordLine }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const u = useEvidenceUrls(contractId, line, open);
  return (
    <>
      <button
        type="button"
        className="text-act underline"
        data-testid="record-view"
        onClick={() => setOpen(true)}
      >
        {t("contracts.work.u4.record.view")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{t("contracts.work.u4.record.viewTitle")}</DialogTitle>
          </DialogHeader>
          <EvidenceView line={line} u={u} />
        </DialogContent>
      </Dialog>
    </>
  );
}
