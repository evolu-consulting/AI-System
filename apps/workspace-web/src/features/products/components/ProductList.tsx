// V2-J1 · SP-01: danh sách sản phẩm — tab Tất cả / Dịch vụ có hạn / Hàng hoá / Giới thiệu (số lượng mỗi tab), cột Tên · Loại · Đang nắm
// giữ · Đã bán · Điểm kinh doanh (+ đề xuất). Một yêu cầu lấy cả danh sách; tab lọc phía trình duyệt. Bấm hàng mở chi tiết (`?sp=`).

import type { BizProductRow } from "@ai/contracts/pack-contracts";
import { FilterBar } from "@ai/web-kit/ui/kit/filter-bar";
import { Input } from "@ai/web-kit/ui/kit/input";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { Tag } from "~/components/shared/tag";
import { Pager } from "~/features/table";
import { useBizPage } from "../hooks/use-business";
import { CATALOG_TABS, type CatalogTab, GROUP_TAG, heldView, SUGGEST_TONE } from "../lib/business";

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
  const [qRaw, setQRaw] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // CR-151: tìm, lọc nhóm và cắt trang ở máy chủ.
  useEffect(() => {
    const h = setTimeout(() => {
      setQ(qRaw.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(h);
  }, [qRaw]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: đổi nhóm ⇒ về trang 1
  useEffect(() => setPage(1), [tab]);
  const list = useBizPage({
    ...(tab === "all" ? {} : { group: tab }),
    q,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorLine error={list.error} />;
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <FilterBar
          chips={
            <div
              role="tablist"
              aria-label={t("contracts.catalog.tabs")}
              className="flex flex-wrap gap-1 max-sm:flex-nowrap"
            >
              {CATALOG_TABS.map((k) => (
                <Link
                  key={k}
                  to="/contracts/products"
                  search={k === "all" ? {} : { g: k }}
                  role="tab"
                  aria-selected={tab === k}
                  className="inline-flex shrink-0 items-center rounded-full border border-rule px-3 py-1 text-[13px] max-sm:min-h-11 text-ink-2 hover:text-ink aria-selected:border-act aria-selected:bg-act-soft aria-selected:font-semibold aria-selected:text-act"
                >
                  {t(`contracts.catalog.tab.${k}`)} · {list.data?.counts[k] ?? 0}
                </Link>
              ))}
            </div>
          }
        />
        <Input
          type="search"
          value={qRaw}
          onChange={(e) => setQRaw(e.target.value)}
          placeholder={t("contracts.catalog.search")}
          aria-label={t("contracts.catalog.search")}
          className="h-9 w-full sm:ml-auto sm:w-56"
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
                    onClick={() =>
                      void navigate({ to: "/contracts/products", search: { sp: p.id } })
                    }
                  >
                    <td className="px-4 py-3 font-medium">
                      <Link
                        to="/contracts/products"
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
        <Pager
          t={{
            page,
            pages: Math.max(1, Math.ceil(total / pageSize)),
            setPage,
            total,
            pageSize,
            setPageSize: (n) => {
              setPageSize(n);
              setPage(1);
            },
          }}
        />
      </Panel>
    </div>
  );
}
