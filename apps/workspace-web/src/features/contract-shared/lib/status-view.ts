// CR-127 · U5 · BR-35…40 · spec §8: MỘT chip trạng thái (4 trạng thái) + MỘT chip hiệu lực (chỉ khi DONE) + chip tạm khoá. Thuần.
import type { ContractEffect, ContractStatus } from "@ai/contracts/pack-contracts";
import type { TagTone } from "~/components/shared/tag";

export const STATUS_TONE: Record<ContractStatus, TagTone> = {
  draft: "grey",
  processing: "act",
  reject: "late",
  done: "ok",
};

/** Chip hiệu lực: chỉ HĐ DONE có hiệu lực (BR-07). */
export const EFFECT_TONE: Record<ContractEffect, TagTone> = {
  not_started: "grey",
  active: "ok",
  expiring: "soon",
  expired: "late",
  renewed: "grey",
  terminated: "grey",
};

export type EffectChipView = { effect: ContractEffect; tone: TagTone; daysLeft: number | null };

/** HĐ chưa DONE ⇒ không có chip hiệu lực (effect null). `daysLeft` chỉ khi sắp hết hạn. */
export function effectChipOf(
  c: { status: ContractStatus; effect: ContractEffect | null },
  daysLeft: number | null,
): EffectChipView | null {
  if (c.status !== "done" || !c.effect) return null;
  return {
    effect: c.effect,
    tone: EFFECT_TONE[c.effect],
    daysLeft: c.effect === "expiring" ? daysLeft : null,
  };
}
