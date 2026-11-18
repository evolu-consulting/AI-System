// CR-185 · kiểu của sơ đồ chỉ xem (file lá: `def-graph.ts` và `def-modules.ts` cùng import, không vòng).
import type { GraphStage } from "./graph";

/** Đầu ra của ô module đã gắn đích: `main` = «đi tiếp» (cạnh tiến thường), còn lại = cạnh nét đứt có nhãn. */
export type DefExit = { key: string; label: string; main: boolean; to: string[] };

/** Stage của sơ đồ chỉ xem: phần dựng cạnh + chữ đã dịch sẵn (hàm thuần không gọi i18n). */
export type DefViewStage = GraphStage & {
  /** Bước có "Sau đó đi tiếp" khác bước kế (nhảy tới bước `nextStep`, 0-based). */
  nextStep: number | null;
  title: string;
  /** Dòng phụ (phòng duyệt / cách ký…); null ⇒ ẩn. */
  sub: string | null;
  /** Nhãn loại bước (Duyệt, Gửi đối tác…); null ⇒ ẩn. */
  badge: string | null;
  /** Node Kết thúc (hình riêng); chờ sự kiện cũng là điểm cuối nhưng vẽ như bước. */
  end: boolean;
  /** CR-182 · bước có vai (Duyệt / Ký). */
  role?: DefRoleView | null;
  /** CR-185 · mã node module + loại executor + nhánh chờ (để gộp cụm như admin); vắng ⇒ không gộp. */
  node?: string | null;
  exec?: string | null;
  waitBranches?: readonly { on: string; step: number | null }[];
  /** CR-185 · đầu ra của ô module sau khi gộp (do `collapseDefModules` gắn). */
  exits?: readonly DefExit[];
};
/** CR-182 · vai của bước + người được giao (chữ đã dịch sẵn); `who` null ⇒ chưa giao. */
export type DefRoleView = {
  /** «Vai · <nhãn>». */
  line: string;
  /** «Tên nhóm · n người» hoặc tên người; null ⇒ chưa giao. */
  who: string | null;
  /** Chữ cảnh báo khi chưa giao («⚠ Chưa giao người»). */
  warn: string;
  kind: "group" | "user" | null;
};
