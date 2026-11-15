// gap-d1 #21 · "Tải báo giá lên": chọn tệp PDF/văn bản ⇒ AI đọc (chỉ khi bấm "Đọc báo giá"; tệp gửi để đọc, không lưu) ⇒ dòng giá CHƯA
// LƯU, người dùng tick dòng cần rồi "Lưu làm giá tham khảo" (nguồn Báo giá).
import type { QuoteReadOut } from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AttachField, fileToDraft } from "~/components/shared/AttachField";
import { viDate, vnd } from "~/components/shared/format";
import { Spinner } from "~/components/shared/states";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { quoteSaveItems, useReadQuote, useSavePrices } from "../hooks/use-quote";
import { knownSupplierError } from "../hooks/use-suppliers";

export function QuoteDialog({
  open,
  onOpenChange,
  productId,
  productName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.gapd1.quote.${k}`, o);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<QuoteReadOut | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const read = useReadQuote(productId);
  const save = useSavePrices(productId);
  const fail = (x: unknown) => {
    const code = knownSupplierError(x);
    setErr(
      code
        ? code.startsWith("QUOTE_")
          ? t(`contracts.gapd1.quote.errors.${code}`)
          : t(`contracts.psup.errors.${code}`, { used: "?", limit: "?" })
        : t("contracts.errors.unknown"),
    );
  };
  const close = () => {
    setResult(null);
    setFile(null);
    setErr(null);
    onOpenChange(false);
  };
  const run = () => {
    const f = file;
    if (!f) return;
    setErr(null);
    read.mutate(f, {
      onSuccess: (r) => {
        setResult(r);
        setPicked(new Set(r.items.map((_, i) => i)));
      },
      onError: fail,
    });
  };
  const toggle = (i: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(i)) n.add(i);
      return n;
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setResult(null);
        onOpenChange(o);
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="sm:max-w-[560px]"
      >
        <DialogHeader>
          <DialogTitle>{L("title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {!result && (
            <>
              <p className="text-sm">{L("privacy", { name: productName })}</p>
              <span className="text-label text-ink-2">{L("file")}</span>
              <AttachField
                multiple={false}
                accept=".pdf,.txt,.csv,application/pdf,text/plain"
                inputId="gd1-q-file"
                inputTestId="gd1-q-file"
                items={file ? [fileToDraft(file)] : []}
                onFiles={(fs) => setFile(fs[0] ?? null)}
                onRemove={() => setFile(null)}
              />
              <p className="text-xs text-dim">{L("hint")}</p>
            </>
          )}
          {read.isPending && (
            <p className="flex items-center gap-2 text-sm text-dim">
              <Spinner className="h-4 w-4" /> {L("reading")}
            </p>
          )}
          {result && result.items.length === 0 && <p className="text-sm text-dim">{L("none")}</p>}
          {result && result.items.length > 0 && (
            <>
              <p className="text-xs text-dim">{L("preview")}</p>
              <ul className="flex flex-col gap-2">
                {result.items.map((i, n) => (
                  <li
                    key={`${i.supplier_name}:${i.kind}`}
                    className="rounded-lg border border-rule-soft p-3"
                  >
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.has(n)}
                        onChange={() => toggle(n)}
                        className="mt-1"
                      />
                      <span className="flex-1">
                        <b>{i.supplier_name}</b>{" "}
                        <span className="tag text-[11px]">
                          {t(`contracts.psup.kind.${i.kind}`)}
                        </span>
                        <span className="block font-mono tnum">
                          {vnd(i.price)}{" "}
                          <span className="font-sans text-xs text-dim">
                            {t("contracts.psup.exVat")}
                          </span>
                        </span>
                        {i.note && <span className="block text-xs text-dim">{i.note}</span>}
                        {i.seen_on && (
                          <span className="block text-xs text-dim">{viDate(i.seen_on)}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {err && (
            <p role="alert" className="text-sm text-late">
              {err}
            </p>
          )}
        </DialogBody>
        <DialogFooter className="flex-row justify-end">
          <button type="button" className="btn btn-quiet" onClick={close}>
            {t("contracts.psup.close")}
          </button>
          {!result && (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="gd1-q-run"
              disabled={!file || read.isPending}
              onClick={run}
            >
              {L("run")}
            </button>
          )}
          {result && result.items.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="gd1-q-save"
              disabled={picked.size === 0 || save.isPending}
              onClick={() =>
                save.mutate(quoteSaveItems(result, picked), { onSuccess: close, onError: fail })
              }
            >
              {L("save", { n: picked.size })}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
