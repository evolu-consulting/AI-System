// CR-135 Q12: icon loại chứng từ (HĐ kinh tế / HĐ nguyên tắc / Giao dịch) có màu, đặt CẠNH tên HĐ; nhãn đọc màn hình + tooltip = tên loại.
import { useTranslation } from "react-i18next";
import { IconContract, IconFramework, IconTransaction } from "~/components/icons";

export type DocKind = "contract" | "framework" | "deal";

const LOOK = {
  contract: { Icon: IconContract, cls: "bg-act-soft text-act" },
  framework: { Icon: IconFramework, cls: "bg-ok-bg text-ok" },
  deal: { Icon: IconTransaction, cls: "bg-soon-bg text-soon" },
} as const;

export function DocTypeIcon({ kind }: { kind: DocKind }) {
  const { t } = useTranslation();
  const { Icon, cls } = LOOK[kind];
  const name = t(`contracts.docframe.type.${kind}`);
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      data-testid="doc-type-icon"
      data-kind={kind}
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${cls}`}
    >
      <Icon width={18} height={18} />
    </span>
  );
}
