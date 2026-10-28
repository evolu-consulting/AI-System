// CR-102a · com-c2-ext-deny: luật thuần "user ngoài (đối tác) được đi đâu" ở hub-api — TỪ CHỐI MẶC ĐỊNH. Đối tác chỉ dùng
// các gói khai trong `EXTERNAL_PACKS` (dữ liệu, không if theo tên gói ở nơi khác) + chuông thông báo của chính mình. Không
// Chat App, không agent, không danh bạ, không quy trình, không Studio. Group không bao giờ mở thêm quyền cho đối tác (0028
// chặn Group ở DB; luật gói ở đây bỏ qua grant Group). Lớp 1: chỉ built-in.
import type { PackAction } from "./pack-access.rules";

/** Gói mở cho đối tác ⇒ việc được làm (khi tenant đã bật gói). Gói chưa cài (vd `community` trước C3) ⇒ như chưa bật. */
export const EXTERNAL_PACKS: Readonly<Record<string, readonly PackAction[]>> = Object.freeze({
  community: Object.freeze(["read", "write"] as const),
});

/** Việc đối tác được làm trong gói `packKey` (rỗng = không vào được). */
export const externalPackActions = (packKey: string): readonly PackAction[] =>
  Object.hasOwn(EXTERNAL_PACKS, packKey) ? (EXTERNAL_PACKS[packKey] ?? []) : [];

/** Gốc route ngoài gói mà đối tác vẫn dùng (chuông thông báo của chính mình — dữ liệu theo `user_id`). */
export const EXTERNAL_OPEN_PREFIXES: readonly string[] = ["/notifications"];

const under = (path: string, p: string): boolean => path === p || path.startsWith(`${p}/`);

/** Đường dẫn hub-api đối tác được gọi: `/pack/<k>[/...]` với `k` ∈ `EXTERNAL_PACKS`, hoặc `EXTERNAL_OPEN_PREFIXES`. */
export function externalPathAllowed(path: string, packPrefix = "/pack"): boolean {
  if (EXTERNAL_OPEN_PREFIXES.some((p) => under(path, p))) return true;
  if (!path.startsWith(`${packPrefix}/`)) return false;
  const key = path.slice(packPrefix.length + 1).split("/", 1)[0] ?? "";
  return externalPackActions(key).length > 0;
}
