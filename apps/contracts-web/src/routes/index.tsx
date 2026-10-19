// PK-FR-10 · TF1 · `/` → `/contracts` (guard `_authed` thêm ở TF4).
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/contracts" });
  },
});
