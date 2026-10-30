// CR-105 · L1 · design §2: phía engine của registry khe. Gói đăng ký `SlotSpec` lúc mount (`kit/adapters/slot-registry`); thư viện
// quy trình đọc ở đây. Khe chưa đăng ký (gói tắt) ⇒ def thư viện vẫn đọc được, không gán/xuất bản được (L2a kiểm `slotSpecOf`).
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { SlotIssue, SlotSpec } from "../../packs/kit/application/slot.ports";

export type { SlotIssue, SlotSpec };

export const slotSpecOf = (key: string): SlotSpec | undefined => slotRegistry.get(key);
export const listSlots = (): SlotSpec[] => slotRegistry.list();
