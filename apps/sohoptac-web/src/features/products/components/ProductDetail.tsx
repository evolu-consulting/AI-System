// V2-J1 · SP-02/07: chi tiết sản phẩm — tóm tắt (đang nắm giữ, đã bán 12 tháng, điểm + đề xuất + lý do, 3 thanh yếu tố) và các tab:
// Lịch sử mua bán · (chỗ gắn của V2-H "Khách đang dùng", V2-J2 "NCC & giá": `lib/slots.ts`) · Hợp đồng · n. Tab trong URL `?ht=`.
import type { BizDetailOut, BizFactor } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { vnd } from "~/components/shared/format";
import { Panel, Stat } from "~/components/shared/layout";
import { ErrorLine, Loading } from "~/components/shared/states";
import { Tag } from "~/components/shared/tag";
import { useBizDetail } from "../hooks/use-business";
import { barTone, GROUP_TAG, SUGGEST_TONE } from "../lib/business";
import { slotsFor } from "../lib/slots";
import { ProductContracts } from "./ProductContracts";
import { ProductHistory } from "./ProductHistory";
import { HeldCell } from "./ProductList";

const TONE_TEXT = {
  ok: "text-ok",
  soon: "text-soon",
  late: "text-late",
  grey: "text-dim",
} as const;

function Bar({ f }: { f: BizFactor }) {
  const tone = barTone(f.value);
  return (
    <div>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">
          {f.label} <span className="font-normal text-dim">· {f.weight}%</span>
        </span>
        <span className="tnum font-semibold">{f.value === null ? "—" : Math.round(f.value)}</span>
      </div>
      <div
        role="progressbar"
        aria-label={f.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={f.value === null ? undefined : Math.round(f.value)}
        className="mt-1 h-2 overflow-hidden rounded bg-sunk"
      >
        <div
          className={`h-full bg-current ${TONE_TEXT[tone]}`}
          style={{ width: `${f.value ?? 0}%` }}
        />
      </div>
      <p className="mt-0.5 text-[12px] text-dim">{f.detail}</p>
    </div>
  );
}

function Summary({ d }: { d: BizDetailOut }) {
  const { t } = useTranslation();
  const p = d.product;
  const b = p.business;
  return (
    <Panel className="mb-4 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[20px] font-semibold">{p.name}</h2>
        <Tag tone={GROUP_TAG[p.group]}>{t(`contracts.catalog.group.${p.group}`)}</Tag>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("contracts.catalog.col.held")} value={<HeldCell p={p} />} />
        <Stat
          label={t("contracts.catalog.sold12")}
          value={
            <span>
              {p.sold_12m}
              {d.revenue_12m > 0 && (
                <span className="block text-[12px] font-normal text-dim">
                  {vnd(d.revenue_12m)} đ
                </span>
              )}
            </span>
          }
        />
        <Stat
          label={t("contracts.catalog.col.score")}
          value={
            b.score === null || !b.suggestion ? (
              <span className="text-dim">{t("contracts.catalog.noScore")}</span>
            ) : (
              <span className="flex items-center gap-2">
                {b.score}
                <Tag tone={SUGGEST_TONE[b.suggestion]}>
                  {t(`contracts.catalog.sug.${b.suggestion}`)}
                </Tag>
              </span>
            )
          }
        />
      </div>
      <p className="mt-3 text-[14px] text-ink-2">
        <span className="font-medium">{t("contracts.catalog.reason")}</span> {b.reason}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {b.factors.map((f) => (
          <Bar key={f.key} f={f} />
        ))}
      </div>
    </Panel>
  );
}

export function ProductDetail({ id, ht }: { id: string; ht: string | undefined }) {
  const { t } = useTranslation();
  const q = useBizDetail(id);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const d = q.data;
  const g = d.product.group;
  const tabs = [
    ...(g === "referral" ? [] : [{ key: "history", label: t("contracts.catalog.tabHistory") }]),
    ...slotsFor(g).map((s) => ({ key: s.key, label: t(s.labelKey) })),
    { key: "contracts", label: t("contracts.catalog.tabContracts", { n: d.contracts_count }) },
  ];
  // SP Giới thiệu: tab mặc định vẫn là "Hợp đồng" (tab Nhận diện của gap-d1 đứng trước nhưng không là điểm vào).
  const first = (g === "referral" ? tabs.find((x) => x.key === "contracts") : tabs[0]) ?? tabs[0];
  const cur = tabs.find((x) => x.key === ht) ?? (first as { key: string });
  const slot = slotsFor(g).find((s) => s.key === cur.key);
  return (
    <div>
      <Link to="/products" className="mb-3 inline-block text-[13px] text-act hover:underline">
        {t("contracts.catalog.back")}
      </Link>
      <Summary d={d} />
      <Panel>
        <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-rule px-2">
          {tabs.map((x) => (
            <Link
              key={x.key}
              to="/products"
              search={{ sp: id, ...(x.key === first?.key ? {} : { ht: x.key }) }}
              role="tab"
              aria-selected={cur.key === x.key}
              className="-mb-px border-b-2 border-transparent px-3.5 py-2.5 text-body whitespace-nowrap text-ink-2 hover:text-ink aria-selected:border-act aria-selected:font-semibold aria-selected:text-act"
            >
              {x.label}
            </Link>
          ))}
        </div>
        {cur.key === "history" && <ProductHistory d={d} />}
        {cur.key === "contracts" && <ProductContracts id={id} />}
        {slot?.render({ productId: id, group: g })}
      </Panel>
    </div>
  );
}
