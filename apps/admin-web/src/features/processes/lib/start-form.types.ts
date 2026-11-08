// CR-125 · cr125-manual-start-ui · kiểu bản nháp của phiếu yêu cầu — file LÁ (không import `draft-types`/`start-form`) để `draft-types` dùng không tạo vòng.
import type { StartFormFieldType } from "@ai/contracts/modules";

export type StartFieldDraft = {
  key: string;
  /** Mã còn tự sinh từ nhãn (người dùng chưa sửa tay). */
  keyAuto: boolean;
  label: string;
  type: StartFormFieldType;
  required: boolean;
  help: string;
};
export type StartFormDraft = {
  fields: StartFieldDraft[];
  starters: "everyone" | "groups";
  /** Nhóm được bắt đầu theo MÃ (đúng cho cả mẫu Thư viện lẫn bản công ty). */
  groupKeys: string[];
  /** Nhóm theo id (giữ nguyên khi nạp bản đã lưu; ô chọn chỉ sửa theo mã). */
  groupIds: string[];
  title: string;
};
