// V2-F · HD-01/09 · mockup `fieldsHTML`: lưới ô thông tin hợp đồng dùng chung (nhập tay, xác nhận sau upload, sửa ở trang chi tiết).
// Ô bắt buộc có dấu * và viền đỏ khi thiếu; nhãn đối tác + ô hoa hồng/giá trị đi theo loại; giá trị để trống ⇒ placeholder tự cộng.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import { cn } from "~/lib/utils";
import { autoTotal, type FormState, type RequiredKey, type TextKey } from "../lib/form-model";
import { PartnerField } from "./PartnerField";

export type FieldBadge = { kind: "warn" | "quote"; text: string };

type Props = {
  f: FormState;
  onSet: (k: TextKey, v: string) => void;
  invalid: ReadonlySet<RequiredKey>;
  cols?: 2 | 3;
  disabled?: boolean;
  /** Ô đã khoá sau khi lưu (loại HĐ, hoa hồng…). */
  lockedKeys?: ReadonlySet<TextKey>;
  /** Dấu hiệu của agent trên từng ô ("AI chưa chắc", trích dẫn). */
  badges?: Partial<Record<TextKey, readonly FieldBadge[]>>;
  /** V2-G: ô AI chưa chắc và người chưa sửa ⇒ tô vàng (`data-unsure`). */
  unsure?: ReadonlySet<TextKey>;
};

function Row({
  id,
  label,
  req,
  span,
  badges,
  unsure,
  children,
}: {
  id: string;
  label: string;
  req?: boolean;
  span?: boolean;
  badges?: readonly FieldBadge[];
  unsure?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1 text-[13px]", span && "col-span-full")}>
      <label htmlFor={id} className="flex flex-wrap items-center gap-2">
        {label}
        {req && <span className="text-late">*</span>}
        {unsure && !badges?.some((b) => b.kind === "warn") && <UnsureTag />}
        {badges
          ?.filter((b) => b.kind === "warn")
          .map((b) => (
            <Tag key={b.text} tone="soon">
              {b.text}
            </Tag>
          ))}
      </label>
      {children}
      {badges
        ?.filter((b) => b.kind === "quote")
        .map((b) => (
          <span key={b.text} className="text-[12px] text-dim italic">
            “{b.text}”
          </span>
        ))}
    </div>
  );
}

function UnsureTag() {
  const { t } = useTranslation();
  return <Tag tone="soon">{t("contracts.cform.unsure")}</Tag>;
}

export function FieldsGrid({
  f,
  onSet,
  invalid,
  cols = 3,
  disabled,
  lockedKeys,
  badges,
  unsure,
}: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cform.${k}`);
  const sum = autoTotal(f.items);
  const text = (
    k: TextKey,
    label: string,
    o: {
      req?: boolean;
      bad?: boolean;
      span?: boolean;
      type?: string;
      mono?: boolean;
      ph?: string;
      suffix?: string;
    } = {},
  ) => (
    <Row
      id={`cf-${k}`}
      label={label}
      req={o.req}
      span={o.span}
      badges={badges?.[k]}
      unsure={unsure?.has(k)}
    >
      <div className="relative">
        <input
          id={`cf-${k}`}
          name={k}
          type={o.type ?? "text"}
          inputMode={o.mono ? "decimal" : undefined}
          value={f[k]}
          disabled={disabled || lockedKeys?.has(k)}
          data-unsure={unsure?.has(k) || undefined}
          style={
            unsure?.has(k)
              ? { background: "var(--color-soon-bg)", borderColor: "var(--color-soon-line)" }
              : undefined
          }
          placeholder={o.ph}
          aria-invalid={o.bad || undefined}
          onChange={(e) => onSet(k, e.target.value)}
          className={cn(
            "field",
            o.mono && "font-mono",
            o.bad && "border-late",
            o.suffix && "pr-12",
          )}
        />
        {o.suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-dim">
            {o.suffix}
          </span>
        )}
      </div>
    </Row>
  );
  const referral = f.deal === "referral";
  return (
    <div
      className={cn(
        "grid gap-x-4 gap-y-3.5 max-sm:grid-cols-1",
        cols === 3 ? "grid-cols-3 max-lg:grid-cols-2" : "grid-cols-2",
      )}
    >
      {text("title", L("title"), {
        req: true,
        bad: invalid.has("title"),
        span: true,
        ph: L("titlePlaceholder"),
      })}
      {text("number", L("number"), { ph: L("numberPlaceholder") })}
      <PartnerField
        deal={f.deal}
        name={f.partner_name}
        taxId={f.partner_tax_id}
        onName={(v) => onSet("partner_name", v)}
        invalid={invalid.has("partner_name")}
        disabled={disabled}
        unsure={unsure?.has("partner_name")}
      />
      {text("partner_tax_id", L("partnerTaxId"), { mono: true })}
      {referral ? (
        <>
          {text("commission_pct", L("commissionPct"), {
            req: true,
            bad: invalid.has("commission"),
            mono: true,
            ph: L("commissionPctPh"),
            suffix: "%",
          })}
          {text("commission_fixed", L("commissionFixed"), {
            mono: true,
            suffix: "đ",
            ph: L("commissionFixedPh"),
          })}
        </>
      ) : (
        text("total_value", L("totalValue"), {
          mono: true,
          suffix: "đ",
          ph: sum !== null ? t("contracts.cform.autoSum", { value: vnd(sum) }) : L("totalValuePh"),
        })
      )}
      {text("start_date", L("startDate"), {
        req: true,
        bad: invalid.has("start_date"),
        type: "date",
      })}
      {text("end_date", L("endDate"), { type: "date" })}
      {text("notice_days", L("noticeDays"), { mono: true, suffix: L("days") })}
      {text("our_signer", L("ourSigner"), { ph: L("signerPlaceholder") })}
      {text("partner_signer", L("partnerSigner"), { ph: L("signerPlaceholder") })}
      {text("payment_terms", referral ? L("paymentTermsRef") : L("paymentTerms"), {
        span: cols === 2,
        ph: referral ? L("paymentTermsRefPh") : L("paymentTermsPh"),
      })}
    </div>
  );
}
