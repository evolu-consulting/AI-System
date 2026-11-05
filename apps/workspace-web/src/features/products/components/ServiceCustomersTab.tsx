// V2-H · SP-03 (mockup NITI `custPanel`): tab "Khách đang dùng" — lọc Tất cả / Hết hạn / Sắp hết hạn / Còn hạn (kèm số), bảng khách
// + hạn dùng + trạng thái, "Nhắc gia hạn" (khách hết / sắp hết hạn) ⇒ việc "Liên hệ mời gia hạn" vào Cần xử lý của mình.
import type { ServiceCustomer, ServiceCustomersOut } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { viDate } from "~/components/shared/format";
import { Chips, Empty } from "~/components/shared/states";
import { Tag } from "~/components/shared/tag";
import { Button } from "~/components/ui/button";
import { useRemind } from "../hooks/use-remind";
import {
  CUSTOMER_FILTERS,
  type CustomerFilter,
  canRemind,
  daysLabel,
  filterCustomers,
  STATUS_TONE,
} from "../lib/customers";

const TD = "px-3 py-3";

function RemindCell({ productId, c }: { productId: string; c: ServiceCustomer }) {
  const { t } = useTranslation();
  const m = useRemind(productId, c);
  if (c.reminded)
    return (
      <Tag tone="grey" title={t("contracts.svc.remindedTitle")}>
        {t("contracts.svc.reminded")}
      </Tag>
    );
  if (!canRemind(c)) return null;
  return (
    <Button variant="outline" size="sm" disabled={m.isPending} onClick={() => m.mutate()}>
      {t("contracts.svc.remind")}
    </Button>
  );
}

function Row({ productId, c }: { productId: string; c: ServiceCustomer }) {
  const { t } = useTranslation();
  const d = daysLabel(c.days_left);
  return (
    <tr className="border-t border-rule">
      <td className={TD}>
        <b className="font-medium">{c.customer_name ?? "—"}</b>
        <div className="text-[12.5px] text-dim">
          <Link to="/contracts/$id" params={{ id: c.contract_id }} className="hover:underline">
            {c.contract_number ?? c.contract_title ?? t("contracts.svc.contract")}
          </Link>
          {c.renewals > 0 && <> · {t("contracts.svc.renewals", { n: c.renewals })}</>}
        </div>
      </td>
      <td className={`${TD} font-mono whitespace-nowrap`}>
        {c.expires_on ? viDate(c.expires_on) : "—"}
        <div className="font-sans text-[12.5px] text-dim">
          {t(`contracts.svc.${d.key}`, { n: d.n })}
        </div>
      </td>
      <td className={TD}>
        <Tag tone={STATUS_TONE[c.status]}>{t(`contracts.svc.filter.${c.status}`)}</Tag>
      </td>
      <td className={`${TD} text-right`}>
        <RemindCell productId={productId} c={c} />
      </td>
    </tr>
  );
}

export function ServiceCustomersTab({ data }: { data: ServiceCustomersOut }) {
  const { t } = useTranslation();
  const [f, setF] = useState<CustomerFilter>("all");
  const rows = filterCustomers(data.items, f);
  return (
    <div>
      <Chips
        label={t("contracts.svc.filterLabel")}
        value={f}
        onChange={setF}
        items={CUSTOMER_FILTERS.map((k) => ({
          id: k,
          label: `${t(`contracts.svc.filter.${k}`)} · ${data.counts[k]}`,
        }))}
      />
      {rows.length === 0 ? (
        <Empty title={t("contracts.svc.empty")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[14px]">
            <thead className="text-[12.5px] text-dim">
              <tr>
                <th className="px-3 py-2 font-medium">{t("contracts.svc.col.customer")}</th>
                <th className="px-3 py-2 font-medium">{t("contracts.svc.col.expires")}</th>
                <th className="px-3 py-2 font-medium">{t("contracts.svc.col.status")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <Row key={c.id} productId={data.product.id} c={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[12.5px] text-dim">
        {t("contracts.svc.rule", { n: data.notice_default })}
        {data.truncated && <> {t("contracts.svc.truncated", { n: data.items.length })}</>}
      </p>
    </div>
  );
}
