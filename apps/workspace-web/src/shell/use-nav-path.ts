// CR-121 C-8 · MỘT nguồn "đang ở đâu" cho khung dùng chung (Sidebar mục đang chọn, Header khe tìm, Shell bố cục): location ĐÍCH của
// router (đã cập nhật ngay lúc bấm, kể cả khi chunk lười của trang đích còn tải) — không lấy theo route đã khớp/đã vẽ, vì route cũ
// còn vẽ tới khi trang đích tải xong ⇒ thanh trái sáng hai mục, khe tìm vẫn của module cũ.
// (`state.location` của router chỉ đổi khi COMMIT — sau khi chunk/loader của trang đích xong — nên không dùng; `history.location` đổi ngay.)
import { type AnyRouter, useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { MODULES } from "./modules";
import { moduleOfPath } from "./nav";

/** Đường dẫn đích hiện tại của router (lịch sử trình duyệt), không phải route đã commit. Thuần theo router ⇒ test được. */
export const destPath = (router: AnyRouter): string => router.history.location.pathname;

export function useNavPath(): string {
  const router = useRouter();
  return useSyncExternalStore(
    (cb) => router.history.subscribe(cb),
    () => destPath(router),
    () => destPath(router),
  );
}

/** Khoá module sở hữu khe tìm của thanh trên theo đường dẫn đích ("community" vẽ ô tìm; module khác ⇒ khe trống). */
export function searchOwner(pathname: string): string | undefined {
  return moduleOfPath(MODULES, pathname)?.key;
}
