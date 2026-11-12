// CR-127 · U6: trang «Hợp đồng đối tác gửi» đã gỡ — HĐ đối tác gửi nằm trong danh sách Hợp đồng (lọc Nguồn = Đối tác gửi). Giữ đường cũ chỉ để chuyển hướng.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/contracts/partner-inbox")({
  beforeLoad: () => {
    throw redirect({
      to: "/contracts/list",
      search: { source: "partner" } as never,
      replace: true,
    });
  },
});
