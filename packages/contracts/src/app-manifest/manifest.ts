// CR-118 · cr118-app-config · manifest DỮ LIỆU của một app (chỉ dữ liệu, không code): mục menu, hành động chính, khe quy trình,
// feature cần có. Một nguồn cho trang cấu hình app của ai-admin (xem trước "công ty thấy gì") và shell web gộp (dựng menu).
// Tên hiển thị tiếng Việt viết thẳng (`label`) để xem trước không phụ thuộc bản dịch của web nào; web gộp dùng `labelKey`.

/** Mức dùng app của công ty (feature `<app>-read|write|admin`, cộng dồn). */
export const APP_LEVELS = ["read", "write", "admin"] as const;
export type AppAccessLevel = (typeof APP_LEVELS)[number];

/** Ba vai xem trước: quản trị công ty · thành viên · đối tác (công ty ngoài). */
export const PREVIEW_ROLES = ["company_admin", "member", "partner"] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

/** Điều kiện để thấy/mở một mục: mức tối thiểu của công ty, feature thêm, người nào được thấy. */
export type AppGate = {
  /** Mức tối thiểu của công ty đối với app. */
  level: AppAccessLevel;
  /** Feature thêm (tính năng bán riêng) bắt buộc phải bật. */
  addon?: string;
  /** `company_admin`: chỉ quản trị công ty. Mặc định mọi thành viên. */
  audience?: "everyone" | "company_admin";
  /** Đối tác (công ty ngoài) có được thấy không. Mặc định: không bao giờ. */
  partner?: boolean;
};

export type AppNavItem = AppGate & {
  key: string;
  /** Khoá i18n của web gộp. */
  labelKey: string;
  /** Tên tiếng Việt cho xem trước. */
  label: string;
  /** Hành động chính mở được ở màn này (câu ngắn, không thuật ngữ). */
  actions?: readonly AppAction[];
};

export type AppAction = AppGate & { key: string; label: string };

/** Khe quy trình của app (điểm cắm một quy trình thư viện cho từng công ty). */
export type AppSlotDecl = {
  key: string;
  label: string;
  /** Mức tối thiểu để khe chạy. */
  level: AppAccessLevel;
  /** Feature thêm bắt buộc để khe chạy (thiếu ⇒ app dùng cách duyệt mặc định cũ). */
  addon?: string;
};

export type AppManifest = {
  key: string;
  name: string;
  /** Feature từng mức (mức chọn được = mọi mức thấp hơn đều có feature). */
  levelFeatures: Readonly<Record<AppAccessLevel, string>>;
  /** Feature thêm của app, kèm tên dễ hiểu (xem trước giải thích lý do ẩn). */
  addons: readonly { key: string; label: string }[];
  nav: readonly AppNavItem[];
  slots: readonly AppSlotDecl[];
};
