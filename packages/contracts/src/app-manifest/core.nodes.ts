// CR-122 · FLOW2-FR-25 · node LÕI của nền tảng trên bảng node (mọi công ty đều có, không khoá tính năng): Gửi email, Thông báo
// chuông (executor `notify`), Hẹn giờ (`wait_until`), Chờ khoảng (`wait_for`). Chỉ là cấu hình đặt sẵn — không executor mới.
// CR-125 · m1 · khai báo nằm ở `modules/core` (MỘT nguồn: sổ `MODULES`); đây chỉ là bản đọc lại cho bảng node (node có stage mẫu).
import { MODULES } from "../modules/index.generated";
import { legacyNodesOfApp, nodesOfApp } from "../modules/modules.rules";
import type { AppNodeDecl } from "./manifest";

export const CORE_NODES: readonly AppNodeDecl[] = nodesOfApp(MODULES, "core");

/** CR-127 · E9 · node lõi cũ (không còn trên bảng node) mà def đã lưu còn mang khoá ⇒ chỉ dùng để KIỂM CẠNH, không vào menu. */
export const LEGACY_CORE_NODES: readonly AppNodeDecl[] = legacyNodesOfApp(MODULES, "core");

/** Bảng node để kiểm cạnh: `palette` + node lõi cũ chưa có trong đó (khoá đã có ⇒ giữ bản của `palette`). */
export function withLegacyCoreNodes(palette: readonly AppNodeDecl[]): AppNodeDecl[] {
  const have = new Set(palette.map((n) => n.key));
  return [...palette, ...LEGACY_CORE_NODES.filter((n) => !have.has(n.key))];
}
