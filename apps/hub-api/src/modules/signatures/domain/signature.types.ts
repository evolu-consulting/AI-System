// CR-181 · lát s1 · kiểu domain của chữ ký nội bộ (lớp 1, chỉ kiểu): hàng đọc từ hàm DEFINER `hub.sig_*` (hub 0155), thời gian ISO.
import type { SignatureKind, SignatureMethod, SignatureSettings } from "@ai/contracts/signature";

/** Chữ ký kèm ảnh (PNG nét đen, nền trong suốt — Q18). */
export type SignatureRecord = {
  id: string;
  kind: SignatureKind;
  method: SignatureMethod;
  png: Buffer;
  createdAt: string;
};
/** Dòng lịch sử (không kèm ảnh). `retiredAt` null = bản đang dùng. */
export type SignatureHistoryRow = {
  id: string;
  kind: SignatureKind;
  method: SignatureMethod;
  createdAt: string;
  retiredAt: string | null;
};
export type SignatureCreated = { id: string; createdAt: string; replacedId: string | null };
/** Thiết lập + dấu vết sửa; `stored=false` ⇒ chưa có hàng, `settings` là mặc định. */
export type SignatureSettingsRecord = {
  settings: SignatureSettings;
  stored: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};
/** Hàng xin/cho phép đang mở. `fresh` = lần gọi này vừa tạo/cho phép (để API chỉ báo chuông một lần). */
export type ChangeGrantState = {
  id: string;
  requestedAt: string;
  grantedAt: string | null;
  grantedBy: string | null;
};
export type ChangeGrantResult = {
  id: string;
  requestedAt: string;
  grantedAt: string | null;
  fresh: boolean;
};
/** Dòng danh sách xin/cho phép đổi của công ty (màn quản trị). `grantedAt` null = chưa cho phép. */
export type ChangeRequestRow = {
  userId: string;
  name: string;
  requestedAt: string;
  grantedAt: string | null;
  grantedBy: string | null;
};
