// portal-home · `/chat` = Chat AI (đích của thẻ/switcher); khung chat vẫn ở `/c/*`.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/chat")({
  beforeLoad: () => {
    throw redirect({ to: "/c/new" });
  },
});
