// Không có quyền vào Studio (H4a-R01) — cần phiên; không gọi API cấu hình.
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "#/features/shell/lib/guard";
import { ForbiddenPage } from "#/features/shell/pages/ForbiddenPage";

export const Route = createFileRoute("/forbidden")({
  beforeLoad: ({ location }) => requireSession(location),
  component: ForbiddenPage,
});
