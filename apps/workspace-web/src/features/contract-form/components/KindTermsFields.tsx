// CR-152 · bản mẫu `cr152-contract-kinds` (nq-form, ht-form): trường riêng của HĐ Nhượng quyền (3 tab Chung / Phí / Pháp lý) và Thỏa thuận hợp tác.
// Ô «Đã đăng ký Bộ Công Thương» + ngày chỉ hiện khi tick «Bên nhượng quyền ở nước ngoài». Ô AI chưa chắc (`terms.<khoá>`) viền vàng như ô khác.

import { DateInput } from "@ai/web-kit/ui/DateInput";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag } from "~/components/shared/tag";
import { cn } from "~/lib/utils";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { type KindDeal, type TermsState, visibleKeys } from "../lib/kind-terms";

type Kind = "text" | "area" | "money" | "pct" | "check" | "date" | "select";
type Spec = { k: string; kind: Kind; req?: boolean; options?: readonly string[]; span?: boolean };

const TABS: Record<KindDeal, readonly { key: string; fields: readonly Spec[] }[]> = {
  franchise: [
    {
      key: "general",
      fields: [
        { k: "role", kind: "select", req: true, options: ["franchisor", "franchisee"] },
        { k: "brand", kind: "text", req: true },
        { k: "territory", kind: "text" },
        { k: "exclusive", kind: "check" },
      ],
    },
    {
      key: "fee",
      fields: [
        { k: "initial_fee", kind: "money", req: true },
        { k: "fee_basis", kind: "select", req: true, options: ["revenue_pct", "fixed"] },
        { k: "fee_pct", kind: "pct", req: true },
        { k: "fee_fixed", kind: "money", req: true },
        { k: "period", kind: "select", req: true, options: ["month", "quarter"] },
        { k: "ad_fee_pct", kind: "pct" },
        { k: "deposit", kind: "money" },
      ],
    },
    {
      key: "legal",
      fields: [
        { k: "foreign_franchisor", kind: "check", span: true },
        { k: "moit_registered", kind: "check" },
        { k: "moit_registered_on", kind: "date" },
      ],
    },
  ],
  cooperation: [
    {
      key: "all",
      fields: [
        { k: "scope", kind: "area", req: true, span: true },
        { k: "our_contribution", kind: "area", span: true },
        { k: "partner_contribution", kind: "area", span: true },
        { k: "split_basis", kind: "select", req: true, options: ["profit", "revenue", "none"] },
        { k: "our_share_pct", kind: "pct", req: true },
        { k: "settle_period", kind: "select", req: true, options: ["month", "quarter", "year"] },
      ],
    },
  ],
};

const unsureStyle = { background: "var(--color-soon-bg)", borderColor: "var(--color-soon-line)" };

type Props = {
  deal: KindDeal;
  terms: TermsState;
  onTerm: (k: string, v: string) => void;
  unsure?: ReadonlySet<string> | undefined;
  /** Khoá còn thiếu (máy chủ báo) hoặc bị chặn khi lưu ⇒ viền đỏ. */
  invalid?: ReadonlySet<string> | undefined;
  disabled?: boolean | undefined;
};

function FieldInput({ s, p }: { s: Spec; p: Props }) {
  const { t } = useTranslation();
  const v = p.terms[s.k] ?? "";
  const id = `kt-${s.k}`;
  const un = p.unsure?.has(s.k) || undefined;
  const common = {
    id,
    name: s.k,
    "data-testid": id,
    disabled: p.disabled,
    "data-unsure": un,
    style: un ? unsureStyle : undefined,
    "aria-invalid": p.invalid?.has(s.k) || undefined,
  };
  const cls = cn("field", p.invalid?.has(s.k) && "border-late");
  const set = (x: string) => p.onTerm(s.k, x);
  if (s.kind === "check")
    return (
      <input
        {...common}
        type="checkbox"
        checked={v === "1"}
        onChange={(e) => set(e.target.checked ? "1" : "0")}
        className="size-4"
      />
    );
  if (s.kind === "select")
    return (
      <OptionSelect {...common} value={v} onValueChange={set}>
        <option value="">{t("contracts.kinds.pick")}</option>
        {s.options?.map((o) => (
          <option key={o} value={o}>
            {t(`contracts.kinds.opt.${s.k}.${o}`)}
          </option>
        ))}
      </OptionSelect>
    );
  if (s.kind === "date")
    return (
      <DateInput
        id={id}
        name={s.k}
        data-testid={id}
        disabled={p.disabled}
        value={v}
        onChange={(e) => set(e.target.value)}
        className={cn("w-full", p.invalid?.has(s.k) && "border-late")}
      />
    );
  if (s.kind === "area")
    return (
      <textarea
        {...common}
        rows={2}
        value={v}
        onChange={(e) => set(e.target.value)}
        className={cls}
      />
    );
  const num = s.kind === "money" || s.kind === "pct";
  return (
    <div className="relative">
      <Input
        {...common}
        type="text"
        inputMode={num ? "decimal" : undefined}
        value={v}
        onChange={(e) => set(e.target.value)}
        className={cn(num && "pr-10 font-mono")}
      />
      {num && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-dim">
          {s.kind === "pct" ? "%" : "đ"}
        </span>
      )}
    </div>
  );
}

function Row({ s, p }: { s: Spec; p: Props }) {
  const { t } = useTranslation();
  const check = s.kind === "check";
  return (
    <div
      className={cn(
        "flex gap-1 text-[13px]",
        check ? "items-center gap-2" : "flex-col",
        (s.span || s.kind === "area") && "col-span-full",
      )}
    >
      {check && <FieldInput s={s} p={p} />}
      <label htmlFor={`kt-${s.k}`} className="flex flex-wrap items-center gap-2">
        {t(`contracts.kinds.f.${s.k}`)}
        {s.req && <span className="text-late">*</span>}
        {p.unsure?.has(s.k) && <Tag tone="soon">{t("contracts.cform.unsure")}</Tag>}
      </label>
      {!check && <FieldInput s={s} p={p} />}
    </div>
  );
}

export function KindTermsFields(p: Props) {
  const { t } = useTranslation();
  const tabs = TABS[p.deal];
  const [tab, setTab] = useState(0);
  const show = visibleKeys(p.deal, p.terms);
  const cur = tabs[Math.min(tab, tabs.length - 1)];
  // CR-171: có ô thiếu (viền đỏ) ở tab khác ⇒ mở tab đầu tiên chứa ô đó, để người dùng thấy ngay chỗ cần điền.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ khi tập ô thiếu đổi
  useEffect(() => {
    const i = tabs.findIndex((x) => x.fields.some((s) => show.has(s.k) && p.invalid?.has(s.k)));
    if (i >= 0) setTab(i);
  }, [p.invalid]);
  const noSplit = p.deal === "cooperation" && p.terms.split_basis === "none";
  return (
    <section aria-label={t(`contracts.kinds.title.${p.deal}`)} className="flex flex-col gap-3">
      <h3 className="text-[14px] font-semibold">{t(`contracts.kinds.title.${p.deal}`)}</h3>
      {p.unsure && p.unsure.size > 0 && (
        <p className="text-[12.5px] text-soon">{t("contracts.kinds.unsureHint")}</p>
      )}
      {tabs.length > 1 && (
        <div role="tablist" className="flex gap-1 border-b border-rule-soft">
          {tabs.map((x, i) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={cur === x}
              onClick={() => setTab(i)}
              className={cn(
                "-mb-px border-b-2 px-3 py-1.5 text-[13px]",
                cur === x ? "border-act font-semibold text-act" : "border-transparent text-dim",
              )}
            >
              {t(`contracts.kinds.tab.${x.key}`)}
            </button>
          ))}
        </div>
      )}
      <div
        role={tabs.length > 1 ? "tabpanel" : undefined}
        className="grid grid-cols-2 gap-x-4 gap-y-3.5 max-sm:grid-cols-1"
      >
        {cur?.fields
          .filter((s) => show.has(s.k))
          .map((s) => (
            <Row key={s.k} s={s} p={p} />
          ))}
      </div>
      {p.deal === "cooperation" && (
        <p role="status" className="rounded-lg bg-act-soft px-3 py-2 text-[12.5px]">
          {t(noSplit ? "contracts.kinds.banner.nosplit" : "contracts.kinds.banner.split")}
        </p>
      )}
    </section>
  );
}
