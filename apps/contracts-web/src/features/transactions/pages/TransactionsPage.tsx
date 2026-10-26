// CR-097 G2 · GD-FR-01: danh sách giao dịch theo khuôn danh sách HĐ — lọc trạng thái / loại / đối tác / HĐ / khoảng ngày, phân trang phía server,
// nhãn Nháp / Đã ghi sổ / Đã huỷ; bấm hàng mở chi tiết; "Tạo giao dịch" (cần quyền ghi). `?contract=` lọc sẵn theo HĐ (từ trang HĐ).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { PageHead, Panel } from "~/components/shared/layout";
import { Empty, ErrorLine, Loading } from "~/components/shared/states";
import { Tag } from "~/components/shared/tag";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { Pager } from "~/features/table";
import { fetchTxList, txListKey } from "../api";
import { TxFilters } from "../components/TxFilters";
import { useTxRefs } from "../hooks/use-tx-refs";
import {
  EMPTY_FILTER,
  hasFilter,
  listQuery,
  STATUS_TONE,
  type TxFilter,
} from "../lib/transactions";

const DEBOUNCE_MS = 250;

export function TransactionsPage() {
  const { t } = useTranslation();
  const { write } = useMe();
  const nav = useNavigate();
  const refs = useTxRefs();
  const search = useSearch({ strict: false }) as { contract?: string };
  const [f, setF] = useState<TxFilter>({ ...EMPTY_FILTER, contract_id: search.contract ?? "" });
  const [q, setQ] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setF((p) => (p.q === q ? p : { ...p, q, page: 1 })), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [q]);
  const set = (p: Partial<TxFilter>) => setF((cur) => ({ ...cur, page: 1, ...p }));
  const qs = listQuery(f);
  const list = useQuery({
    queryKey: txListKey(qs),
    queryFn: ({ signal }) => fetchTxList(qs, signal),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const L = (k: string) => t(`contracts.txn.${k}`);
  return (
    <div
      className="text-base leading-[1.55] md:flex md:min-h-0 md:flex-1 md:flex-col"
      data-testid="tx-list"
    >
      <PageHead
        title={L("title")}
        actions={
          write && (
            <Link
              to="/transactions/new"
              search={{ contract: f.contract_id || undefined }}
              className="btn btn-primary btn-sm"
              data-testid="tx-new"
            >
              {L("new")}
            </Link>
          )
        }
      />
      <TxFilters
        f={f}
        q={q}
        setQ={setQ}
        set={set}
        clear={() => {
          setQ("");
          setF({ ...EMPTY_FILTER });
        }}
        contractOptions={refs.contractOptions}
      />
      <Panel className="md:flex md:min-h-0 md:flex-1 md:flex-col">
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <ErrorLine error={list.error} />
        ) : !items.length ? (
          hasFilter(f) ? (
            <Empty title={L("noMatchTitle")}>{L("noMatchBody")}</Empty>
          ) : (
            <Empty title={L("emptyTitle")}>{L("emptyBody")}</Empty>
          )
        ) : (
          <div className="overflow-auto md:min-h-0 md:flex-1">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead className="text-left text-[12px] text-dim">
                <tr>
                  {["date", "deal", "partner", "total", "status"].map((k) => (
                    <th
                      key={k}
                      className={`sticky top-0 z-10 bg-sunk px-3 py-2.5 font-semibold first:pl-5 ${k === "total" ? "text-right" : ""}`}
                    >
                      {L(`col.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr
                    key={r.id}
                    data-testid="tx-row"
                    onClick={() => void nav({ to: "/transactions/$id", params: { id: r.id } })}
                    className="cursor-pointer border-b border-rule-soft align-top last:border-0 hover:bg-sunk"
                  >
                    <td className="px-3 py-3 pl-5">{viDate(r.occurred_on)}</td>
                    <td className="px-3 py-3">{L(`deal.${r.deal}`)}</td>
                    <td className="px-3 py-3">
                      <Link
                        to="/transactions/$id"
                        params={{ id: r.id }}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.partner_name}
                      </Link>
                      {r.lot_label && (
                        <span className="block text-[12.5px] text-dim">{r.lot_label}</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{vnd(r.total)}</td>
                    <td className="px-3 py-3">
                      <Tag tone={STATUS_TONE[r.status]}>{L(`status.${r.status}`)}</Tag>
                      {r.rev > 1 && (
                        <span className="ml-2 text-[12px] text-dim">
                          {t("contracts.txn.rev", { n: r.rev })}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager
          t={{
            page: f.page,
            pages: Math.max(1, Math.ceil(total / f.limit)),
            setPage: (page) => setF((p) => ({ ...p, page })),
            total,
            pageSize: f.limit,
            setPageSize: (limit) => setF((p) => ({ ...p, limit, page: 1 })),
          }}
        />
      </Panel>
    </div>
  );
}
