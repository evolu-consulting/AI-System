// V2-F · HD-01/09 · mockup `fieldsHTML`: lưới ô thông tin hợp đồng dùng chung (nhập tay, xác nhận sau upload, sửa ở trang chi tiết).
// Ô bắt buộc có dấu * và viền đỏ khi thiếu; nhãn đối tác + ô hoa hồng/giá trị đi theo loại; giá trị để trống ⇒ placeholder tự cộng.
import { type ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import { QuoteLine } from "~/features/contract-source/components/QuoteLine";
import { cn } from "~/lib/utils";
import { autoTotal, type FormState, type RequiredKey, type TextKey } from "../lib/form-model";
import { idKind, type PartnerSearchHit } from "../lib/partner-match";
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
  /** DOC-ui-list: form Giao dịch — nhãn "Tên giao dịch / Số chứng từ / Ngày giao dịch", bỏ ô chỉ của HĐ (kết thúc, nhắc hạn, người ký). */
  dealMode?: boolean;
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
          <QuoteLine key={b.text} quote={b.text} />
        ))}
    </div>
  );
}

function UnsureTag() {
  const { t } = useTranslation();
  return <Tag tone="soon">{t("contracts.cform.unsure")}</Tag>;
}

type TextOpts = {
  req?: boolean;
  bad?: boolean;
  span?: boolean;
  type?: string;
  mono?: boolean;
  ph?: string;
  suffix?: string;
  /** CR-122 p10: ô chỉ đọc (giá trị lấy từ sổ đối tác) + dòng giải thích. */
  locked?: boolean;
  hint?: string | undefined;
};

function TextField({
  k,
  label,
  o,
  f,
  onSet,
  disabled,
  locked,
  badges,
  unsure,
}: {
  k: TextKey;
  label: string;
  o: TextOpts;
  f: FormState;
  onSet: Props["onSet"];
  disabled?: boolean;
  locked?: boolean;
  badges?: readonly FieldBadge[];
  unsure?: boolean;
}) {
  return (
    <Row id={`cf-${k}`} label={label} req={o.req} span={o.span} badges={badges} unsure={unsure}>
      <div className="relative">
        <input
          id={`cf-${k}`}
          name={k}
          data-testid={`cf-${k}`}
          readOnly={o.locked}
          type={o.type ?? "text"}
          inputMode={o.mono ? "decimal" : undefined}
          value={f[k]}
          disabled={disabled || locked}
          data-unsure={unsure || undefined}
          style={
            unsure
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
      {o.hint && <span className="text-[12px] text-dim">{o.hint}</span>}
    </Row>
  );
}

/** Chọn từ sổ ⇒ tên + MST/CCCD lấy từ sổ (chỉ đọc); bỏ chọn (gõ lại tên) ⇒ xoá số cũ để nhập tay. */
function usePickedPartner(onSet: Props["onSet"]) {
  const [picked, setPicked] = useState<PartnerSearchHit | null>(null);
  const pick = useCallback(
    (h: PartnerSearchHit | null) => {
      setPicked(h);
      if (h) {
        onSet("partner_name", h.name ?? "");
        onSet("partner_tax_id", h.tax_id ?? "");
      } else onSet("partner_tax_id", "");
    },
    [onSet],
  );
  return { picked, pick };
}

/** Nhãn + tuỳ chọn ô MST/CCCD: đã chọn từ sổ ⇒ chỉ đọc kèm giải thích; số 12 chữ số ⇒ nhãn CCCD. */
function taxField(picked: PartnerSearchHit | null, L: (k: string) => string): [string, TextOpts] {
  if (!picked) return [L("partnerTaxId"), { mono: true }];
  const key = idKind(picked.tax_id) === "cccd" ? "partnerCccd" : "partnerTaxId";
  return [L(key), { mono: true, locked: true, hint: L("partnerIdFromBook") }];
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
  dealMode,
}: Props) {
  const { t } = useTranslation();
  const L = (k: string) => t(`contracts.cform.${k}`);
  const D = (k: string) => t(`contracts.doclist.f.${k}`);
  const sum = autoTotal(f.items);
  const { picked, pick } = usePickedPartner(onSet);
  const text = (k: TextKey, label: string, o: TextOpts = {}) => (
    <TextField
      k={k}
      label={label}
      o={o}
      f={f}
      onSet={onSet}
      disabled={disabled}
      locked={lockedKeys?.has(k) || o.locked}
      badges={badges?.[k]}
      unsure={unsure?.has(k)}
    />
  );
  const referral = f.deal === "referral";
  return (
    <div
      className={cn(
        "grid gap-x-4 gap-y-3.5 max-sm:grid-cols-1",
        cols === 3 ? "grid-cols-3 max-lg:grid-cols-2" : "grid-cols-2",
      )}
    >
      {text("title", dealMode ? D("title") : L("title"), {
        req: true,
        bad: invalid.has("title"),
        span: true,
        ph: dealMode ? D("titlePlaceholder") : L("titlePlaceholder"),
      })}
      {text("number", dealMode ? D("number") : L("number"), { ph: L("numberPlaceholder") })}
      <PartnerField
        deal={f.deal}
        name={f.partner_name}
        taxId={f.partner_tax_id}
        onName={(v) => onSet("partner_name", v)}
        picked={picked}
        onPick={pick}
        invalid={invalid.has("partner_name")}
        disabled={disabled}
        unsure={unsure?.has("partner_name")}
        suggest={!!(unsure || badges)}
      />
      {text("partner_tax_id", ...taxField(picked, L))}
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
      {text("start_date", dealMode ? D("startDate") : L("startDate"), {
        req: true,
        bad: invalid.has("start_date"),
        type: "date",
      })}
      {!dealMode && text("end_date", L("endDate"), { type: "date" })}
      {!dealMode && text("notice_days", L("noticeDays"), { mono: true, suffix: L("days") })}
      {!dealMode && text("our_signer", L("ourSigner"), { ph: L("signerPlaceholder") })}
      {!dealMode && text("partner_signer", L("partnerSigner"), { ph: L("signerPlaceholder") })}
      {text("payment_terms", referral ? L("paymentTermsRef") : L("paymentTerms"), {
        span: cols === 2,
        ph: referral ? L("paymentTermsRefPh") : L("paymentTermsPh"),
      })}
    </div>
  );
}
