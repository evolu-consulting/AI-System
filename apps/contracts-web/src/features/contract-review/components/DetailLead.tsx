// V2-F · HD-04 · mockup `renderCDetail`: dòng phụ dưới tên HĐ — số hợp đồng · nhãn loại (Mua/Bán/Giới thiệu) · đối tác.
import type { ContractDetail } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Tag } from "~/components/shared/tag";
import { DEAL_TONE, dealOf } from "~/features/contract-form/lib/deal";

export function DetailLead({ c, partner }: { c: ContractDetail; partner: string }) {
  const { t } = useTranslation();
  const deal = dealOf(c);
  const n = c.fields.number?.value;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {typeof n === "string" && n && <span>{n} ·</span>}
      <Tag tone={DEAL_TONE[deal]}>{t(`contracts.cform.dealName.${deal}`)}</Tag>
      {partner && <span>· {partner}</span>}
    </span>
  );
}
