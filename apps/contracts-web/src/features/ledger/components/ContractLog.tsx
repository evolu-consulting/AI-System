// HD7-FR-12 · S05: khối "Ghi việc với {tên} · khách hàng/nhà cung cấp" cuối trang HĐ đã duyệt — port `ContractPage.tsx:163-181`.
// HĐ chưa biết đối tác ⇒ không hiện.
import type { ContractStatus } from "@ai/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { fetchContractPartner, ledgerKeys } from "../api";
import { PartnerLog } from "./PartnerLog";

/** mgmt: mọi trạng thái trừ đang đọc / đọc lỗi / chờ kiểm. */
export const showsLog = (status: ContractStatus | string) =>
  !["extracting", "extract_failed", "needs_review"].includes(status);

export function ContractLog({ contractId, status }: { contractId: string; status: string }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.ledger.${k}`, o);
  const p = useQuery({
    queryKey: ledgerKeys.partner(contractId),
    queryFn: ({ signal }) => fetchContractPartner(contractId, signal),
    enabled: showsLog(status),
  });
  const [open, setOpen] = useState(false);
  if (!showsLog(status) || !p.data?.party) return null;
  return (
    <Panel className="mt-4 p-5">
      <div className="flex items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          {L("logWith", { name: p.data.name ?? L("partnerFallback") })}{" "}
          <span className="font-normal text-dim">
            · {p.data.role === "customer" ? L("roleCustomer") : L("roleSupplier")}
          </span>
        </h2>
        <button
          type="button"
          className="btn btn-quiet h-9 text-[13px]"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? L("close") : L("open")}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          <PartnerLog party={p.data.party} role={p.data.role} contractId={contractId} />
        </div>
      )}
    </Panel>
  );
}
