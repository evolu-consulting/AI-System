// PK-FR-10 · TF1 · nav-v2 · CR-118 · `/` → home theo quyền (có SHT ⇒ `/overview`, đối tác ⇒ `/community`); chưa có phiên ⇒ `/overview`.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: async () => (await import("~/features/auth/lib/guard")).homeRedirect(),
});
