// CR-191 · BR-191-10 · Sổ Hợp Tác › Đối tác: khối «Yêu cầu tham gia» (đối tác xin vào Bảng tin; duyệt/từ chối như trước, chỉ đổi chỗ).
// Ruột là của module Community (nạp lười); gói Cộng đồng tắt hoặc người xem không có quyền duyệt ⇒ không hiện.
import { lazy, Suspense } from "react";
import { loadJoinReviewPane } from "~/modules/community/manifest";
import { useShellPacks } from "~/shell/use-shell-packs";

const Pane = lazy(loadJoinReviewPane);

export function JoinRequestsPanel() {
  const packs = useShellPacks();
  if (packs.community !== true) return null;
  return (
    <Suspense fallback={null}>
      <Pane />
    </Suspense>
  );
}
