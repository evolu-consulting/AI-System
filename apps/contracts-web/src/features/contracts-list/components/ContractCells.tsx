// HD-FR-51 · S03 · port `ContractsPage.tsx:100-143` (ô bảng) + thẻ điện thoại `:196-215`. Hàng phụ lục: dòng phụ "Phụ lục của <HĐ gốc>".
import type { ContractListRow } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TONE_TEXT, vnd } from "~/components/shared/format";
import { cn } from "~/lib/utils";
import { STATUS_VIEW, shortName } from "../lib/list-model";

export type RowCtx = {
  /** Tên loại hàng theo id. */
  categories: ReadonlyMap<string, string>;
  /** Tên phụ trách theo id. */
  owners: ReadonlyMap<string, string>;
  /** Tiêu đề HĐ gốc của hàng phụ lục trong trang (`parents` của API). */
  parents: ReadonlyMap<string, string>;
};

export const COLUMN_KEYS = [
  "title",
  "seller",
  "buyer",
  "value",
  "signers",
  "owner",
  "status",
  "what",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

const TD = "px-3 py-3";

function SubLine({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const { t } = useTranslation();
  const parent = r.parent_id ? ctx.parents.get(r.parent_id) : undefined;
  const parts = [r.number, parent ? t("contracts.list.appendixOf", { title: parent }) : null];
  return (
    <span className="block truncate text-[12.5px] text-dim">
      {parts.filter(Boolean).join(" · ")}
    </span>
  );
}

export function Tags({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const names = r.category_ids.map((id) => ctx.categories.get(id)).filter(Boolean);
  return (
    <span className="flex flex-wrap gap-1.5">
      {names.map((n) => (
        <span
          key={n}
          className="inline-flex h-[22px] items-center rounded-md bg-act-soft px-2 text-[12px] whitespace-nowrap text-act"
        >
          {n}
        </span>
      ))}
    </span>
  );
}

export function StatusText({ r, className }: { r: ContractListRow; className?: string }) {
  const v = STATUS_VIEW[r.status];
  return <span className={cn(TONE_TEXT[v.tone], className)}>{v.label}</span>;
}

/** Ô theo cột; `title` mang cả liên kết mở màn kiểm (S05). */
export function cell(
  key: ColumnKey,
  r: ContractListRow,
  ctx: RowCtx,
  t: (k: string) => string,
): ReactNode {
  switch (key) {
    case "title":
      return (
        <td className="max-w-[240px] px-3 py-3 pl-5">
          <Link
            to="/contracts/$id"
            params={{ id: r.id }}
            className="block truncate font-semibold"
            title={r.title}
            onClick={(e) => e.stopPropagation()}
          >
            {r.title}
          </Link>
          <SubLine r={r} ctx={ctx} />
        </td>
      );
    case "seller":
      return (
        <td className={cn("min-w-[130px]", TD)} title={r.seller ?? undefined}>
          <span className="line-clamp-2">{shortName(r.seller)}</span>
        </td>
      );
    case "buyer":
      return (
        <td className={cn("min-w-[130px]", TD)} title={r.buyer ?? undefined}>
          <span className="line-clamp-2">{shortName(r.buyer)}</span>
        </td>
      );
    case "value":
      return (
        <td className={cn("text-right font-mono whitespace-nowrap", TD)}>
          {r.value != null ? `${vnd(r.value)} đ` : "—"}
        </td>
      );
    case "signers":
      return (
        <td className={cn("min-w-[170px] text-[13px]", TD)}>
          {r.seller_signer || r.buyer_signer ? (
            <>
              <span className="block truncate" title={r.seller_signer ?? undefined}>
                <span className="text-dim">{t("contracts.list.signSell")}</span>
                {r.seller_signer ?? "—"}
              </span>
              <span className="block truncate" title={r.buyer_signer ?? undefined}>
                <span className="text-dim">{t("contracts.list.signBuy")}</span>
                {r.buyer_signer ?? "—"}
              </span>
            </>
          ) : (
            <span className="text-dim">—</span>
          )}
        </td>
      );
    case "owner": {
      const name = r.owner_user_id ? ctx.owners.get(r.owner_user_id) : undefined;
      return (
        <td className={cn("max-w-[140px] truncate", TD)} title={name}>
          {name ?? "—"}
        </td>
      );
    }
    case "status":
      return (
        <td className={cn("whitespace-nowrap", TD)}>
          <StatusText r={r} />
        </td>
      );
    case "what":
      return (
        <td className="min-w-[200px] px-3 py-3 pr-5">
          <Tags r={r} ctx={ctx} />
        </td>
      );
  }
}

/** Thẻ điện thoại: một thẻ mỗi HĐ. */
export function MobileCard({ r, ctx }: { r: ContractListRow; ctx: RowCtx }) {
  const { t } = useTranslation();
  const owner = r.owner_user_id ? ctx.owners.get(r.owner_user_id) : undefined;
  const parent = r.parent_id ? ctx.parents.get(r.parent_id) : undefined;
  const sides = [r.seller, r.buyer].filter(Boolean).map(shortName).join(" → ");
  const money = [
    r.value != null ? `${vnd(r.value)} đ` : null,
    owner ? t("contracts.list.ownerLine", { name: owner }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="relative border-b border-rule-soft last:border-0">
      <Link
        to="/contracts/$id"
        params={{ id: r.id }}
        className="flex flex-col gap-1.5 px-4 py-3.5 hover:bg-sunk"
      >
        <span className="truncate font-semibold">{r.title}</span>
        {parent && (
          <span className="text-[13px] text-dim">
            {t("contracts.list.appendixOf", { title: parent })}
          </span>
        )}
        <span className="text-[13px] text-dim">{sides}</span>
        <span className="text-[13px] text-dim">{money}</span>
        <Tags r={r} ctx={ctx} />
        <StatusText r={r} className="text-[13.5px]" />
      </Link>
    </li>
  );
}
