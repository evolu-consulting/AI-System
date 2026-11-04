// V2-J2 · SP-05: "Tìm giá trên thị trường". AI tìm web CHỈ khi người dùng bấm "Tìm" (hộp thoại nói rõ chỉ gửi tên sản phẩm); kết quả
// là gợi ý chưa lưu — người dùng tick dòng cần rồi "Lưu vào bảng so sánh". Thay `/cks/scans`.
import type { SupplierSearchOut } from "@ai/contracts";
import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Spinner } from "~/components/shared/states";
import { useProductScout } from "../hooks/use-scout";
import { knownSupplierError, useSaveSuppliers, useSupplierSearch } from "../hooks/use-suppliers";

export function SearchDialog({
  dlg,
  productId,
  productName,
}: {
  dlg: RefObject<HTMLDialogElement>;
  productId: string;
  productName: string;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.psup.${k}`, o);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<SupplierSearchOut | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const usage = useProductScout(productId).data?.usage;
  const fail = (x: unknown) => {
    const code = knownSupplierError(x);
    const o = {
      used: usage?.searches ?? "?",
      limit: usage?.searches_limit ?? t("contracts.scout.unlimited"),
    };
    setErr(code ? L(`errors.${code}`, o) : t("contracts.errors.unknown"));
  };
  const close = () => {
    setResult(null);
    setErr(null);
    dlg.current?.close();
  };
  const search = useSupplierSearch(productId, {
    onStart: () => setErr(null),
    onResult: (r) => {
      setResult(r);
      setPicked(new Set(r.items.map((_, i) => i)));
    },
    onFail: fail,
  });
  const save = useSaveSuppliers(
    productId,
    () => (result?.items ?? []).filter((_, i) => picked.has(i)),
    { onDone: close, onFail: fail },
  );
  const toggle = (i: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(i)) n.add(i);
      return n;
    });
  return (
    <dialog ref={dlg} className="sheet" onClose={() => setResult(null)}>
      <div className="flex min-w-[min(560px,90vw)] flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">{L("dlgTitle")}</h2>
        {!result && (
          <>
            <p className="text-sm">{L("dlgPrivacy", { name: productName })}</p>
            <p className="text-xs text-dim">{L("dlgHint")}</p>
          </>
        )}
        {search.isPending && (
          <p className="flex items-center gap-2 text-sm text-dim">
            <Spinner className="h-4 w-4" /> {L("searching")}
          </p>
        )}
        {result && result.items.length === 0 && <p className="text-sm text-dim">{L("noResult")}</p>}
        {result && result.items.length > 0 && (
          <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
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
                    <span className="tag text-[11px]">{L(`kind.${i.kind}`)}</span>
                    <span className="block font-mono tnum">
                      {vnd(i.price)}{" "}
                      <span className="font-sans text-xs text-dim">{L("exVat")}</span>
                    </span>
                    {i.url && (
                      <a
                        href={i.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="link text-xs break-all"
                      >
                        {i.url}
                      </a>
                    )}
                    {i.seen_on && (
                      <span className="block text-xs text-dim">{viDate(i.seen_on)}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {err && (
          <p role="alert" className="text-sm text-late">
            {err}
          </p>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn btn-quiet" onClick={close}>
            {L("close")}
          </button>
          {!result && (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="scout-search-run"
              disabled={search.isPending}
              onClick={() => search.mutate()}
            >
              {L("run")}
            </button>
          )}
          {result && result.items.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={picked.size === 0 || save.isPending}
              onClick={() => save.mutate()}
            >
              {L("saveSel", { n: picked.size })}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
