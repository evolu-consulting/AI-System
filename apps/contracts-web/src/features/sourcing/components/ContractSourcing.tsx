// W1 · thẻ "Nguồn hàng & lãi" trên trang chi tiết HĐ (port cm-web `sourcing/Contract.tsx`): HĐ bán ⇒ mỗi dòng mua từ đâu và lãi;
// HĐ mua ⇒ các dòng bán đang mua từ HĐ này. Không có dòng nào ⇒ không hiện gì. Đổi nguồn chỉ trên HĐ bán và cần quyền ghi.
import type { ContractDetail } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { showsDeadline } from "~/features/contract-deadline/lib/deadline";
import { type SourcingParams, useContractSourcing } from "../hooks/use-sourcing";
import { SaleLines } from "./SaleLines";

type Props = { c: Pick<ContractDetail, "id" | "kind" | "status" | "direction">; write: boolean };

export function ContractSourcing({ c, write }: Props) {
  const id = c.id;
  const sale = c.direction === "sale";
  const { t } = useTranslation();
  const params: SourcingParams = { contract: id, page: 1, page_size: 100 };
  const q = useContractSourcing(params, showsDeadline(c)); // chỉ HĐ đã duyệt có dòng giá
  if (!showsDeadline(c) || !q.data?.lines.length) return null;
  return (
    <Panel className="mb-4">
      <h2
        className="border-b border-rule px-5 py-3.5 text-[15px] font-semibold"
        data-testid="contract-sourcing"
      >
        {t(sale ? "contracts.sourcing.cardSale" : "contracts.sourcing.cardPurchase")}
      </h2>
      <div className="overflow-x-auto">
        <SaleLines
          rows={q.data.lines}
          candidates={q.data.candidates}
          write={write && sale}
          showContract={!sale}
        />
      </div>
    </Panel>
  );
}
