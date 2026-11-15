// CR-144/149 · «Xem» một dòng hồ sơ duyệt: mở hộp, tải chữ ký/tệp (route `?inline=1` có kiểm quyền) thành Blob; hiển thị bằng hộp xem chung (ảnh / PDF / Word).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { fetchEvidenceBlob } from "../api-record";
import type { RecordLine } from "../lib/record-view";
import { type EvidenceUrls, EvidenceView } from "./EvidenceView";

function useEvidenceUrls(contractId: string, line: RecordLine, open: boolean): EvidenceUrls {
  const [st, setSt] = useState<EvidenceUrls>({ blobs: {}, failed: new Set() });
  useEffect(() => {
    if (!open || !line.evidenceId) return;
    const ac = new AbortController();
    const evId = line.evidenceId;
    for (const f of line.files) {
      fetchEvidenceBlob(contractId, evId, f.id, ac.signal)
        .then((b) => {
          if (ac.signal.aborted) return;
          setSt((s) => ({ ...s, blobs: { ...s.blobs, [f.id]: new Blob([b], { type: f.mime }) } }));
        })
        .catch(() => {
          if (!ac.signal.aborted) setSt((s) => ({ ...s, failed: new Set(s.failed).add(f.id) }));
        });
    }
    return () => {
      ac.abort();
      setSt({ blobs: {}, failed: new Set() });
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
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("contracts.work.u4.record.viewTitle")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <EvidenceView line={line} u={u} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
