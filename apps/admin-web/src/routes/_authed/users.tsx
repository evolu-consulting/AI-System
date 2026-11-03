// CR-112 · ADM-FR-76 · route cũ giữ lại, chuyển tới tab users của workspace công ty (giữ query).
import { createFileRoute } from "@tanstack/react-router";
import { redirectLegacy } from "@/features/shell/lib/legacy-route";

export const Route = createFileRoute("/_authed/users")({
  validateSearch: (s: Record<string, unknown>) => s,
  beforeLoad: ({ search }) => redirectLegacy("users", search),
});
