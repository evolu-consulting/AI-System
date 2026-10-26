// CR-097 G2: khối nhỏ "Giao dịch liên kết" ở trang HĐ — vài giao dịch mới nhất gắn HĐ này (`GET /transactions?contract_id=`), link sang danh sách đã lọc.
// Lỗi/không có giao dịch và không có quyền ghi ⇒ ẩn (khối phụ, không chặn trang HĐ).
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { viDate, vnd } from "~/components/shared/format";
import { Tag } from "~/components/shared/tag";
import { fetchTxList, txListKey } from "../api";
import { STATUS_TONE } from "../lib/transactions";

export function ContractTxBlock({ contractId, write }: { contractId: string; write: boolean }) {
  const { t } = useTranslation();
  const qs = `contract_id=${contractId}&page=1&limit=5`;
  const q = useQuery({
    queryKey: txListKey(qs),
    queryFn: ({ signal }) => fetchTxList(qs, signal),
    retry: false,
  });
  if (q.isError || !q.data) return null;
  if (!q.data.items.length && !write) return null;
  return (
    <section
      data-testid="contract-tx-block"
      className="mb-3 rounded-lg border border-rule bg-panel p-4"
    >
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">{t("contracts.txn.contractBlock.title")}</h3>
        {q.data.total > 0 && (
          <Link
            to="/transactions"
            search={{ contract: contractId }}
            className="text-[13px] text-act hover:underline"
            data-testid="contract-tx-all"
          >
            {t("contracts.txn.contractBlock.open")} ({q.data.total})
          </Link>
        )}
        {write && (
          <Link
            to="/transactions/new"
            search={{ contract: contractId }}
            className="ml-auto text-[13px] text-act hover:underline"
          >
            {t("contracts.txn.contractBlock.add")}
          </Link>
        )}
      </div>
      <ul className="divide-y divide-rule-soft">
        {q.data.items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-1.5 text-[13.5px]">
            <Link
              to="/transactions/$id"
              params={{ id: r.id }}
              className="font-medium hover:underline"
            >
              {t(`contracts.txn.deal.${r.deal}`)} · {r.partner_name}
            </Link>
            <span className="text-dim">{viDate(r.occurred_on)}</span>
            <span className="ml-auto tabular-nums">{vnd(r.total)} ₫</span>
            <Tag tone={STATUS_TONE[r.status]}>{t(`contracts.txn.status.${r.status}`)}</Tag>
          </li>
        ))}
      </ul>
    </section>
  );
}
