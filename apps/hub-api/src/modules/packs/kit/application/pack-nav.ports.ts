// CR-121 C-7 · cổng "mục hàng việc của menu" (lớp 2, chỉ kiểu + registry thuần) — cùng khuôn `record-label.ports`. Mỗi gói đăng ký MỘT
// hàm trả các mục hàng việc người xem được thấy (cap + số đang chờ); route kit `GET /pack/nav` gom song song các gói công ty đang bật.
// Gói không biết gói khác ⇒ Sổ Hợp Tác không phụ thuộc Community (và ngược lại).
import type { Role } from "@ai/contracts/common";

/** Người xem menu (cùng hình dạng `AuthUser` của hub — kit tự khai để lớp application không import `lib/`). */
export type PackNavViewer = {
  userId: string;
  tenantId: string;
  role: Role;
  exp?: number;
  userKind?: "internal" | "external";
  extOrgId?: string | null;
};

/** Một mục hàng việc: `cap` khớp `cap` của manifest web; `count` ≥ 0 (0 ⇒ mục hiện nhưng không có badge). */
export type PackNavCap = { cap: string; count: number };

export type PackNavSource = {
  /** Khoá gói (= `pack` của `/pack/<k>`); route chỉ gọi khi gói bật cho công ty của người xem. */
  pack: string;
  /**
   * Mục người xem thấy ở gói này. BẮT BUỘC lọc theo `user.tenantId` (đọc scope system cũng phải có `tenant_id = user.tenantId`).
   * Số đếm theo tập (SQL cố định, không theo hàng). Không quyền / lỗi ⇒ trả `[]` (hoặc ném: route nuốt, mục ẩn).
   */
  caps(user: PackNavViewer): Promise<PackNavCap[]>;
};

/**
 * CR-125 G7 · cổng đếm số chờ của MỘT mục menu: gói cắm adapter đếm của mình (MỘT câu SQL theo tập, lọc `user.tenantId`, đi qua index);
 * nguồn nav chỉ gọi `countedCap` — không tự viết SQL, không đếm theo hàng. Dùng lại được cho mọi gói (mục có badge).
 */
export type PackNavCountPort = {
  count(user: PackNavViewer): Promise<number>;
};

/** Mục `cap` kèm số từ cổng đếm. Cổng vắng ⇒ 0 (mục hiện, không badge). Đếm lỗi ⇒ 0 (badge ẩn, không làm mất mục hay các mục khác của gói). */
export async function countedCap(
  cap: string,
  port: PackNavCountPort | undefined,
  user: PackNavViewer,
): Promise<PackNavCap> {
  if (!port) return { cap, count: 0 };
  const n = await port.count(user).catch(() => 0);
  return { cap, count: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 };
}

export type PackNavRegistry = {
  /** Đăng ký lại cùng khoá gói ⇒ thay. */
  register(src: PackNavSource): void;
  sources(): readonly PackNavSource[];
};

export function createPackNavRegistry(): PackNavRegistry {
  const m = new Map<string, PackNavSource>();
  return {
    register: (src) => void m.set(src.pack, src),
    sources: () => [...m.values()],
  };
}
