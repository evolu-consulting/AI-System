// CR-121 Q-1 · registry nhãn bản ghi dùng chung trong process (gói đăng ký lúc mount, Hub đọc) — cùng khuôn `slot-registry`.
import { createRecordLabelRegistry } from "../application/record-label.ports";

export const recordLabelRegistry = createRecordLabelRegistry();
