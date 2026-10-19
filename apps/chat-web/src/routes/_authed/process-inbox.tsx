// HUB-FR-112, CHAT-AC-55 · P-a: `/process-inbox` — DM "Quy trình" (không phải phòng, không textbox; PF3). Engine off ⇒ "Không tìm thấy".
import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ProcessRouteGate } from "~/features/processes/shared/components/ProcessRouteGate";
import { frozenModulesOn } from "~/lib/frozen";

const ProcessInboxPage = lazy(() =>
  import("~/features/processes/inbox/components/ProcessInboxPage").then((m) => ({
    default: m.ProcessInboxPage,
  })),
);

function ProcessInboxRoute() {
  return (
    <ProcessRouteGate>
      <Suspense fallback={null}>
        <ProcessInboxPage />
      </Suspense>
    </ProcessRouteGate>
  );
}

export const Route = createFileRoute("/_authed/process-inbox")({
  // F1 (CR-095): quy trình đóng băng — cờ off ⇒ về hội thoại mới.
  beforeLoad: () => {
    if (!frozenModulesOn) throw redirect({ to: "/c/new" });
  },
  component: ProcessInboxRoute,
});
