// CR-127 · U5 · spec §8: StatusChip · EffectChip · ContractLockChip — MỘT bộ chip dùng ở đầu trang chi tiết, danh sách, Sản phẩm & Giá.
import type { ContractEffect, ContractStatus } from "@ai/contracts/pack-contracts";
import { useTranslation } from "react-i18next";
import { Tag } from "~/components/shared/tag";
import { EFFECT_TONE, STATUS_TONE } from "../lib/status-view";

export function StatusChip({ status }: { status: ContractStatus }) {
  const { t } = useTranslation();
  return (
    <span data-testid="status-chip" data-status={status}>
      <Tag tone={STATUS_TONE[status]} className="font-semibold">
        {t(`contracts.u5.status.${status}`)}
      </Tag>
    </span>
  );
}

export function EffectChip({
  effect,
  daysLeft,
}: {
  effect: ContractEffect;
  /** Chỉ truyền khi `effect = expiring` ⇒ "Hết hạn sau N ngày". */
  daysLeft?: number | null;
}) {
  const { t } = useTranslation();
  const text =
    effect === "expiring" && daysLeft != null
      ? t("contracts.u5.effect.expiringIn", { n: daysLeft })
      : t(`contracts.u5.effect.${effect}`);
  return (
    <span data-testid="effect-chip" data-effect={effect}>
      <Tag tone={EFFECT_TONE[effect]}>{text}</Tag>
    </span>
  );
}

export function ContractLockChip({ reason }: { reason?: string }) {
  const { t } = useTranslation();
  return (
    <span data-testid="hold-chip">
      <Tag tone="soon" {...(reason ? { title: reason } : {})}>
        {t("contracts.u5.hold.chip")}
      </Tag>
    </span>
  );
}
