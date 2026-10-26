// V2-L · hình dữ liệu của hộp thoại Cài đặt: bản nháp = hai nguồn API gộp một chỗ (công ty · điểm kinh doanh). Điểm uy tín (U3, CR-097a) lưu riêng
// theo vai ở `ScoringPane` (`/scoring/:role`), không nằm trong bản nháp chung.
// Kiểu theo `GET /pack/contracts/{company,business/config}`; thân PUT strict nên có hàm chuyển riêng ở `data.ts`.
import type { BizConfig, CompanyIn } from "@ai/contracts";

/** Mọi thứ hộp thoại chỉnh được bằng nút Lưu chung. */
export type SettingsData = {
  company: CompanyIn;
  biz: BizConfig;
};
export type SettingsState = { saved: SettingsData; defaults: SettingsData };

export type SectionId = "co" | "rep" | "biz" | "scout" | "flow";
