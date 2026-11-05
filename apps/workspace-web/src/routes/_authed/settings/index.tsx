// V2-O · /settings: Cài đặt mở bằng hộp thoại từ avatar; trang này chỉ còn là đường vào Thành viên & phòng ban — chuyển hướng.
// CR-110 (COM-FR-41/42) · `/settings?sec=<co|rep|biz|scout|flow>` ⇒ mở hộp thoại Cài đặt thẳng ở mục đó (khoá lạ ⇒ mục mặc định) rồi về Tổng quan;
// `sec` đi qua `/sso#code=…&next=/settings?sec=…` nguyên vẹn (`safeNext`). Quyền: hộp thoại tự xử (không phải chủ sở hữu ⇒ chỉ xem).
import { createFileRoute, redirect } from "@tanstack/react-router";
import { openSettings } from "~/features/settings/lib/bus";
import { sectionFromKey } from "~/features/settings/lib/section-key";

export const Route = createFileRoute("/_authed/settings/")({
  validateSearch: (search: Record<string, unknown>): { sec?: string } => ({
    sec: typeof search.sec === "string" && search.sec !== "" ? search.sec : undefined,
  }),
  beforeLoad: ({ search }) => {
    const sec = sectionFromKey(search.sec);
    if (sec) {
      openSettings(sec);
      throw redirect({ to: "/overview", replace: true });
    }
    throw redirect({ to: "/settings/members", replace: true });
  },
});
