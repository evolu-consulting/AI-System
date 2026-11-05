// CR-118 · cổng host → module: app chủ (shell workspace-web) cấp router mức thấp, đăng xuất và điều hướng nội bộ sang Sổ Hợp Tác.
// Giữ MỎNG: file này nằm trong bundle đầu (manifest import) — phần dựng RouterPort nằm trong chunk module (`ui/entry`).

import type { RouterPort } from "./ports";
import type { LowRouter } from "./router-port";

export type CommunityHostConfig = {
  low: LowRouter;
  /** Kết thúc phiên chung (một phiên cho cả hai module). */
  logout(): Promise<void>;
  /** Mở trang Sổ Hợp Tác (đường dẫn gốc contracts, vd `/partners`) trong cùng app, không tải lại. */
  openContracts(path: string): void;
  /** Mở cài đặt Sổ Hợp Tác (một mục: co|rep|biz|scout|flow) ngay trong app, không đổi URL, không tải lại. */
  openContractsSettings(section: string): void;
  /** `href` cho thẻ `<a>` tới trang Sổ Hợp Tác (mở tab mới/copy được). */
  contractsHref(path: string): string;
};

/** Host đã dựng xong cho module: cấu hình + `RouterPort` trên router mức thấp. */
export type CommunityHost = Omit<CommunityHostConfig, "low"> & { router: RouterPort };

let current: CommunityHostConfig | undefined;
export const setCommunityHost = (h: CommunityHostConfig): void => {
  current = h;
};
export const getCommunityHostConfig = (): CommunityHostConfig | undefined => current;
