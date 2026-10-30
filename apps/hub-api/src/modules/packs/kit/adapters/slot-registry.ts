// CR-105 · L1 · registry khe dùng chung trong process (gói đăng ký lúc mount, engine `processes/library` đọc). Một bản mỗi process:
// khe là hằng của code gói (không phải dữ liệu tenant) nên không cần tiêm theo app; đăng ký lại cùng khoá ⇒ thay.
import { createSlotRegistry, type SlotRegistry } from "../application/slot.ports";

export const slotRegistry: SlotRegistry = createSlotRegistry();
