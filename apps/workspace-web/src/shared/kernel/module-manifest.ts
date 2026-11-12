// CR-118 · hợp đồng duy nhất giữa một module nghiệp vụ và shell (intake PHẦN A §1 "Manifest module"): thuần, không React runtime.
// Shell chỉ đọc `modules/<m>/manifest.ts` (luật depcruise web-shell-manifest-only) rồi lọc bằng FeatureGate (platform/features).
// CR-120: MỘT AppShell cho mọi module — mỗi manifest đóng góp một nhóm menu (`nav` + `groupLabelKey`) và mục menu tài khoản.
import type { ComponentType, SVGProps } from "react";

/** Gói + hành động tối thiểu để module hiện ra (FeatureGate đọc, server vẫn fail-closed). */
export type PackRequirement = { pack: string; action: "read" | "write" | "owner" };

export type NavIconType = ComponentType<SVGProps<SVGSVGElement>>;

/** Một mục menu trái do module đóng góp; điều hướng bằng `<Link to>` của TanStack (trong app, không tải lại). */
export type NavEntry = {
  to: string;
  labelKey: string;
  icon: NavIconType;
  /** Chỉ sáng khi path đúng bằng `to`. */
  exact?: true;
  /** Tiền tố con cũng thuộc mục này (vd chi tiết hợp đồng → "Hợp đồng"). */
  also?: readonly string[];
  testId?: string;
  /** Nhãn NGẮN cho thanh dưới điện thoại (5 cột hẹp, nhãn dài bị cắt); vắng ⇒ `labelKey`. */
  shortLabelKey?: string;
  /** CR-120: false ⇒ không đưa vào thanh dưới của điện thoại (tối đa 5 cột). */
  bottom?: false;
  /** CR-125: thanh dưới điện thoại — `primary` luôn xếp đầu, `more` không chiếm cột (vào menu Thêm / menu trái). */
  mobile?: "primary" | "more";
  /** CR-120: khoá quyền động (vai + khe đã bật, server tính): vắng ⇒ luôn hiện; có ⇒ chỉ hiện khi `hasCap(cap)` đúng. */
  cap?: string;
  /** CR-126: mục «Việc của tôi» — số đỏ = số dòng hộp việc (đếm ở máy khách từ `/my-work` + `/me/review-tasks`), không theo `cap`. */
  inbox?: true;
  /** CR-132: số đỏ = tổng tin nhắn chưa đọc (một query `GET /messages/unread`, cập nhật realtime). */
  unread?: true;
};

/** Mục menu tài khoản do module đóng góp (vd Community: Tường nhà · Cài đặt chung). */
export type AccountEntry = {
  to: string;
  /** Số (không phải chuỗi): router mã hoá chuỗi "1" thành `%221%22`, số 1 thành `1`. */
  search?: Readonly<Record<string, string | number>>;
  labelKey: string;
  icon: NavIconType;
  testId?: string;
};

export type ModuleManifest<TNavItem extends NavEntry = NavEntry> = {
  key: string;
  /** CR-119 phần 2: gốc đường dẫn của app = `/${key}` (`basePathOf(key)`); nav/guard/home/`next` suy từ đây — app mới chỉ khai khoá. */
  basePath: string;
  /** Đường dẫn trang chủ của module (chuỗi — module không import module khác). */
  home: string;
  requires: PackRequirement;
  /** Khoá i18n tên nhóm trong menu trái (CR-120). */
  groupLabelKey: string;
  /** Thứ tự nhóm trong menu trái (nhỏ hơn ⇒ trên). */
  order: number;
  nav: readonly TNavItem[];
  /** Mục thêm vào menu tài khoản khi module bật (CR-120). */
  accountMenu?: readonly AccountEntry[];
};
