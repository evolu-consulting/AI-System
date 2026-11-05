// delivery-opts · bảng "Giao đợt này" trong hộp xác nhận mốc giao: SL mỗi dòng đã tính sẵn (theo % của mốc, đợt cuối lấy phần còn lại)
// và sửa được trước khi xác nhận; HĐ Bán thiếu kho ⇒ cảnh báo (cài đặt cho phép giao vượt tồn) hoặc báo không đủ tồn.
import type { ContractDeal, DeliveryView, StockCheckOut } from "@ai/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deliveryReads } from "../hooks/use-milestone-writes";
import {
  checkBody,
  draftsOf,
  editOf,
  type LineDraft,
  type LinesEdit,
  shortList,
} from "../lib/delivery-lines";

export function DeliveryLines({
  id,
  deal,
  editable,
  onEdit,
}: {
  id: string;
  deal: ContractDeal;
  /** Hợp đồng đã khoá ⇒ chỉ xem (không lưu được bảng SL). */
  editable: boolean;
  onEdit: (e: LinesEdit) => void;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.cdetail.${k}`, o);
  const [view, setView] = useState<DeliveryView | null>(null);
  const [rows, setRows] = useState<LineDraft[]>([]);
  const [stock, setStock] = useState<StockCheckOut | null>(null);

  useEffect(() => {
    let live = true;
    void deliveryReads
      .getDelivery(id)
      .then((v) => {
        if (!live) return;
        const d = draftsOf(v);
        setView(v);
        setRows(d);
        onEdit(editOf(d));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, onEdit]);

  const sig = JSON.stringify(rows.map((r) => [r.product_id, r.qty]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ kiểm lại khi SL các dòng đổi (`sig`)
  useEffect(() => {
    const body = deal === "sell" ? checkBody(rows) : null;
    if (!body) return setStock(null);
    let live = true;
    void deliveryReads
      .checkStock(body)
      .then((s) => live && setStock(s))
      .catch(() => live && setStock(null));
    return () => {
      live = false;
    };
  }, [sig, deal]);

  if (!view || rows.length === 0) return null;
  const short = shortList(stock);
  const set = (i: number, qty: string) => {
    const next = rows.map((r, k) => (k === i ? { ...r, qty } : r));
    setRows(next);
    onEdit(editOf(next));
  };
  return (
    <div className="flex flex-col gap-2" data-testid="delivery-lines">
      <div className="text-[13px] font-medium">{L("deliveryLines")}</div>
      {view.pct !== null && (
        <p className="text-[12.5px] text-dim">{L("deliveryPct", { pct: view.pct })}</p>
      )}
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-dim">
            <th className="font-normal">{L("colItem")}</th>
            <th className="text-right font-normal">{L("colOnContract")}</th>
            <th className="text-right font-normal">{L("colDelivered")}</th>
            <th className="w-[140px] text-right font-normal">{L("colThisTime")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.item_id}>
              <td>{r.name}</td>
              <td className="text-right tabular-nums">{r.on_contract}</td>
              <td className="text-right tabular-nums">{r.delivered}</td>
              <td className="text-right">
                <input
                  aria-label={`${L("colThisTime")} · ${r.name}`}
                  inputMode="decimal"
                  disabled={!editable}
                  value={r.qty}
                  onChange={(e) => set(i, e.target.value)}
                  className="field w-[120px] text-right font-mono"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {short && (
        <p
          role="alert"
          data-testid="over-stock"
          className={`text-[12.5px] ${view.allow_negative ? "text-soon" : "text-late"}`}
        >
          {L(view.allow_negative ? "overStockWarn" : "overStockBlock", { list: short })}
        </p>
      )}
    </div>
  );
}
