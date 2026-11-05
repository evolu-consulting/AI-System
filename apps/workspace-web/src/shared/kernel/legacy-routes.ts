// CR-119 phần 2 · bảng chuyển hướng URL cũ (SHT ở gốc) → URL mới dưới `/contracts` (Thuần). Bookmark, email duyệt, thông báo đã lưu,
// `?next=` cũ vẫn chạy: router (root beforeLoad), `safeNext` và `landing` đều gọi `legacyTarget`. Giữ `?query#hash` trừ khi `drop`.
//
// Mơ hồ duy nhất: `/contracts` TRẦN (không query/hash) trước đây là danh sách, nay là Tổng quan ⇒ đứng yên (Tổng quan). Có query/hash
// (bộ lọc danh sách cũ) ⇒ `/contracts/list` + nguyên query. `/contracts/<id>` cũ ⇒ `/contracts/c/<id>`.
import { pathOf, tailOf } from "./app-path";

/** Đoạn đầu dưới `/contracts` là tên trang mới (không phải id hợp đồng cũ). */
export const CONTRACTS_PAGES: ReadonlySet<string> = new Set([
  "list",
  "c",
  "partners",
  "products",
  "settings",
  "notifications",
  "feedback",
]);

type Exact = { to: string; drop?: true };

/** Tuyến gốc cũ khớp chính xác (sau khi bỏ `/` cuối). `drop` = bỏ query/hash (đúng như redirect cũ của tuyến đó). */
export const LEGACY_EXACT: Readonly<Record<string, Exact>> = {
  "/overview": { to: "/contracts" },
  "/my-work": { to: "/contracts", drop: true },
  "/partners": { to: "/contracts/partners" },
  "/products": { to: "/contracts/products" },
  "/prices": { to: "/contracts/products", drop: true },
  "/sourcing": { to: "/contracts/products", drop: true },
  "/cks": { to: "/contracts/products", drop: true },
  "/notifications": { to: "/contracts/notifications" },
  "/feedback": { to: "/contracts/feedback" },
  "/settings": { to: "/contracts/settings" },
  "/settings/members": { to: "/contracts/settings/members" },
  "/settings/scoring": { to: "/contracts/partners", drop: true },
  "/transactions": { to: "/contracts/list?type=deal", drop: true },
  "/transactions/new": { to: "/contracts/c/new?type=deal", drop: true },
};

/** Tuyến gốc cũ theo tiền tố: `/cks/<x>` → Sản phẩm; `/transactions/<id>` → chi tiết chứng từ. */
const LEGACY_PREFIX: readonly [prefix: string, to: (rest: string) => string][] = [
  ["/cks/", () => "/contracts/products"],
  ["/transactions/", (rest) => `/contracts/c/${rest}`],
];

/** Href mới thay cho href cũ; `null` nếu href đã là chuẩn mới (hoặc không thuộc SHT). */
export function legacyTarget(href: string): string | null {
  const path = pathOf(href);
  const tail = tailOf(href);
  const exact = LEGACY_EXACT[path];
  if (exact) return exact.drop ? exact.to : `${exact.to}${tail}`;
  for (const [prefix, to] of LEGACY_PREFIX) {
    if (path.startsWith(prefix)) return to(path.slice(prefix.length));
  }
  if (path === "/contracts") return tail ? `/contracts/list${tail}` : null;
  const m = /^\/contracts\/([^/]+)(\/.*)?$/.exec(path);
  if (m && !CONTRACTS_PAGES.has(m[1] as string)) return `/contracts/c/${m[1]}${m[2] ?? ""}${tail}`;
  return null;
}

/** Href chuẩn mới của một href bất kỳ (đã mới thì giữ nguyên). */
export const canonicalHref = (href: string): string => legacyTarget(href) ?? href;
