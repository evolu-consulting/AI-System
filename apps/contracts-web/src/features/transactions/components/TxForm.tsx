// CR-097 G2 · GD-FR-01: form nháp giao dịch (khuôn form HĐ: lưới ô + bảng dòng + tổng) — loại, đối tác (tên + MST), ngày phát sinh,
// hạn thanh toán, HĐ liên kết (tuỳ chọn), ghi chú, dòng hàng. Chỉ hiển thị + sửa state; lưu/xoá do trang gọi.
import type { ProductOut } from "@ai/contracts";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { cn } from "~/lib/utils";
import { type FormError, formTotal, type TxDeal, type TxForm } from "../lib/transactions";
import { LinesEditor } from "./LinesEditor";

type Props = {
  form: TxForm;
  onChange: (f: TxForm) => void;
  products: readonly ProductOut[];
  contractOptions: readonly { id: string; label: string }[];
  error: FormError | null;
  /** Nút Lưu nháp / Xoá… do trang truyền. */
  actions: ReactNode;
  message?: string | null;
};

function Row({
  id,
  label,
  req,
  children,
}: {
  id: string;
  label: string;
  req?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 text-[13px]">
      <label htmlFor={id}>
        {label}
        {req && <span className="text-late"> *</span>}
      </label>
      {children}
    </div>
  );
}

export function TxFormView({
  form,
  onChange,
  products,
  contractOptions,
  error,
  actions,
  message,
}: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.txn.${k}`);
  const set = <K extends keyof TxForm>(k: K, v: TxForm[K]) => onChange({ ...form, [k]: v });
  const partnerBad = error === "partner";
  const dateBad = error === "date";
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="tx-form"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Row id="tx-deal" label={L("form.deal")} req>
          <select
            id="tx-deal"
            value={form.deal}
            onChange={(e) => set("deal", e.target.value as TxDeal)}
            className="field h-[2.4rem]"
          >
            <option value="sell">{L("deal.sell")}</option>
            <option value="buy">{L("deal.buy")}</option>
          </select>
        </Row>
        <Row id="tx-partner" label={L("form.partner")} req>
          <input
            id="tx-partner"
            value={form.partner_name}
            maxLength={300}
            onChange={(e) => set("partner_name", e.target.value)}
            className={cn("field h-[2.4rem]", partnerBad && "border-late")}
            aria-invalid={partnerBad}
          />
        </Row>
        <Row id="tx-tax" label={L("form.taxId")}>
          <input
            id="tx-tax"
            value={form.partner_tax_id}
            maxLength={20}
            onChange={(e) => set("partner_tax_id", e.target.value)}
            className="field h-[2.4rem]"
          />
        </Row>
        <Row id="tx-date" label={L("form.occurredOn")} req>
          <input
            id="tx-date"
            type="date"
            value={form.occurred_on}
            onChange={(e) => set("occurred_on", e.target.value)}
            className={cn("field h-[2.4rem]", dateBad && "border-late")}
          />
        </Row>
        <Row id="tx-due" label={L("form.dueOn")}>
          <input
            id="tx-due"
            type="date"
            value={form.due_on}
            onChange={(e) => set("due_on", e.target.value)}
            className="field h-[2.4rem]"
          />
        </Row>
        <Row id="tx-contract" label={L("form.contract")}>
          <select
            id="tx-contract"
            value={form.contract_id}
            onChange={(e) => set("contract_id", e.target.value)}
            className="field h-[2.4rem]"
          >
            <option value="">{L("form.noContract")}</option>
            {form.contract_id && !contractOptions.some((c) => c.id === form.contract_id) && (
              <option value={form.contract_id}>{form.contract_id.slice(0, 8)}</option>
            )}
            {contractOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </Row>
        <div className="sm:col-span-2 lg:col-span-3">
          <Row id="tx-note" label={L("form.note")}>
            <textarea
              id="tx-note"
              rows={2}
              value={form.note}
              maxLength={2000}
              onChange={(e) => set("note", e.target.value)}
              className="field"
            />
          </Row>
        </div>
      </div>
      <section aria-label={L("form.lines")}>
        <h2 className="mb-2 text-[15px] font-semibold">{L("form.lines")}</h2>
        <LinesEditor
          lines={form.lines}
          products={products}
          error={error}
          onChange={(lines) => set("lines", lines)}
        />
        <p className="mt-3 text-right text-[14px] font-semibold" data-testid="tx-form-total">
          {L("form.total")}: {vnd(formTotal(form.lines))} ₫
        </p>
      </section>
      {message && (
        <p role="alert" className="text-sm text-late" data-testid="tx-form-error">
          {message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </form>
  );
}
