// V2-J1 · SP-01: danh sách sản phẩm — tab Tất cả / Dịch vụ có hạn / Hàng hoá / Giới thiệu (số lượng mỗi tab), cột Tên · Loại · Đang nắm
// giữ · Đã bán · Điểm kinh doanh (+ đề xuất). Một yêu cầu lấy cả danh sách; tab lọc phía trình duyệt. Bấm hàng mở chi tiết (`?sp=`).
import type { BizProductRow } from "@ai/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { Tag } from "~/components/shared/tag";
import { useBizProducts } from "../hooks/use-business";
import {
  CATALOG_TABS,
  type CatalogTab,
  filterTab,
  GROUP_TAG,
  heldView,
  SUGGEST_TONE,
} from "../lib/business";

export function HeldCell({ p }: { p: BizProductRow }) {
  const { t } = useTranslation();
  const h = heldView(p);
  if (h.kind === "none") return <span className="text-dim">{t("contracts.catalog.heldNone")}</span>;
  return (
    <span>
      <span className="tnum">{h.text}</span>
      {h.kind === "quota" && h.expiresOn && (
        <span className="block text-[12px] text-dim">
          {t("contracts.catalog.expires", { date: viDate(h.expiresOn) })}
        </span>
      )}
    </span>
  );
}

export function ScoreCell({ p }: { p: BizProductRow }) {
  const { t } = useTranslation();
  const b = p.business;
  if (b.score === null || !b.suggestion)
    return <span className="text-dim">{t("contracts.catalog.noScore")}</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="tnum w-8 text-right text-[15px] font-semibold">{b.score}</span>
      <Tag tone={SUGGEST_TONE[b.suggestion]} title={b.reason}>
        {t(`contracts.catalog.sug.${b.suggestion}`)}
      </Tag>
    </span>
  );
}

export function ProductList({ tab }: { tab: CatalogTab }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const list = useBizProducts();
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorLine error={list.error} />;
  const all = list.data?.items ?? [];
  const needle = q.trim().toLowerCase();
  const rows = filterTab(all, tab).filter((p) => !needle || p.name.toLowerCase().includes(needle));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label={t("contracts.catalog.tabs")}
          className="flex flex-wrap gap-1"
        >
          {CATALOG_TABS.map((k) => (
            <Link
              key={k}
              to="/products"
              search={k === "all" ? {} : { g: k }}
              role="tab"
              aria-selected={tab === k}
              className="rounded-full border border-rule px-3 py-1 text-[13px] text-ink-2 hover:text-ink aria-selected:border-act aria-selected:bg-act-soft aria-selected:font-semibold aria-selected:text-act"
            >
              {t(`contracts.catalog.tab.${k}`)} · {list.data?.counts[k] ?? 0}
            </Link>
          ))}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("contracts.catalog.search")}
          aria-label={t("contracts.catalog.search")}
          className="ml-auto h-9 w-56 rounded-lg border border-field bg-panel px-3 text-[14px]"
        />
      </div>
      <Panel>
        {rows.length === 0 ? (
          <Empty title={t("contracts.catalog.emptyTitle")}>
            {t("contracts.catalog.emptyBody")}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[14px]">
              <thead className="border-b border-rule text-[12px] text-dim">
                <tr>
                  {(["name", "kind", "held", "sold", "score"] as const).map((c) => (
                    <th key={c} className="px-4 py-2.5 font-medium">
                      {t(`contracts.catalog.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b border-rule-soft last:border-0 hover:bg-sunk"
                    onClick={() => void navigate({ to: "/products", search: { sp: p.id } })}
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link
                        to="/products"
                        search={{ sp: p.id }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Tag tone={GROUP_TAG[p.group]}>{t(`contracts.catalog.group.${p.group}`)}</Tag>
                    </td>
                    <td className="px-4 py-3">
                      <HeldCell p={p} />
                    </td>
                    <td className="tnum px-4 py-3">{p.sold_12m}</td>
                    <td className="px-4 py-3">
                      <ScoreCell p={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
