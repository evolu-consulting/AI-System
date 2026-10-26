// CR-097 G2 · GD-FR-02/04/05: hộp thoại giao dịch — kết quả kho trước → sau (từ `stock` của API), huỷ (lý do bắt buộc),
// điều chỉnh (lý do bắt buộc + dòng/ngày mới ⇒ tạo bản `rev` mới).
import type { ProductOut, TransactionAdjust, TransactionDetail } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import {
  type FormError,
  formErrorText,
  formFromDetail,
  type LineForm,
  linesToIn,
  reasonOk,
  type StockRow,
} from "../lib/transactions";
import { LinesEditor } from "./LinesEditor";

/** Bảng kho trước → sau; rỗng ⇒ "không đụng kho". */
export function StockResultDialog({
  title,
  rows,
  reversed,
  onClose,
}: {
  title: string;
  rows: readonly StockRow[];
  reversed: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.txn.${k}`, o);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={title} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {rows.length ? L("stock.lead") : L("stock.none")}
            {reversed > 0 ? ` ${L("stock.reversed", { n: reversed })}` : ""}
          </DialogDescription>
        </DialogHeader>
        {rows.length > 0 && (
          <table className="w-full text-[13px]" data-testid="stock-table">
            <thead className="text-left text-[12px] text-dim">
              <tr>
                <th className="py-1 font-semibold">{L("stock.item")}</th>
                <th className="py-1 text-right font-semibold">{L("stock.before")}</th>
                <th className="py-1 text-right font-semibold">{L("stock.after")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.component_id} className="border-t border-rule-soft">
                  <td className="py-1.5 pr-2">{r.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.before}</td>
                  <td
                    className={cn(
                      "py-1.5 text-right font-semibold tabular-nums",
                      r.trend === "up" && "text-ok",
                      r.trend === "down" && "text-late",
                    )}
                  >
                    {r.after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <DialogFooter>
          <Button type="button" data-testid="stock-close" onClick={onClose}>
            {t("contracts.common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ReasonField = ({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) => (
  <div className="flex flex-col gap-1 text-[13px]">
    <label htmlFor="tx-reason">
      {label} <span className="text-late">*</span>
    </label>
    <textarea
      id="tx-reason"
      rows={3}
      maxLength={500}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="field"
    />
  </div>
);

/** Huỷ giao dịch đã ghi sổ — lý do ≥ 3 ký tự; hoàn kho + huỷ nghĩa vụ mở (không xoá). */
export function CancelDialog({
  busy,
  error,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={t("contracts.txn.cancel.title")}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (reasonOk(reason) && !busy) onSubmit(reason.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("contracts.txn.cancel.title")}</DialogTitle>
            <DialogDescription>{t("contracts.txn.cancel.body")}</DialogDescription>
          </DialogHeader>
          <ReasonField value={reason} onChange={setReason} label={t("contracts.txn.reason")} />
          {error && (
            <p role="alert" className="text-sm text-late">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("contracts.common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!reasonOk(reason) || busy}
              data-testid="tx-cancel-submit"
            >
              {t("contracts.txn.cancel.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Điều chỉnh số liệu: ngày/hạn + dòng mới thay bản hiện hành (bản cũ giữ trong dòng thời gian). */
export function AdjustDialog({
  tx,
  products,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  tx: TransactionDetail;
  products: readonly ProductOut[];
  busy: boolean;
  error: string | null;
  onSubmit: (body: TransactionAdjust) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const init = formFromDetail(tx);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<LineForm[]>(init.lines);
  const [day, setDay] = useState(init.occurred_on);
  const [due, setDue] = useState(init.due_on);
  const [fe, setFe] = useState<FormError | null>(null);
  const submit = () => {
    const ls = linesToIn(lines);
    if (!ls.ok) return setFe(ls.error);
    setFe(null);
    onSubmit({ reason: reason.trim(), occurred_on: day, due_on: due || null, lines: ls.lines });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-label={t("contracts.txn.adjust.title")}
        className="max-h-[90vh] overflow-auto sm:max-w-3xl"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (reasonOk(reason) && !busy) submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("contracts.txn.adjust.title")}</DialogTitle>
            <DialogDescription>{t("contracts.txn.adjust.body")}</DialogDescription>
          </DialogHeader>
          <ReasonField value={reason} onChange={setReason} label={t("contracts.txn.reason")} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[13px]">
              {t("contracts.txn.form.occurredOn")}
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="field h-[2.4rem]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px]">
              {t("contracts.txn.form.dueOn")}
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="field h-[2.4rem]"
              />
            </label>
          </div>
          <LinesEditor lines={lines} products={products} error={fe} onChange={setLines} />
          {(fe || error) && (
            <p role="alert" className="text-sm text-late">
              {fe ? formErrorText(fe, t) : error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("contracts.common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!reasonOk(reason) || busy}
              data-testid="tx-adjust-submit"
            >
              {t("contracts.txn.adjust.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
