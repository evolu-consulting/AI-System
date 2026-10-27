// CR-101 DOC-ui-frame · R42: "Gắn chứng từ có sẵn" — chọn nhiều HĐ / giao dịch (cùng đối tác + hướng do máy chủ kiểm) ⇒ POST /attach.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { attachDocs, candidatesKey, fetchCandidates } from "../api";
import { attachCandidates, docErrorText } from "../lib/frame-view";

type Props = {
  frameId: string;
  attachedIds: readonly string[];
  onClose: () => void;
  onDone: () => void;
};

export function AttachDialog({ frameId, attachedIds, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.docframe.${k}`);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = useQuery({
    queryKey: candidatesKey(q),
    queryFn: ({ signal }) => fetchCandidates(q, signal),
  });
  const rows = list.data ? attachCandidates(list.data, frameId, attachedIds) : [];
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await attachDocs(frameId, [...picked]);
      onDone();
    } catch (e) {
      setErr(docErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={L("attachTitle")}>
        <DialogHeader>
          <DialogTitle>{L("attachTitle")}</DialogTitle>
          <DialogDescription>{L("attachHint")}</DialogDescription>
        </DialogHeader>
        <input
          className="field"
          aria-label={L("attachSearch")}
          placeholder={L("attachSearch")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="max-h-64 overflow-y-auto" data-testid="attach-list">
          {rows.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-2 px-1 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={picked.has(r.id)}
                  onChange={() => toggle(r.id)}
                  aria-label={r.title}
                />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="text-dim">{r.number ?? ""}</span>
              </label>
            </li>
          ))}
          {list.data && rows.length === 0 && (
            <li className="px-1 py-2 text-sm text-dim">{L("attachNone")}</li>
          )}
        </ul>
        {err && (
          <p role="alert" className="text-sm text-late" data-testid="attach-error">
            {err}
          </p>
        )}
        <DialogFooter>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t("contracts.common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="attach-submit"
            disabled={busy || picked.size === 0}
            onClick={() => void submit()}
          >
            {L("attachSubmit")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
