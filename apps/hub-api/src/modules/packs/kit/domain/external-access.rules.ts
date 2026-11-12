// CR-102a · com-c2-ext-deny: luật thuần "user ngoài (đối tác) được đi đâu" ở hub-api — TỪ CHỐI MẶC ĐỊNH. Đối tác chỉ dùng
// các MẶT API khai trong `EXTERNAL_SURFACES` (ADR-0044: khoá = mặt `/pack/<surface>`, KHÔNG phải gói quyền; đối tác không
// bao giờ nhận quyền gói `contracts`) + chuông thông báo của chính mình. Không
// Chat App, không agent, không danh bạ, không quy trình, không Studio. Group không bao giờ mở thêm quyền cho đối tác (0028
// chặn Group ở DB; luật gói ở đây bỏ qua grant Group). Lớp 1: chỉ built-in.
import type { PackAction } from "./pack-access.rules";

/** Mặt API mở cho đối tác ⇒ việc được làm (khi tenant đã bật gói chủ + add-on của mặt). Không có `admin`. */
export const EXTERNAL_SURFACES: Readonly<Record<string, readonly PackAction[]>> = Object.freeze({
  community: Object.freeze(["read", "write"] as const),
});

/** Việc đối tác được làm trên mặt `surface` (rỗng = không vào được). */
export const externalSurfaceActions = (surface: string): readonly PackAction[] =>
  Object.hasOwn(EXTERNAL_SURFACES, surface) ? (EXTERNAL_SURFACES[surface] ?? []) : [];

/** Gốc route ngoài gói mà đối tác vẫn dùng (chuông thông báo của chính mình — dữ liệu theo `user_id`). */
export const EXTERNAL_OPEN_PREFIXES: readonly string[] = ["/notifications"];

const under = (path: string, p: string): boolean => path === p || path.startsWith(`${p}/`);

/** Đường dẫn hub-api đối tác được gọi: `/pack/<k>[/...]` với `k` ∈ `EXTERNAL_SURFACES`, hoặc `EXTERNAL_OPEN_PREFIXES`. */
export function externalPathAllowed(path: string, packPrefix = "/pack"): boolean {
  if (EXTERNAL_OPEN_PREFIXES.some((p) => under(path, p))) return true;
  // CR-118 · ảnh năng lực của chính user (shell/FeatureGate); thân đã lọc theo `EXTERNAL_SURFACES`. Đúng một đường, không con.
  if (path === `${packPrefix}/me`) return true;
  if (!path.startsWith(`${packPrefix}/`)) return false;
  const key = path.slice(packPrefix.length + 1).split("/", 1)[0] ?? "";
  return externalSurfaceActions(key).length > 0;
}
