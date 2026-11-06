// CR-121 c14b · thanh lưu chung của tab Cài đặt: hai form (Thông tin, Quota) dùng chung `version` công ty nên lưu LẦN LƯỢT (Thông tin trước).
// Bấm Lưu gửi form đầu tiên đang thay đổi; form còn lại giữ nguyên "chưa lưu" và Lưu tiếp lần nữa (thanh vẫn hiện).
export type SettingsForm = "info" | "quota";

export function saveOrder(dirty: { info: boolean; quota: boolean }): SettingsForm[] {
  return [...(dirty.info ? (["info"] as const) : []), ...(dirty.quota ? (["quota"] as const) : [])];
}
